-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: Phase 5E, part 3 — admin moderation history, and closing the
-- removed-content leak into the normal product experience. Admins currently
-- have an additive, unconditional RLS bypass on posts/comments
-- ("Admins can read all posts/comments for moderation", moderation.sql) —
-- since no normal frontend surface filters by moderation_status itself
-- (correctly, since ordinary RLS already does that for everyone else), an
-- admin sees removed content mixed into Home/Map/Search/Saved/Me/
-- PublicProfile/PostDetail as if it were normal. This file removes that
-- bypass entirely and replaces its two real uses with narrow, explicit,
-- admin-checked RPCs:
--
--   1. The moderation queue's own hydration (pending AND reviewed) — now
--      fully self-contained: every field it needs (content preview, target
--      author, parent post id) comes directly from admin-checked RPCs, with
--      zero dependency on ordinary posts/comments RLS. This also means a
--      pending report's target no longer needs to happen to still be
--      'active' for the queue to work — it never relied on live posts/
--      comments reads at all, on either tab.
--   2. Admin "View" on already-removed content (PostDetail's one explicit,
--      query-param-gated fallback — see get_post_for_moderation below).
--
-- A durable snapshot (content_preview, target_author_user_id,
-- content_post_id) is captured on the reports row itself at review time
-- (Dismiss or Remove), computed by one shared helper
-- (compute_moderation_content_preview) reused by both — so History remains
-- accurate even if the target is later hard-deleted, with zero duplicated
-- preview logic. reports itself needs no new table for this.
--
-- Does not touch: reports.sql's report_post/report_comment/
-- has_pending_post_report/has_pending_comment_report/the reporter-only
-- SELECT policies, system_messages.sql (only called from
-- remove_reported_content, never edited), get_post_engagement, comment/
-- reply creation.
--
-- Safely re-runnable in full.

-- ============================================================================
-- 1. Close the removed-content leak: drop the broad admin bypass
-- ============================================================================
-- Ordinary "Public can read posts"/"Public can read comments" (moderation.sql
-- / comment_replies.sql) become the ONLY SELECT policy on these tables, for
-- everyone, admins included. This is what makes every normal surface
-- automatically correct with zero frontend filtering anywhere — there is
-- nothing left to leak through.
--
-- This is safe for the moderation queue specifically because, from this
-- point on, nothing in the admin tool reads posts/comments directly at all
-- (see sections 3-6) — it is not relying on "pending targets happen to
-- still be active" as an implicit invariant; it simply never touches these
-- tables through ordinary RLS-governed paths in the first place.

drop policy if exists "Admins can read all posts for moderation" on public.posts;
drop policy if exists "Admins can read all comments for moderation" on public.comments;

-- ============================================================================
-- 2. reports: durable moderation snapshot
-- ============================================================================
-- All three nullable, populated only at review time (Dismiss or Remove) —
-- remain null for anything still pending.
--
-- content_preview: the same short, durable preview remove_reported_content
-- already computes today for the System Message body — now also persisted
-- on the report row itself.
--
-- target_author_user_id: on delete set null (not cascade) — mirrors
-- system_messages.reply_to_user_id's own reasoning exactly: this is
-- attribution on a row someone else (the reporter, ultimately) doesn't own;
-- if the content author's account is later deleted, the History row must
-- survive, just losing this one field.
--
-- content_post_id: deliberately NO foreign key at all, and deliberately
-- populated even for a comment-type report (the comment's parent post id) —
-- so the "View" link keeps working if the specific comment is later
-- hard-deleted but its parent post survives. Never joined against, so it
-- can't create any dependency on the referenced row still existing; if that
-- post is also gone, PostDetail's existing "Post not found" fallback
-- handles it gracefully, same as any other stale link.

alter table public.reports add column if not exists content_preview text;
alter table public.reports add column if not exists target_author_user_id uuid references auth.users(id) on delete set null;
alter table public.reports add column if not exists content_post_id bigint;

-- ============================================================================
-- 3. compute_moderation_content_preview — the one place this is computed
-- ============================================================================
-- security definer so it can read posts/comments regardless of the bypass
-- just removed in section 1 (same "internal privileged lookup, not a
-- recursive RLS re-entry" reasoning already used for
-- is_comment_reply_root_visible). Not directly callable by any client role —
-- revoked from public, granted to no one — the only callers are the other
-- security definer functions below, which can call it regardless of grants
-- because a same-owner internal call isn't subject to the grant check (the
-- same principle that already lets has_pending_post_report read reports
-- with zero grants to anyone).
--
-- Always returns exactly one row. For a post target, content_post_id is the
-- post id itself, set unconditionally (even if the post row can't be found —
-- content_preview falls back to '(content unavailable)' in that case, but
-- the id itself, useful for nothing further here, is harmless to keep). For
-- a comment target, content_post_id comes from the comment's own post_id
-- column, read live — this only ever runs at review time, while the report
-- is still 'pending' and its target (enforced by the FK) still exists, so
-- this lookup is always live data at the moment it's captured, even though
-- the result is what makes the row durable afterward.

