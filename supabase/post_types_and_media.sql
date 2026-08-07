-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor (Dashboard → SQL Editor → New query) once ready.
--
-- Context: the Add flow is being redesigned to support image, video, and
-- text-only posts (not just image posts). This is the schema change that
-- makes that possible. Safely re-runnable — every statement is idempotent.
--
-- No RLS or Storage policy changes are needed here: the ownership policies
-- already in supabase/auth_and_ownership.sql check `auth.uid() = user_id`
-- and the storage folder prefix, neither of which cares about post type —
-- they already cover image/video/text posts as-is.

-- ============================================================================
-- 1. post_type — the only strictly new required column
-- ============================================================================
-- `default 'image'` backfills every EXISTING row automatically in this same
-- statement (Postgres applies a constant default to existing rows when you
-- add a NOT NULL column this way — no separate UPDATE, no table rewrite
-- risk). It's also accurate: every row today is an image post.

alter table public.posts
  add column if not exists post_type text not null default 'image';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'posts_post_type_check'
  ) then
    alter table public.posts
      add constraint posts_post_type_check check (post_type in ('image', 'video', 'text'));
  end if;
end $$;

-- ============================================================================
-- 2. Relax NOT NULL on the columns that don't apply to every post type
-- ============================================================================
-- `image` is reused as-is (not renamed) for the media URL of image AND
-- video posts — null for text posts. Renaming it to e.g. `media_url` would
-- ripple into lib/posts.ts and every component that reads `post.image`
-- (PostCard, PostDetail, the Me grid, lib/map/clustering.ts's representative
-- thumbnail) for no real benefit.
--
-- `title` becomes optional: text posts may be published without one.
-- Rendering code (Phase 3) falls back to a short excerpt of `caption`
-- wherever `title` is shown as a heading.
--
-- `image_alt` / `image_aspect` stay populated for image AND video posts
-- (video keeps an aspect ratio + alt text for its preview tile) and are
-- null only for text posts.
--
-- `caption` is deliberately left NOT NULL — it already doubles as the
-- required body text for text posts, so it needs no change.

alter table public.posts alter column image drop not null;
alter table public.posts alter column title drop not null;
alter table public.posts alter column image_alt drop not null;
alter table public.posts alter column image_aspect drop not null;
