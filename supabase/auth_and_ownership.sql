-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor (Dashboard → SQL Editor → New query) once you're ready — only after
-- that will `addPost()` succeed, since it now writes a `user_id` column that
-- doesn't exist yet.
--
-- Context: Google Sign-In was added via Supabase Auth. This file (1) gives every
-- post a real owner (auth.users.id, not email) and (2) tightens the previously
-- wide-open RLS policies from supabase/schema.sql now that a real user identity
-- exists to check against. It does not touch or delete any existing rows.
--
-- Written to be safely re-runnable: every policy is dropped (if it exists)
-- before being recreated, so running this more than once won't error.

-- ============================================================================
-- 1. Ownership column
-- ============================================================================
-- Nullable on purpose: rows created before auth existed (including any test
-- posts already in your table) have no owner and are left alone — not
-- backfilled, not deleted. `on delete set null` means if a user account is
-- ever removed, their old posts survive as ownerless rather than being deleted.
--
-- Consequence: the update/delete policies below check `auth.uid() = user_id`,
-- and in SQL `anything = null` is never true — so pre-auth rows become
-- permanently un-editable/un-deletable through the app (by design: nobody
-- should be able to "claim" an old anonymous post by logging in).

alter table public.posts
  add column if not exists user_id uuid
  references auth.users(id)
  on delete set null;

-- ============================================================================
-- 2. Row Level Security on public.posts
-- ============================================================================
-- Recommended policy per operation:
--   Read posts   -> stays public. Home, Map, and Post Detail must keep
--                    working for signed-out visitors, per the nav rules.
--   Create posts -> only an authenticated user, and only with their own
--                    auth.uid() as user_id (can't post as someone else).
--   Update posts -> only the row's owner.
--   Delete posts -> only the row's owner.

alter table public.posts enable row level security;

drop policy if exists "Public can read posts" on public.posts;

create policy "Public can read posts"
  on public.posts
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Public can create posts" on public.posts;
drop policy if exists "Authenticated users can create their own posts" on public.posts;
drop policy if exists "Users can update their own posts" on public.posts;
drop policy if exists "Users can delete their own posts" on public.posts;

create policy "Authenticated users can create their own posts"
  on public.posts
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own posts"
  on public.posts
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own posts"
  on public.posts
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- ============================================================================
-- 3. Storage: post-image bucket
-- ============================================================================
-- lib/storage.ts now uploads to `${user.id}/<uuid>-filename` instead of
-- `posts/<uuid>-filename`, so every user's images live in their own folder.
-- This policy is what actually enforces that server-side: it only allows an
-- authenticated user to insert an object whose first path segment matches
-- their own auth.uid().
--
-- No read policy is needed — the post-image bucket is already public, and
-- public buckets serve objects without going through RLS at all.
--
-- Existing objects uploaded under the old `posts/...` path (before this
-- change) aren't affected by this policy and remain publicly readable; they
-- just aren't associated with any user's folder.

drop policy if exists "Anyone can upload post images" on storage.objects;
drop policy if exists "Users can upload into their own post-image folder" on storage.objects;

create policy "Users can upload into their own post-image folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'post-image'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