create or replace function public.compute_moderation_content_preview(
  p_target_type text,
  p_target_post_id bigint,
  p_target_comment_id bigint
)
returns table (content_preview text, author_user_id uuid, post_id bigint)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  post_title text;
  post_caption text;
  comment_body text;
  preview text;
  author_id uuid;
  resolved_post_id bigint;
begin
  if p_target_type = 'post' then
    resolved_post_id := p_target_post_id;

    select p.title, p.caption, p.user_id
    into post_title, post_caption, author_id
    from public.posts p
    where p.id = p_target_post_id;

    if nullif(btrim(post_title), '') is not null then
      preview := btrim(post_title);
    elsif nullif(btrim(post_caption), '') is not null then
      preview := btrim(post_caption);
    else
      preview := '(no caption)';
    end if;
  else
    select c.body, c.user_id, c.post_id
    into comment_body, author_id, resolved_post_id
    from public.comments c
    where c.id = p_target_comment_id;

    preview := btrim(comment_body);
  end if;

  if preview is null then
    preview := '(content unavailable)';
  elsif char_length(preview) > 60 then
    preview := rtrim(left(preview, 60)) || '…';
  end if;

  return query select preview, author_id, resolved_post_id;
end;
$$;

revoke execute on function public.compute_moderation_content_preview(text, bigint, bigint) from public;

-- ============================================================================
-- 4. dismiss_report — now also snapshots the moderation preview
-- ============================================================================
-- Restructured to lock-then-read-then-act (matching remove_reported_content's
-- existing shape) so it can call the helper before writing. Still resolves
-- only the one clicked report — sibling reports against the same target are
-- untouched, exactly as before.

