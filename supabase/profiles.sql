-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor (Dashboard → SQL Editor → New query) once you're ready.
--
-- Context: Phase 3B — the first real per-user profile record. Until now,
-- identity was only ever a denormalized display-name string (posts.author,
-- comments.author) with no row backing it. This adds a `profiles` table
-- keyed 1:1 to auth.users, a trigger that keeps it populated automatically,
-- and the RLS fix `get_profile_stats` (from interactions.sql) needs before it
-- can be safely called for someone else's public profile rather than only
-- the signed-in user's own Me page.
--
-- Existing posts.author/comments.author are left exactly as-is — historical
-- display-name snapshots, never migrated or deleted.
--
-- Safely re-runnable in full.

-- ============================================================================
-- 1. profiles
-- ============================================================================
-- Keyed by auth.users(id) itself (not a surrogate id) — a profile has no
-- identity independent of its user. `on delete cascade` matches every other
-- user-owned table here (post_likes, post_saves, follows, comments).

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Public can read profiles" on public.profiles;
create policy "Public can read profiles"
  on public.profiles
  for select
  to anon, authenticated
  using (true);

-- Insert/update aren't exercised by any UI yet (no profile-editing screen
-- this phase) — added now, at zero cost, so a future edit feature needs no
-- schema/RLS change, only UI.
drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

grant select on table public.profiles to anon, authenticated;
grant insert, update on table public.profiles to authenticated;

-- ============================================================================
-- 2. Auto-create a profile row for every new auth user
-- ============================================================================
-- security definer is required here — this runs against auth.users, which a
-- normal authenticated role can't act on. Scoped tightly: it only ever
-- inserts one row, for the exact new.id that just signed up, using values
-- Google itself supplied. set search_path pins name resolution to `public`
-- so this can't be tricked by a session-level search_path change (standard
-- hardening for any security definer function).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill for accounts created before this migration ran — otherwise those
-- users would have no profile row until they happened to sign out/in again.
insert into public.profiles (id, display_name, avatar_url)
select id, coalesce(raw_user_meta_data->>'full_name', email), raw_user_meta_data->>'avatar_url'
from auth.users
on conflict (id) do nothing;

-- ============================================================================
-- 3. get_profile_stats — now safe to call for ANY user, not just yourself
-- ============================================================================
-- Original version (interactions.sql) is security invoker, which only
-- produces correct following_count/followers_count when target_user_id is
-- the caller — the `follows` SELECT policy only exposes rows where the
-- caller is one of the two participants, so a stranger's real counts would
-- silently come back wrong. That original comment explicitly flagged this
-- exact fix. Made security definer here so the three subqueries below bypass
-- that per-row RLS and count every matching row — still safe, since the
-- function's return shape is unchanged: three aggregate numbers, never a raw
-- follow/like/save row.

drop function if exists public.get_profile_stats(uuid);

create function public.get_profile_stats(target_user_id uuid)
returns table (following_count bigint, followers_count bigint, likes_and_saves_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.follows where follower_user_id = target_user_id),
    (select count(*) from public.follows where following_user_id = target_user_id),
    (select count(*) from public.post_likes pl join public.posts p on p.id = pl.post_id where p.user_id = target_user_id)
      + (select count(*) from public.post_saves ps join public.posts p on p.id = ps.post_id where p.user_id = target_user_id);
$$;

-- Extended to anon: public profile pages must show correct stats to
-- signed-out visitors too, matching how posts/likes/saves/comments are all
-- already publicly readable.
grant execute on function public.get_profile_stats(uuid) to anon, authenticated;
