-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: persistent post view counts. Deliberately a plain counter column
-- on posts, NOT an events/junction table like post_likes/post_saves --
-- those use a composite (post_id, user_id) primary key specifically
-- BECAUSE a duplicate is forbidden; views are the opposite (explicitly not
-- deduplicated by user/session, unbounded per viewer), so an events table
-- would just grow without any natural bound. A single atomically-
-- incremented counter is the right shape here.
--
-- Safely re-runnable in full.

-- ============================================================================
-- 1. posts.view_count
-- ============================================================================

alter table public.posts add column if not exists view_count bigint not null default 0;

-- ============================================================================
-- 2. increment_post_view — the only way view_count is ever written
-- ============================================================================
-- security definer (with a locked-down search_path, never trusting the
-- caller's own session search_path) so this can run as its owner, bypassing
-- RLS for this one narrow, atomic counter bump -- `view_count = view_count +
-- 1` is read and written in a single UPDATE statement, so Postgres's own
-- row-level locking makes two simultaneous callers safe: neither can observe
-- the other's stale starting value and overwrite its increment, unlike a
-- client-side read-then-write. Granted to anon as well as authenticated: a
-- signed-out visitor browsing Explore/Search/a shared post link, or the
-- post's own author viewing their own post, all generate a real view.

create or replace function public.increment_post_view(target_post_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update public.posts set view_count = view_count + 1 where id = target_post_id;
$$;

grant execute on function public.increment_post_view(bigint) to anon, authenticated;

-- ============================================================================
-- 3. get_post_engagement — now also returns view_count
-- ============================================================================
-- Postgres can't CREATE OR REPLACE a function that changes its return
-- columns, so the old signature (from interactions.sql, extended once
-- already by comments.sql for comment_count) is dropped first. Every
-- existing field/behavior is unchanged; this adds exactly one more
-- correlated subquery, reusing the same batched, no-N+1 RPC every card
-- already fetches through — no new per-card request for view counts.

drop function if exists public.get_post_engagement(bigint[]);

create function public.get_post_engagement(post_ids bigint[])
returns table (
  post_id bigint,
  like_count bigint,
  save_count bigint,
  comment_count bigint,
  view_count bigint,
  viewer_has_liked boolean,
  viewer_has_saved boolean
)
language sql
stable
as $$
  select
    id as post_id,
    (select count(*) from public.post_likes pl where pl.post_id = id),
    (select count(*) from public.post_saves ps where ps.post_id = id),
    (select count(*) from public.comments c where c.post_id = id),
    coalesce((select p.view_count from public.posts p where p.id = id), 0),
    exists (select 1 from public.post_likes pl where pl.post_id = id and pl.user_id = auth.uid()),
    exists (select 1 from public.post_saves ps where ps.post_id = id and ps.user_id = auth.uid())
  from unnest(post_ids) as id;
$$;

grant execute on function public.get_post_engagement(bigint[]) to anon, authenticated;
