-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: Messages/Moderation Phase 5B — admin moderation on top of Phase
-- 5A's reporting. Adds an admin-role table, soft-removal state on
-- posts/comments, audit fields on reports, and three admin RPCs (queue,
-- dismiss, remove). Nothing here touches notifications, messages/
-- conversations, or follows. No system notifications, no comment replies —
-- those are later phases.
--
-- Safely re-runnable in full.

-- ============================================================================
-- 1. admin_users — who is an admin, and nothing else
-- ============================================================================
-- Zero client-facing access in any direction, for any role — no select,
-- insert, update, or delete grant to anon/authenticated at all. RLS is
-- enabled anyway with no policies, as defense in depth: even if a future
-- migration ever accidentally granted a privilege here, "RLS enabled, zero
-- policies" still means default-deny for every role. The only reader is
-- is_current_user_admin() below (security definer, bypasses RLS).
--
-- There is no in-app path that can ever write to this table — the first
-- admin(s) must be seeded manually, once, directly in the SQL editor:
--
--   insert into public.admin_users (user_id) values ('<your-own-user-id>');
--
-- (Find your own id via `select id from auth.users where email = '...';` or
-- the Authentication tab in the dashboard.) This is intentionally left as a
-- manual step for you to run — not included as an active statement below.

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

-- ============================================================================
-- 2. is_current_user_admin — the only thing allowed to read admin_users
-- ============================================================================
-- Mirrors has_pending_post_report/has_pending_comment_report from
-- reports.sql exactly: security definer, explicit early return for an
-- unauthenticated caller, returns a bare boolean and nothing else. Used both
-- by the posts/comments admin-bypass policies below (to, authenticated —
-- anon never needs this) and by the three admin RPCs later in this file.

create or replace function public.is_current_user_admin()
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
    select 1 from public.admin_users a where a.user_id = auth.uid()
  );
end;
$$;

revoke execute on function public.is_current_user_admin() from public;
grant execute on function public.is_current_user_admin() to authenticated;

-- ============================================================================
-- 3. Soft removal: moderation_status on posts and comments
-- ============================================================================
-- Plain text + check, matching every other status-shaped column in this
-- project (notifications.type, reports.status) rather than a Postgres enum
-- or a boolean — leaves room for a future third state without a migration,
-- at zero extra cost now. Adding a NOT NULL column with a DEFAULT to an
-- existing table is a metadata-only operation in modern Postgres — every
-- existing post/comment becomes 'active' automatically, no explicit backfill
-- UPDATE needed, no table rewrite.

alter table public.posts
  add column if not exists moderation_status text not null default 'active'
    check (moderation_status in ('active', 'removed'));

alter table public.comments
  add column if not exists moderation_status text not null default 'active'
    check (moderation_status in ('active', 'removed'));

create index if not exists posts_moderation_status_idx on public.posts (moderation_status);
create index if not exists comments_moderation_status_idx on public.comments (moderation_status);

-- ============================================================================
-- 4. Audit fields on reports
-- ============================================================================
-- Nullable — a still-pending report has neither. on delete set null (not
-- cascade): if an admin's own account is later deleted, the historical
-- report should keep existing, just lose the "who reviewed it" attribution
-- rather than disappearing.

alter table public.reports
  add column if not exists reviewed_by_user_id uuid references auth.users(id) on delete set null;

alter table public.reports
  add column if not exists reviewed_at timestamptz;

-- ============================================================================
-- 5. Reporter-only + soft-removal hiding: posts
-- ============================================================================
-- Recreates the existing "Public can read posts" policy (reports.sql) with
-- one added clause: ordinary reads (anon and authenticated alike) now also
-- require moderation_status = 'active'. This applies equally to the
-- content's own author — a removed post is gone for them too, exactly as
-- specified, since this policy doesn't special-case ownership.
--
-- The second policy is NEW and ADDITIVE — Postgres ORs multiple permissive
-- SELECT policies together, so for an ordinary user is_current_user_admin()
-- evaluates false and this policy contributes nothing; for an admin, this
-- policy alone is true, so they see every post regardless of
-- moderation_status or anyone's pending reports (including their own).
-- Nothing about the first policy is weakened by adding the second.

drop policy if exists "Public can read posts" on public.posts;
create policy "Public can read posts"
  on public.posts
  for select
  to anon, authenticated
  using (
    moderation_status = 'active'
    and not public.has_pending_post_report(posts.id)
  );

drop policy if exists "Admins can read all posts for moderation" on public.posts;
create policy "Admins can read all posts for moderation"
  on public.posts
  for select
  to authenticated
  using (public.is_current_user_admin());

-- ============================================================================
-- 6. Reporter-only + soft-removal hiding: comments
-- ============================================================================
-- Identical shape and reasoning to section 5.

