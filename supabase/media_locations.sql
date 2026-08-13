-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: multi-photo posts can now optionally give each photo its own map
-- location, instead of only the post-level posts.show_on_map/latitude/
-- longitude/location_name. Adds the same three fields to post_media,
-- nullable so every existing row (and every image that never gets a
-- per-photo location) stays exactly as valid as before. Precedence between
-- a post's own location and its media's individual locations lives entirely
-- in application code (lib/map/clustering.ts's buildMapItems) — this
-- migration only adds storage for it.
--
-- Safely re-runnable in full.

-- ============================================================================
-- 1. post_media location columns
-- ============================================================================

alter table public.post_media
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists location_name text;

-- No RLS/grant changes needed: the existing "Users can insert media into
-- their own posts" policy is not column-scoped, so it already covers these
-- columns. No update policy is added — same as thumbnail_url before it,
-- these are set once at creation time only; there is still no "edit media"
-- feature.

-- ============================================================================
-- 2. create_post_with_media — now also writes per-media location
-- ============================================================================
-- Same signature and return type as the current version (video_thumbnails.sql),
-- so a plain create-or-replace is safe (no drop needed). thumbnail_url's
-- column and logic are preserved byte-for-byte. `item->>'latitude'` etc. are
-- simply absent/null for every item that has no per-photo location (which is
-- every existing post, and every image that wasn't individually located),
-- ending up null in post_media exactly like thumbnail_url already does.

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
