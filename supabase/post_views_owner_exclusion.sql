-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: the View definition is now "one Post Detail open by a
-- non-owner" (see PostDetail.tsx's load effect). The client already skips
-- calling this RPC when the viewer is the post's own author, but that's
-- purely a wasted-round-trip optimization, not a guarantee — a client
-- can't be trusted (or fast enough against its own auth state) to enforce
-- this on its own. This is the actual, database-enforced boundary.
--
-- Same signature, same atomic single-UPDATE shape as the original version
-- of this function (supabase/post_views.sql) — only the WHERE clause
-- changes, so CREATE OR REPLACE is sufficient here; no DROP FUNCTION
-- needed (only a return-type change requires that, per get_post_engagement's
-- own history in post_views.sql).
--
-- Deliberately NOT `user_id is distinct from auth.uid()`: that simpler
-- form would also (wrongly) skip counting a signed-out viewer's visit to a
-- pre-auth legacy post with a null user_id, since NULL IS DISTINCT FROM
-- NULL is false. The three-way OR below only ever excludes the one case
-- that should be excluded: a signed-in viewer who is that exact post's own
-- author.
--
-- Safely re-runnable in full.

create or replace function public.increment_post_view(target_post_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update public.posts
  set view_count = view_count + 1
  where id = target_post_id
    and (auth.uid() is null or user_id is null or user_id <> auth.uid());
$$;

grant execute on function public.increment_post_view(bigint) to anon, authenticated;
