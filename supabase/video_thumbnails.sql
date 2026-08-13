-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: video posts on the Map currently show a generic play-glyph
-- placeholder instead of a real thumbnail, because post_media has nowhere to
-- store one. Adds a nullable thumbnail_url column — image rows never set it,
-- and existing video rows are left null (they keep the existing glyph
-- fallback, see PostMapMarker.tsx) — and updates create_post_with_media so
-- newly published videos can carry a client-generated cover-frame thumbnail
-- alongside the real video file.
--
-- Safely re-runnable in full.

-- ============================================================================
-- 1. post_media.thumbnail_url
-- ============================================================================

alter table public.post_media
  add column if not exists thumbnail_url text;

-- ============================================================================
-- 2. create_post_with_media — now also writes thumbnail_url when supplied
-- ============================================================================
-- Same signature and return type as the original (post_media.sql) — no other
-- caller exists, so a plain create-or-replace is safe (no drop needed).
-- `item->>'thumbnailUrl'` is simply absent/null for every image item and for
-- any video item the client couldn't generate one for — thumbnail_url ends
-- up null in exactly those cases, same as a pre-existing video row.

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

  insert into public.post_media (post_id, media_type, url, storage_path, aspect_ratio, position, thumbnail_url)
  select
    new_post_id,
    item->>'type',
    item->>'url',
    item->>'storagePath',
    item->>'aspectRatio',
    (item->>'position')::integer,
    item->>'thumbnailUrl'
  from jsonb_array_elements(coalesce(media_input, '[]'::jsonb)) as item;

  return new_post_id;
end;
$$;

grant execute on function public.create_post_with_media(jsonb, jsonb) to authenticated;
