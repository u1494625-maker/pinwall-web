-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: production error "more than one row returned by a subquery used
-- as an expression" from get_post_engagement (currently defined in
-- post_views.sql). Root cause, confirmed against a real Postgres, not just
-- read from the SQL: `from unnest(post_ids) as id` names the unnested
-- column `id`, and every correlated subquery inside referred to it with a
-- bare, unqualified `id`. SQL resolves an unqualified name against the
-- CURRENT (innermost) query's own FROM-list first, falling back to an
-- outer correlated scope only if the inner scope has no column of that
-- name -- this is silent shadowing, not an ambiguity error.
--
--   - post_likes / post_saves have no `id` column (composite (post_id,
--     user_id) primary key) -- nothing to shadow, so those four
--     subqueries (like_count, save_count, viewer_has_liked,
--     viewer_has_saved) correctly correlated all along and are unaffected
--     by this fix.
--   - public.posts DOES have an `id` column (its own primary key). Inside
--     `(select p.view_count from public.posts p where p.id = id)`, the
--     bare `id` silently shadowed to p.id, making the clause the
--     tautology `p.id = p.id` -- true for every row in posts. Wrapped in
--     coalesce(), not count()/exists(), so instead of collapsing to one
--     row it tried to return every post's view_count as a single scalar
--     value: exactly the reported crash.
--   - public.comments ALSO has its own `id` column (comments.sql: `id
--     bigint generated always as identity primary key`), so
--     comment_count's subquery has the identical shadowing hazard --
--     but wrapped in count(*), which never throws, it just silently
--     returned the same wrong number for every post (confirmed in the
--     repro: every post reported comment_count 1, regardless of its real
--     count). This predates the View work entirely -- it has been wrong
--     since comments.sql was first applied -- and is fixed here in the
--     same pass since it's the same root cause in the same function.
--
-- Fix: name the unnested column explicitly and qualify every reference to
-- it, so there is no bare `id` anywhere left for any inner table's own
-- `id` column to ever shadow -- `from unnest(post_ids) as
-- requested(requested_post_id)`, with every comparison written as
-- `pl.post_id = requested.requested_post_id` etc.
--
-- Same return-table shape as the current version (post_id, like_count,
-- save_count, comment_count, view_count, viewer_has_liked,
-- viewer_has_saved) -- CREATE OR REPLACE is sufficient, no DROP FUNCTION
-- needed (only a return-column change requires that).
--
-- Safely re-runnable in full.

create or replace function public.get_post_engagement(post_ids bigint[])
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
    requested.requested_post_id as post_id,
    (select count(*) from public.post_likes pl where pl.post_id = requested.requested_post_id),
    (select count(*) from public.post_saves ps where ps.post_id = requested.requested_post_id),
    (select count(*) from public.comments c where c.post_id = requested.requested_post_id),
    coalesce((select p.view_count from public.posts p where p.id = requested.requested_post_id), 0),
    exists (
      select 1 from public.post_likes pl
      where pl.post_id = requested.requested_post_id and pl.user_id = auth.uid()
    ),
    exists (
      select 1 from public.post_saves ps
      where ps.post_id = requested.requested_post_id and ps.user_id = auth.uid()
    )
  from unnest(post_ids) as requested(requested_post_id);
$$;

grant execute on function public.get_post_engagement(bigint[]) to anon, authenticated;