drop policy if exists "Public can read comments" on public.comments;
create policy "Public can read comments"
  on public.comments
  for select
  to anon, authenticated
  using (
    moderation_status = 'active'
    and not public.has_pending_comment_report(comments.id)
  );

drop policy if exists "Admins can read all comments for moderation" on public.comments;
create policy "Admins can read all comments for moderation"
  on public.comments
  for select
  to authenticated
  using (public.is_current_user_admin());

-- ============================================================================
-- 7. get_pending_reports_for_admin — the only way the queue reads reports
-- ============================================================================
-- reports.sql deliberately left `reports` with no admin bypass policy, and
-- this file doesn't add one — this RPC is the sole read path for the
-- moderation queue, kept as narrow as possible. Returns bare ids/fields only
-- (no joined preview text, no profile data): the frontend hydrates reporter
-- identity, content-author identity, and content previews using the
-- existing batched helpers (getProfilesByUserIds, getPostsByIds,
-- getCommentsByIds), which already work correctly for an admin caller
-- because of the admin-bypass posts/comments policies above. This avoids
-- duplicating "what does a post preview look like" logic in SQL, and avoids
-- N+1 regardless of queue size (one RPC call + up to three batched
-- follow-up calls, never one per report).

create or replace function public.get_pending_reports_for_admin()
returns table (
  report_id bigint,
  target_type text,
  target_post_id bigint,
  target_comment_id bigint,
  reporter_user_id uuid,
  reason text,
  created_at timestamptz
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
  select r.id, r.target_type, r.target_post_id, r.target_comment_id, r.reporter_user_id, r.reason, r.created_at
  from public.reports r
  where r.status = 'pending'
  order by r.created_at desc;
end;
$$;

revoke execute on function public.get_pending_reports_for_admin() from public;
grant execute on function public.get_pending_reports_for_admin() to authenticated;

-- ============================================================================
-- 8. dismiss_report — resolves exactly one report, nothing else
-- ============================================================================
-- Scoped to only the given report_id, on purpose — dismissing one report is
-- a judgment about that report's validity, not a statement that the content
-- is fine overall, so sibling pending reports against the same target are
-- left untouched for independent review.
--
-- The `where id = p_report_id and status = 'pending'` combined with a plain
-- UPDATE is already safe under a race: two concurrent calls naturally
-- serialize at the row level, and whichever runs second matches zero rows
-- once the first has committed, landing in the `if not found` branch below
-- rather than double-processing anything. Reporter-only hiding lifts
-- automatically the moment this report leaves 'pending' —
-- has_pending_post_report's own `where status = 'pending'` clause simply
-- stops matching on the very next read; no extra code needed for that.

create or replace function public.dismiss_report(p_report_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_current_user_admin() then
    raise exception 'Not authorized';
  end if;

  update public.reports
  set status = 'dismissed', reviewed_by_user_id = auth.uid(), reviewed_at = now()
  where id = p_report_id and status = 'pending';

  if not found then
    raise exception 'Report not found or already reviewed';
  end if;
end;
$$;

revoke execute on function public.dismiss_report(bigint) from public;
grant execute on function public.dismiss_report(bigint) to authenticated;

-- ============================================================================
-- 9. remove_reported_content — removes the target, actions every pending
--    report against it, atomically
-- ============================================================================
-- `select ... for update` locks the report row for the duration of this
-- multi-step transaction, so a genuine simultaneous double-click (or two
-- admins racing on the same report) serializes instead of both proceeding —
-- the second call's lock wait ends with the row already non-pending, landing
-- in `if not found` rather than removing the same content twice or
-- double-actioning reports. The whole function body runs as one statement
-- from the caller's perspective, so if anything inside failed, the entire
-- set of changes would roll back together — there's no partial-applied state
-- possible.
--
-- Removal is a decision about the CONTENT, not about one specific report:
-- once the target is removed, every other pending report against that exact
-- same target is resolved by the same act, so all of them transition to
-- 'actioned' together (attributed to the same admin/timestamp) rather than
-- being left stranded in 'pending' for a queue that would otherwise keep
-- re-surfacing reports about content that's already gone.

create or replace function public.remove_reported_content(p_report_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_report public.reports%rowtype;
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
    update public.posts set moderation_status = 'removed' where id = target_report.target_post_id;
  else
    update public.comments set moderation_status = 'removed' where id = target_report.target_comment_id;
  end if;

  update public.reports
  set status = 'actioned', reviewed_by_user_id = auth.uid(), reviewed_at = now()
  where status = 'pending'
    and target_type = target_report.target_type
    and (
      (target_report.target_type = 'post' and target_post_id = target_report.target_post_id)
      or (target_report.target_type = 'comment' and target_comment_id = target_report.target_comment_id)
    );
end;
$$;

revoke execute on function public.remove_reported_content(bigint) from public;
grant execute on function public.remove_reported_content(bigint) to authenticated;
