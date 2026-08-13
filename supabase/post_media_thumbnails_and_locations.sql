-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: consolidates supabase/video_thumbnails.sql and
-- supabase/media_locations.sql into one final migration, so post_media ends
-- up with thumbnail_url AND latitude/longitude/location_name in a single
-- run, with create_post_with_media writing all of them together.
--
-- This is NOT a correction of a bug in the two older files — running
-- video_thumbnails.sql followed by media_locations.sql is itself safe
-- (media_locations.sql's version of create_post_with_media is a complete,
-- self-contained redefinition that already includes everything
-- video_thumbnails.sql added). This file just replaces that two-step dance
-- with one paste. video_thumbnails.sql and media_locations.sql are left in
-- place as historical records; you do not need to run them separately, and
-- running this instead of them (or after one/both of them, in any order) is
-- safe either way — every statement here is additive and idempotent:
--   - `alter table ... add column if not exists` never touches existing rows
--     or existing columns, and no-ops if a column is already there.
--   - `create or replace function` always fully replaces the function body
--     with the same final definition below — never a partial merge.
--   - `grant execute` is idempotent.
-- No table is dropped, no row is deleted, no existing data is modified.
--
-- Safely re-runnable in full, any number of times, in any order relative to
-- the two older files.

-- ============================================================================
-- 1. post_media columns — thumbnail_url (video cover frame) + per-photo
--    location (latitude/longitude/location_name)
-- ============================================================================

alter table public.post_media
  add column if not exists thumbnail_url text;

alter table public.post_media
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists location_name text;

-- No RLS/grant changes needed for any of these: the existing "Users can
-- insert media into their own posts" policy on post_media is not
-- column-scoped, so it already covers all four columns. No update policy is
-- added — these are all set once at creation time only; there is still no
-- "edit media" feature.

-- ============================================================================
-- 2. create_post_with_media — final version, writes every post_media column
-- ============================================================================
-- Same signature and return type as every earlier version (post_media.sql),
-- so this create-or-replace is safe — no drop needed, and no other caller
-- exists. `item->>'thumbnailUrl'` / `'latitude'` / `'longitude'` /
-- `'locationName'` are simply absent/null for any item that doesn't supply
-- them (every existing post, every video's non-thumbnail case, every image
-- that wasn't individually located) — ending up null in post_media, which
-- is the correct "not set" state for all of these.

create or replace function public.create_post_with_media(
  post_input jsonb,
  media_input jsonb
)
returns bigint
language plpgsql
as $$
declare
  new_post_id bigint;
begin
  insert into public.posts (
    title, caption, tags, author, rating, rating_count,
    show_on_map, latitude, longitude, location_name, user_id
  )
  values (
    post_input->>'title',
    post_input->>'caption',
    array(select jsonb_array_elements_text(coalesce(post_input->'tags', '[]'::jsonb))),
    post_input->>'author',
    coalesce((post_input->>'rating')::real, 0),
    coalesce(post_input->>'ratingCount', 'New'),
    coalesce((post_input->>'showOnMap')::boolean, false),
    (post_input->>'latitude')::double precision,
    (post_input->>'longitude')::double precision,
    post_input->>'locationName',
    (post_input->>'userId')::uuid
  )
  returning id into new_post_id;

  insert into public.post_media (
    post_id, media_type, url, storage_path, aspect_ratio, position,
    thumbnail_url, latitude, longitude, location_name
  )
  select
    new_post_id,
    item->>'type',
    item->>'url',
    item->>'storagePath',
    item->>'aspectRatio',
    (item->>'position')::integer,
    item->>'thumbnailUrl',
    (item->>'latitude')::double precision,
    (item->>'longitude')::double precision,
    item->>'locationName'
  from jsonb_array_elements(coalesce(media_input, '[]'::jsonb)) as item;

  return new_post_id;
end;
$$;

grant execute on function public.create_post_with_media(jsonb, jsonb) to authenticated;
