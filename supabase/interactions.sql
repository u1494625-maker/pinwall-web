-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: Pinwall's first real user-to-user interaction phase. Adds three
-- junction tables (post_likes, post_saves, follows) and two RPCs for reading
-- aggregate engagement without exposing raw liker/saver/follower lists to
-- clients or causing an N+1 request pattern in feeds. No profiles table is
-- introduced — nothing here needs to display another user's name/avatar;
-- Follow's target is posts.user_id (already present on every post), and all
-- counts are computed server-side.
--
-- Safely re-runnable in full.

-- ============================================================================
-- 1. post_likes
-- ============================================================================
-- Composite primary key (post_id, user_id) — not a surrogate id — makes a
-- duplicate like impossible at the database level, not just in app code.
-- Nothing else ever needs to reference an individual like row.

create table if not exists public.post_likes (
  post_id bigint not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists post_likes_user_id_idx on public.post_likes (user_id);

alter table public.post_likes enable row level security;

drop policy if exists "Public can read post likes" on public.post_likes;
create policy "Public can read post likes"
  on public.post_likes
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Users can like posts as themselves" on public.post_likes;
create policy "Users can like posts as themselves"
  on public.post_likes
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can unlike their own likes" on public.post_likes;
create policy "Users can unlike their own likes"
  on public.post_likes
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- No update policy: nothing edits a like row (unlike and re-like instead) —
-- same "add one only when that feature exists" precedent as post_media.

grant select on table public.post_likes to anon, authenticated;
grant insert, delete on table public.post_likes to authenticated;

-- ============================================================================
-- 2. post_saves
-- ============================================================================
-- Structurally identical to post_likes, and deliberately kept as a fully
-- separate table (not a "type" column on one shared table) — Like and Save
-- must never share state or a toggle path.

create table if not exists public.post_saves (
  post_id bigint not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists post_saves_user_id_idx on public.post_saves (user_id);

alter table public.post_saves enable row level security;

drop policy if exists "Public can read post saves" on public.post_saves;
create policy "Public can read post saves"
  on public.post_saves
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Users can save posts as themselves" on public.post_saves;
create policy "Users can save posts as themselves"
  on public.post_saves
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can unsave their own saves" on public.post_saves;
create policy "Users can unsave their own saves"
  on public.post_saves
  for delete
  to authenticated
  using (auth.uid() = user_id);

grant select on table public.post_saves to anon, authenticated;
grant insert, delete on table public.post_saves to authenticated;

-- ============================================================================
-- 3. follows
-- ============================================================================
-- Composite primary key (follower_user_id, following_user_id) makes a
-- duplicate follow impossible at the database level. The check constraint
-- makes following yourself impossible at the database level too — both are
-- real guarantees, not just UI-level prevention (the UI also never renders a
-- Follow control on your own post, but that's belt and suspenders, not the
-- only thing standing in the way).

create table if not exists public.follows (
  follower_user_id uuid not null references auth.users(id) on delete cascade,
  following_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_user_id, following_user_id),
  constraint follows_no_self_follow check (follower_user_id <> following_user_id)
);

create index if not exists follows_following_user_id_idx on public.follows (following_user_id);

alter table public.follows enable row level security;

-- Deliberately more restrictive than post_likes/post_saves: every real read
-- this app does only ever needs rows where the caller is one of the two
-- participants (their own Following-feed membership, whether they follow a
-- given post's author, or their own Following/Followers counts) — never an
-- arbitrary stranger's relationships. No anon access at all: a signed-out
-- visitor can't follow anyone, and the Following tab already gates on
-- sign-in before any query here runs.
drop policy if exists "Users can read follow relationships involving themselves" on public.follows;
create policy "Users can read follow relationships involving themselves"
  on public.follows
  for select
  to authenticated
  using (auth.uid() = follower_user_id or auth.uid() = following_user_id);

drop policy if exists "Users can follow as themselves" on public.follows;
create policy "Users can follow as themselves"
  on public.follows
  for insert
  to authenticated
  with check (auth.uid() = follower_user_id);

drop policy if exists "Users can unfollow their own follows" on public.follows;
create policy "Users can unfollow their own follows"
  on public.follows
  for delete
  to authenticated
  using (auth.uid() = follower_user_id);

grant select on table public.follows to authenticated;
grant insert, delete on table public.follows to authenticated;

-- ============================================================================
-- 4. get_profile_stats — Following / Followers / Likes & Saves for Me page
-- ============================================================================
-- security invoker (the default). Correct for every real call site in this
-- phase because target_user_id is always auth.uid() itself (the Me page only
-- ever shows the signed-in user's own stats) — both disjuncts of the SELECT
-- policy above line up exactly with what's being counted here. If a future
-- phase adds public profile pages showing ANOTHER user's stats, this would
-- need to become security definer (safe — it only ever returns aggregate
-- numbers, never raw rows) or the follows SELECT policy would need to widen.
-- Not needed yet, flagged so it isn't a surprise later.
--
-- "Likes & Saves" is engagement RECEIVED on this user's own posts (likes +
-- saves on posts they authored) — not posts they personally liked/saved.

create or replace function public.get_profile_stats(target_user_id uuid)
returns table (following_count bigint, followers_count bigint, likes_and_saves_count bigint)
language sql
stable
as $$
  select
    (select count(*) from public.follows where follower_user_id = target_user_id),
    (select count(*) from public.follows where following_user_id = target_user_id),
    (select count(*) from public.post_likes pl join public.posts p on p.id = pl.post_id where p.user_id = target_user_id)
      + (select count(*) from public.post_saves ps join public.posts p on p.id = ps.post_id where p.user_id = target_user_id);
$$;

grant execute on function public.get_profile_stats(uuid) to authenticated;

-- ============================================================================
-- 5. get_post_engagement — like/save counts + viewer state, batched per page
-- ============================================================================
-- Returns only aggregates and booleans — never the underlying liker/saver
-- rows — so a feed of N posts can learn real likeCount/saveCount/
-- viewerHasLiked/viewerHasSaved with exactly one extra request per page load
-- (never one per card, never a raw ID list shipped to the client).
--
-- auth.uid() resolves per-request to whoever is actually calling; for a
-- signed-out caller it's null, and `user_id = null` is never true in SQL, so
-- viewer_has_liked/viewer_has_saved correctly come back false with no
-- special-casing (same x = null reasoning already used in
-- auth_and_ownership.sql).

create or replace function public.get_post_engagement(post_ids bigint[])
returns table (post_id bigint, like_count bigint, save_count bigint, viewer_has_liked boolean, viewer_has_saved boolean)
language sql
stable
as $$
  select
    id as post_id,
    (select count(*) from public.post_likes pl where pl.post_id = id),
    (select count(*) from public.post_saves ps where ps.post_id = id),
    exists (select 1 from public.post_likes pl where pl.post_id = id and pl.user_id = auth.uid()),
    exists (select 1 from public.post_saves ps where ps.post_id = id and ps.user_id = auth.uid())
  from unnest(post_ids) as id;
$$;

grant execute on function public.get_post_engagement(bigint[]) to anon, authenticated;
