-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: Messages/Moderation Phase 5A — the foundation of reporting. Users
-- can report a post or another user's comment; the report is stored for a
-- future admin review (Phase 5B, not implemented here); the reported content
-- is hidden ONLY from the reporter's own reads, everywhere posts/comments are
-- read, via a small addition to the existing posts/comments SELECT policies.
-- Nothing is deleted, modified, or globally removed. No admin access, no
-- notifications, no soft-removal column on posts/comments — none of that is
-- needed for this phase and none of it is added here.
--
-- reporter_user_id is written ONLY by the two RPCs in section 3 — there is no
-- INSERT policy or INSERT grant on this table for `authenticated` at all, so
-- a client can never supply its own reporter_user_id (or anyone else's).
-- This mirrors the same pattern already used for conversations
-- (get_or_create_conversation) and the read-timestamp columns on
-- conversations (mark_conversation_read): the only writer is a security
-- definer function that derives identity entirely from auth.uid().
--
-- Reads are even more tightly scoped than that: anon/authenticated never
-- query `reports` directly for the hiding check at all. Section 4's two
-- helper functions are the only thing the posts/comments SELECT policies
-- call, each security definer and returning nothing but a boolean — no
-- report row, no reason text, no reporter id ever crosses back out through
-- them. `reports` itself keeps no anon grant whatsoever.
--
-- Safely re-runnable in full.

-- ============================================================================
-- 1. reports
-- ============================================================================
-- Structurally mirrors notifications: a type column plus two nullable
-- dual-purpose target columns, with a check constraint tying the populated
-- target to the declared type — enforced at the database, not just trusted
-- from whichever RPC wrote the row. status is plain text with a check
-- (not a Postgres enum, matching every other status-shaped column in this
-- project) so Phase 5B can add real transitions later with zero migration
-- risk — this phase only ever writes 'pending'.

create table if not exists public.reports (
  id bigint generated always as identity primary key,
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment')),
  target_post_id bigint references public.posts(id) on delete cascade,
  target_comment_id bigint references public.comments(id) on delete cascade,
  reason text check (reason is null or char_length(reason) <= 500),
  status text not null default 'pending' check (status in ('pending', 'dismissed', 'actioned')),
  created_at timestamptz not null default now(),

  constraint reports_shape_matches_type check (
    (target_type = 'post' and target_post_id is not null and target_comment_id is null) or
    (target_type = 'comment' and target_comment_id is not null and target_post_id is null)
  )
);

-- ----------------------------------------------------------------------------
-- Historical dedup, scoped to pending only — at most one pending report per
-- (reporter, target). Scoping to status = 'pending' (rather than the target
-- alone) is deliberate: once Phase 5B adds real status transitions, a
-- dismissed report stops occupying this slot, so the same user could file a
-- fresh report against the same target later — no schema change needed then.
-- These same two indexes double as the lookup path the helper functions in
-- section 4 use (an equality lookup on both columns benefits from the
-- composite index regardless of which column "changes per row" during a
-- broader scan).
-- ----------------------------------------------------------------------------

create unique index if not exists reports_reporter_post_pending_idx
  on public.reports (reporter_user_id, target_post_id)
  where status = 'pending' and target_type = 'post';

create unique index if not exists reports_reporter_comment_pending_idx
  on public.reports (reporter_user_id, target_comment_id)
  where status = 'pending' and target_type = 'comment';

-- ============================================================================
-- 2. Row Level Security on reports itself
-- ============================================================================
-- Reporters can read only their own reports — never another user's, never a
-- blanket "all reports" view, and never anon. There is deliberately no
-- INSERT, UPDATE, or DELETE policy at all: the only writer is the
-- security-definer RPCs in section 3, which bypass RLS by design. A client
-- cannot insert into this table directly under any circumstance, so it can
-- never forge reporter_user_id, report on someone else's behalf, or touch
-- another user's row.

alter table public.reports enable row level security;

drop policy if exists "Users can read their own reports" on public.reports;
create policy "Users can read their own reports"
  on public.reports
  for select
  to authenticated
  using (auth.uid() = reporter_user_id);

grant select on table public.reports to authenticated;

-- No grant of any kind to anon on this table — not even select. The
-- posts/comments hiding check never touches this table directly (see
-- section 4); it only ever goes through a security-definer boolean
-- function, so anon has no reason to and does not have any privilege here.
--
-- No insert/update/delete grant to anon/authenticated either, in this phase.
-- Phase 5B can later add a SEPARATE, ADDITIONAL permissive SELECT policy
-- scoped to an admin check (Postgres OR's multiple permissive policies
-- together for the same command), without touching or weakening the policy
-- above — admins reading pending reports and ordinary users reading only
-- their own reports compose additively, not by replacing this policy.

-- ============================================================================
-- 3. report_post / report_comment — the only way a report is ever created
-- ============================================================================
-- security definer is required: authenticated has no INSERT grant on reports
-- at all. Both functions derive the reporter exclusively from auth.uid() —
-- the client supplies only a target id and an optional reason, never a
-- claimed identity. Parameters are p_-prefixed (matching
-- mark_conversation_read's own convention in messaging_unread.sql) so a bare
-- reference can never be ambiguous with a same-named table column.
--
-- Each function enforces, entirely server-side:
--   - authenticated user required (auth.uid() is not null)
--   - target must actually exist (a plain `select ... into` sets FOUND to
--     false when no row matches, checked explicitly below)
--   - cannot report your own content (owner looked up from the target row
--     itself, compared to auth.uid() — an ownerless pre-auth post has no
--     owner to conflict with, so it's reportable by anyone, consistent with
--     how ownerless posts are already treated elsewhere in this project)
--   - reason capped at 500 characters (also enforced by the table's own
--     check constraint — this is a friendlier early exception rather than a
--     redundant guard; both layers agree on the same limit)
--   - at most one pending report per (reporter, target): the insert targets
--     the exact partial unique index from section 1 with `on conflict ...
--     do nothing` — a duplicate call is a harmless, silent no-op, never an
--     error surfaced to the user for what is, from their perspective, an
--     already-achieved outcome (a pending report already exists).
--
-- Execute is explicitly revoked from PUBLIC and re-granted only to
-- authenticated — Postgres grants EXECUTE on new functions to PUBLIC by
-- default unless revoked, and this closes that off outright rather than
-- relying only on the function's own internal auth.uid() check (which would
-- still make an anon call harmless, but this is the more precise guarantee).

create or replace function public.report_post(p_target_post_id bigint, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  post_owner uuid;
  trimmed_reason text;
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;

  select user_id into post_owner from public.posts where id = p_target_post_id;

  if not found then
    raise exception 'Post not found';
  end if;

  if post_owner is not null and post_owner = me then
    raise exception 'Cannot report your own post';
  end if;

  trimmed_reason := nullif(btrim(p_reason), '');
  if trimmed_reason is not null and char_length(trimmed_reason) > 500 then
    raise exception 'Reason must be 500 characters or fewer';
  end if;

  insert into public.reports (reporter_user_id, target_type, target_post_id, reason)
  values (me, 'post', p_target_post_id, trimmed_reason)
  on conflict (reporter_user_id, target_post_id) where (status = 'pending' and target_type = 'post') do nothing;
end;
$$;

revoke execute on function public.report_post(bigint, text) from public;
grant execute on function public.report_post(bigint, text) to authenticated;

create or replace function public.report_comment(p_target_comment_id bigint, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  comment_owner uuid;
  trimmed_reason text;
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;

  select user_id into comment_owner from public.comments where id = p_target_comment_id;

  if not found then
    raise exception 'Comment not found';
  end if;

  if comment_owner = me then
    raise exception 'Cannot report your own comment';
  end if;

  trimmed_reason := nullif(btrim(p_reason), '');
  if trimmed_reason is not null and char_length(trimmed_reason) > 500 then
    raise exception 'Reason must be 500 characters or fewer';
  end if;

  insert into public.reports (reporter_user_id, target_type, target_comment_id, reason)
  values (me, 'comment', p_target_comment_id, trimmed_reason)
  on conflict (reporter_user_id, target_comment_id) where (status = 'pending' and target_type = 'comment') do nothing;
end;
$$;

revoke execute on function public.report_comment(bigint, text) from public;
grant execute on function public.report_comment(bigint, text) to authenticated;

-- ============================================================================
-- 4. has_pending_post_report / has_pending_comment_report — the ONLY thing
--    the posts/comments SELECT policies are allowed to touch
-- ============================================================================
-- Narrowly scoped on purpose: each takes one target id, returns a single
-- boolean, and never returns a report row, a reason, or a reporter id. This
-- is what lets anon/authenticated invoke the check (needed, since the
-- posts/comments SELECT policies apply `to anon, authenticated` and this
-- function is evaluated per row for both) without ever granting either role
-- any direct privilege on the reports table itself — the function runs
-- security definer, so it can read reports internally regardless of who
-- calls it, while the caller only ever observes true/false.
--
-- auth.uid() is null for an anon caller, and the function returns false
-- immediately in that case — anon reads of posts/comments are therefore
-- completely unaffected, same guarantee as before, just proven inside the
-- function explicitly rather than relying on a NOT EXISTS/null comparison
-- to fall out the same way.
--
-- Execute is revoked from PUBLIC and re-granted explicitly to both anon and
-- authenticated — anon needs it too, since the posts/comments SELECT
-- policies (section 5/6) call it for every row regardless of caller role.

create or replace function public.has_pending_post_report(p_post_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  return exists (
    select 1 from public.reports r
    where r.target_type = 'post'
      and r.target_post_id = p_post_id
      and r.reporter_user_id = auth.uid()
      and r.status = 'pending'
  );
end;
$$;

revoke execute on function public.has_pending_post_report(bigint) from public;
grant execute on function public.has_pending_post_report(bigint) to anon, authenticated;

create or replace function public.has_pending_comment_report(p_comment_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  return exists (
    select 1 from public.reports r
    where r.target_type = 'comment'
      and r.target_comment_id = p_comment_id
      and r.reporter_user_id = auth.uid()
      and r.status = 'pending'
  );
end;
$$;

revoke execute on function public.has_pending_comment_report(bigint) from public;
grant execute on function public.has_pending_comment_report(bigint) to anon, authenticated;

-- ============================================================================
-- 5. Reporter-only hiding: posts
-- ============================================================================
-- Recreates the existing "Public can read posts" policy (auth_and_ownership.sql)
-- calling the helper above instead of querying reports directly. Behavior is
-- unchanged from the previous draft — only the access path is tighter: this
-- policy (and thus every anon/authenticated posts read) never references
-- public.reports itself, only the boolean helper.

drop policy if exists "Public can read posts" on public.posts;
create policy "Public can read posts"
  on public.posts
  for select
  to anon, authenticated
  using (not public.has_pending_post_report(posts.id));

-- ============================================================================
-- 6. Reporter-only hiding: comments
-- ============================================================================
-- Identical shape and reasoning to section 5, recreating the existing
-- "Public can read comments" policy (comments.sql).

drop policy if exists "Public can read comments" on public.comments;
create policy "Public can read comments"
  on public.comments
  for select
  to anon, authenticated
  using (not public.has_pending_comment_report(comments.id));