create or replace function public.dismiss_report(p_report_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_report public.reports%rowtype;
  preview_result record;
begin
  if not public.is_current_user_admin() then
    raise exception 'Not authorized';
  end if;

  select *
  into target_report
  from public.reports
  where id = p_report_id and status = 'pending'
  for update;

  if not found then
    raise exception 'Report not found or already reviewed';
  end if;

  select * into preview_result
  from public.compute_moderation_content_preview(
    target_report.target_type, target_report.target_post_id, target_report.target_comment_id
  );

  update public.reports
  set status = 'dismissed',
      reviewed_by_user_id = auth.uid(),
      reviewed_at = now(),
      content_preview = preview_result.content_preview,
      target_author_user_id = preview_result.author_user_id,
      content_post_id = preview_result.post_id
  where id = p_report_id;
end;
$$;

revoke execute on function public.dismiss_report(bigint) from public;
grant execute on function public.dismiss_report(bigint) to authenticated;

-- ============================================================================
-- 5. remove_reported_content — now sources its preview from the shared
--    helper, and stamps the same snapshot onto every sibling report actioned
-- ============================================================================
-- The System Message wording/behavior is byte-for-byte unchanged — this is a
-- pure refactor of where the preview comes from (the shared helper instead
-- of inline computation), plus three new columns added to the existing bulk
-- UPDATE's SET clause. Because that UPDATE already matches every pending
-- report against the same target in one statement, every sibling actioned by
-- a single Remove call gets the identical snapshot for free — no extra
-- looping, no special-casing.

create or replace function public.remove_reported_content(p_report_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_report public.reports%rowtype;
  content_target_id bigint;
  preview_result record;
  reporter_message_body text;
  author_message_body text;
begin
  if not public.is_current_user_admin() then
    raise exception 'Not authorized';
  end if;

  select *
  into target_report
  from public.reports
  where id = p_report_id and status = 'pending'
  for update;

  if not found then
    raise exception 'Report not found or already reviewed';
  end if;

  if target_report.target_type = 'post' then
    content_target_id := target_report.target_post_id;
    update public.posts set moderation_status = 'removed' where id = content_target_id;
  else
    content_target_id := target_report.target_comment_id;
    update public.comments set moderation_status = 'removed' where id = content_target_id;
  end if;

  select * into preview_result
  from public.compute_moderation_content_preview(
    target_report.target_type, target_report.target_post_id, target_report.target_comment_id
  );

  if target_report.target_type = 'post' then
    author_message_body := 'Your post was removed after review.' || chr(10) || chr(10) ||
      'You are responsible for what you post online.';
  else
    author_message_body := 'Your comment was removed after review.' || chr(10) || chr(10) ||
      'You are responsible for what you post online.';
  end if;

  reporter_message_body := 'Thanks for your report.' || chr(10) || chr(10) ||
    'We reviewed the content you reported and removed it for violating our community standards.' || chr(10) || chr(10) ||
    'Reported content: "' || preview_result.content_preview || '"';
  author_message_body := author_message_body || chr(10) || chr(10) ||
    'Reported content: "' || preview_result.content_preview || '"';

  with actioned_reports as (
    update public.reports
    set status = 'actioned',
        reviewed_by_user_id = auth.uid(),
        reviewed_at = now(),
        content_preview = preview_result.content_preview,
        target_author_user_id = preview_result.author_user_id,
        content_post_id = preview_result.post_id
    where status = 'pending'
      and target_type = target_report.target_type
      and (
        (target_report.target_type = 'post' and target_post_id = target_report.target_post_id)
        or (target_report.target_type = 'comment' and target_comment_id = target_report.target_comment_id)
      )
    returning reporter_user_id
  )
  insert into public.system_messages (recipient_user_id, kind, target_type, target_id, content_preview, body)
  select ar.reporter_user_id, 'report_removed_reporter', target_report.target_type, content_target_id, preview_result.content_preview, reporter_message_body
  from actioned_reports ar;

  if preview_result.author_user_id is not null then
    insert into public.system_messages (recipient_user_id, kind, target_type, target_id, content_preview, body)
    values (preview_result.author_user_id, 'report_removed_author', target_report.target_type, content_target_id, preview_result.content_preview, author_message_body);
  end if;
end;
$$;

revoke execute on function public.remove_reported_content(bigint) from public;
grant execute on function public.remove_reported_content(bigint) to authenticated;

-- ============================================================================
-- 6. get_pending_reports_for_admin — now fully self-contained
-- ============================================================================
-- Return shape is changing (three new columns), so the old signature is
-- dropped first, matching the established pattern (get_conversations,
-- get_post_engagement) for a function whose columns change shape.
--
-- Joins the shared preview helper via LATERAL for every pending report —
-- cheap (one function call per row, no N+1 from the client's perspective
-- since this is all server-side within one RPC round trip) and means the
-- admin queue no longer performs a single ordinary posts/comments read
-- anywhere, on either tab. A pending report's target is always a live row
-- (enforced by reports' own target_post_id/target_comment_id foreign keys),
-- so the helper always has real data to compute from here.

drop function if exists public.get_pending_reports_for_admin();

create function public.get_pending_reports_for_admin()
returns table (
  report_id bigint,
  target_type text,
  target_post_id bigint,
  target_comment_id bigint,
  reporter_user_id uuid,
  reason text,
  created_at timestamptz,
  content_preview text,
  target_author_user_id uuid,
  content_post_id bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_current_user_admin() then
    raise exception 'Not authorized';
  end if;

  return query
  select
    r.id, r.target_type, r.target_post_id, r.target_comment_id, r.reporter_user_id, r.reason, r.created_at,
    preview.content_preview, preview.author_user_id, preview.post_id
  from public.reports r
  cross join lateral public.compute_moderation_content_preview(r.target_type, r.target_post_id, r.target_comment_id) as preview
  where r.status = 'pending'
  order by r.created_at desc;
end;
$$;

revoke execute on function public.get_pending_reports_for_admin() from public;
grant execute on function public.get_pending_reports_for_admin() to authenticated;

-- ============================================================================
-- 7. get_reviewed_reports_for_admin — History's sole data source
-- ============================================================================
-- Separate RPC rather than a generalized get_reports_for_admin(status),
-- matching this project's consistent preference for narrow, single-purpose
-- admin RPCs (has_pending_post_report/has_pending_comment_report rather than
-- one parameterized function; dismiss_report/remove_reported_content rather
-- than one moderate(action) RPC). One row per report — dismissed and
-- actioned both included, newest reviewed_at first. Uses the durable
-- snapshot columns directly; no live join to posts/comments at all, so this
-- works identically whether the target is still active, removed, or
-- hard-deleted.

create or replace function public.get_reviewed_reports_for_admin()
returns table (
  report_id bigint,
  target_type text,
  target_post_id bigint,
  target_comment_id bigint,
  reporter_user_id uuid,
  reason text,
  created_at timestamptz,
  status text,
  reviewed_at timestamptz,
  reviewed_by_user_id uuid,
  content_preview text,
  target_author_user_id uuid,
  content_post_id bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_current_user_admin() then
    raise exception 'Not authorized';
  end if;

  return query
  select
    r.id, r.target_type, r.target_post_id, r.target_comment_id, r.reporter_user_id, r.reason, r.created_at,
    r.status, r.reviewed_at, r.reviewed_by_user_id, r.content_preview, r.target_author_user_id, r.content_post_id
  from public.reports r
  where r.status in ('dismissed', 'actioned')
  order by r.reviewed_at desc;
end;
$$;

revoke execute on function public.get_reviewed_reports_for_admin() from public;
grant execute on function public.get_reviewed_reports_for_admin() to authenticated;

-- ============================================================================
-- 8. get_post_for_moderation — the sole remaining path to a removed post
-- ============================================================================
-- Deliberately narrow: one post, by id, admin-checked on every single call —
-- not a standing bypass policy. This is the only replacement needed for the
-- broad bypass's "View" use case: PostDetail tries the ordinary, RLS-governed
-- getPostById first, and only falls back to this (behind an explicit
-- ?moderate=1 marker, checked client-side purely to avoid attempting this on
-- every ordinary 404 — the real security boundary is the admin check inside
-- this function itself, unconditionally, regardless of that client-side gate)
-- when the ordinary fetch found nothing. No comment-level equivalent: a
-- pending comment report's content is already visible via the ordinary
-- policy (its target is always still active), and a reviewed comment
-- report's preview is already durably captured in reports.content_preview —
-- neither needs a live, admin-bypassed comment fetch.

create or replace function public.get_post_for_moderation(p_post_id bigint)
returns public.posts
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  result public.posts%rowtype;
begin
  if not public.is_current_user_admin() then
    raise exception 'Not authorized';
  end if;

  select * into result from public.posts where id = p_post_id;

  if not found then
    raise exception 'Post not found';
  end if;

  return result;
end;
$$;

revoke execute on function public.get_post_for_moderation(bigint) from public;
grant execute on function public.get_post_for_moderation(bigint) to authenticated;
