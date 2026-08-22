-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: video posts are being redesigned so the video file and its cover
-- image live in two separate Storage buckets (post-video / post-image — see
-- supabase/post_video_bucket.sql for the new bucket's RLS) while remaining
-- ONE post_media row per video, per the product decision that a video and its
-- cover must stay strongly linked for reliable delete/edit cleanup. The cover
-- also becomes a required, user-selected image instead of an auto-generated
-- best-effort frame grab.
--
-- post_media already has thumbnail_url (video_thumbnails.sql) but never
-- stored the underlying Storage object path for it — only the public URL.
-- Without a stored path, nothing can ever reliably delete the cover file from
-- Storage (see PostManageSheet.tsx's delete flow, which today only removes
-- `storage_path`, never the thumbnail). This migration adds that missing
-- path column and threads it through both post_media RPCs.
--
-- Safely re-runnable in full.

-- ============================================================================
-- 1. post_media.thumbnail_storage_path
-- ============================================================================

alter table public.post_media
  add column if not exists thumbnail_storage_path text;

-- ============================================================================
-- 2. Check constraint: a video row must always carry both cover fields
-- ============================================================================
-- There are effectively no production video posts yet, so this is the clean
-- point to enforce this at the database level rather than relying on
-- app-level validation alone. Image/text rows are unaffected (thumbnail_url/
-- thumbnail_storage_path stay null for them, exactly as today).
--
-- Dropped and recreated (not ALTER'd in place — Postgres has no ALTER
-- CONSTRAINT for CHECK constraints) so this migration is safely re-runnable.

alter table public.post_media
  drop constraint if exists post_media_video_requires_cover;

alter table public.post_media
  add constraint post_media_video_requires_cover
  check (
    media_type <> 'video'
    or (thumbnail_url is not null and thumbnail_storage_path is not null)
  );

-- ============================================================================
-- 3. create_post_with_media — also writes thumbnail_storage_path
-- ============================================================================
-- Same signature/return type as every earlier version — safe create-or-replace.

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
    thumbnail_url, thumbnail_storage_path, latitude, longitude, location_name
  )
  select
    new_post_id,
    item->>'type',
    item->>'url',
    item->>'storagePath',
    item->>'aspectRatio',
    (item->>'position')::integer,
    item->>'thumbnailUrl',
    item->>'thumbnailStoragePath',
    (item->>'latitude')::double precision,
    (item->>'longitude')::double precision,
    item->>'locationName'
  from jsonb_array_elements(coalesce(media_input, '[]'::jsonb)) as item;

  return new_post_id;
end;
$$;

grant execute on function public.create_post_with_media(jsonb, jsonb) to authenticated;

-- ============================================================================
-- 4. update_post_with_media — also synchronizes thumbnail_storage_path, AND
--    widens the "retained row" update to cover url/storage_path/aspect_ratio/
--    thumbnail_url/thumbnail_storage_path, not just position/location
-- ============================================================================
-- Previously, a retained media row (id present in media_input) only ever had
-- its position/latitude/longitude/location_name updated — url/storage_path/
-- aspect_ratio/thumbnail_url were written once at insert and never touched
-- again, because nothing needed to change them in place: a retained PHOTO's
-- file never changes, only its order/location does.
--
-- Video Edit changes that: replacing only the cover (or only the video) on
-- an existing video post keeps the SAME post_media row id, but its url/
-- storage_path and/or thumbnail_url/thumbnail_storage_path DO need to change
-- in place. Widening this UPDATE to always write these columns is a safe,
-- no-op change for the existing photo-edit path: a retained photo item's
-- url/storage_path/aspect_ratio/thumbnail_url are always resubmitted
-- identical to what's already stored (see EditPostForm.tsx's mediaToSeed /
-- retained-item mapping), so rewriting them changes nothing for photos.
--
-- Same signature/return type as the original (post_media_edit.sql) — safe
-- create-or-replace.

create or replace function public.update_post_with_media(
  p_post_id bigint,
  post_input jsonb,
  media_input jsonb
)
returns void
language plpgsql
as $$
declare
  v_count integer;
begin
  update public.posts
  set
    title = post_input->>'title',
    caption = post_input->>'caption',
    tags = array(select jsonb_array_elements_text(coalesce(post_input->'tags', '[]'::jsonb))),
    show_on_map = coalesce((post_input->>'showOnMap')::boolean, false),
    latitude = (post_input->>'latitude')::double precision,
    longitude = (post_input->>'longitude')::double precision,
    location_name = post_input->>'locationName'
  where id = p_post_id;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'Post could not be updated — it may not exist, or you may not own it.';
  end if;

  -- Deleted media: any existing row for this post not present (by id) in the
  -- final media_input list.
  delete from public.post_media
  where post_id = p_post_id
    and id not in (
      select (item->>'id')::bigint
      from jsonb_array_elements(coalesce(media_input, '[]'::jsonb)) as item
      where item->>'id' is not null
    );

  -- Retained media: update every column that can legitimately change in
  -- place, not just position/location — see comment block above for why this
  -- was widened.
  update public.post_media pm
  set
    url = item->>'url',
    storage_path = item->>'storagePath',
    aspect_ratio = item->>'aspectRatio',
    thumbnail_url = item->>'thumbnailUrl',
    thumbnail_storage_path = item->>'thumbnailStoragePath',
    position = (item->>'position')::integer,
    latitude = (item->>'latitude')::double precision,
    longitude = (item->>'longitude')::double precision,
    location_name = item->>'locationName'
  from jsonb_array_elements(coalesce(media_input, '[]'::jsonb)) as item
  where item->>'id' is not null
    and pm.id = (item->>'id')::bigint
    and pm.post_id = p_post_id;

  -- Newly added media: no id yet, insert fresh rows.
  insert into public.post_media (
    post_id, media_type, url, storage_path, aspect_ratio, position,
    thumbnail_url, thumbnail_storage_path, latitude, longitude, location_name
  )
  select
    p_post_id,
    item->>'type',
    item->>'url',
    item->>'storagePath',
    item->>'aspectRatio',
    (item->>'position')::integer,
    item->>'thumbnailUrl',
    item->>'thumbnailStoragePath',
    (item->>'latitude')::double precision,
    (item->>'longitude')::double precision,
    item->>'locationName'
  from jsonb_array_elements(coalesce(media_input, '[]'::jsonb)) as item
  where item->>'id' is null;
end;
$$;

grant execute on function public.update_post_with_media(bigint, jsonb, jsonb) to authenticated;
