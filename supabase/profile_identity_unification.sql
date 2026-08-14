-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: unifies user identity onto profiles. Until now, posts.author and
-- comments.author were denormalized display-name snapshots written once at
-- creation time (from Google's full_name, or the profile didn't exist yet).
-- Editing your display name in the new /me/edit screen would never have
-- updated any of your old posts/comments if we kept those columns — this
-- migration removes them entirely, so post_id/comment_id -> user_id ->
-- profiles is the ONLY identity path left. The app code in this same change
-- reads exclusively from profiles now; there is no fallback to author
-- strings anywhere.
--
-- IMPORTANT ORDERING NOTE: the application code in this change stops
-- sending `author` when creating posts/comments, and create_post_with_media
-- below stops writing it. Paste this file BEFORE using the updated app
-- against this database — the old RPC (still expecting post_input->>'author'
-- into a not-null column) is incompatible with the new client, and vice
-- versa. This mirrors every other schema+RPC pairing in this project.
--
-- Also adds profiles.background_url and the display_name/bio length limits
-- the new /me/edit screen enforces server-side, not just client-side.
--
-- Safely re-runnable in full.

-- ============================================================================
-- 1. profiles.background_url
-- ============================================================================

alter table public.profiles
  add column if not exists background_url text;

-- ============================================================================
-- 2. display_name: required, <= 20 chars. bio: optional, <= 160 chars.
-- ============================================================================
-- Backfill first so the NOT NULL below can never fail on an existing row —
-- every profile should already have a name from the Google-seed trigger, but
-- this guards the migration regardless of how a row got here.

update public.profiles set display_name = 'Pinwall user' where display_name is null;

alter table public.profiles alter column display_name set not null;

alter table public.profiles drop constraint if exists profiles_display_name_length;
alter table public.profiles
  add constraint profiles_display_name_length check (char_length(display_name) between 1 and 20);

alter table public.profiles drop constraint if exists profiles_bio_length;
alter table public.profiles
  add constraint profiles_bio_length check (bio is null or char_length(bio) <= 160);

-- ============================================================================
-- 3. handle_new_user — must truncate to 20 chars, or a long Google name would
--    violate the new constraint and roll back the entire signup (this is an
--    AFTER INSERT trigger on auth.users; a failure here fails the sign-up).
-- ============================================================================

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
    left(coalesce(new.raw_user_meta_data->>'full_name', new.email, 'Pinwall user'), 20),
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

-- Same truncation for the backfill, for the same reason.
insert into public.profiles (id, display_name, avatar_url)
select id, left(coalesce(raw_user_meta_data->>'full_name', email, 'Pinwall user'), 20), raw_user_meta_data->>'avatar_url'
from auth.users
on conflict (id) do nothing;

-- ============================================================================
-- 4. Remove posts.author and comments.author entirely
-- ============================================================================
-- Confirmed via full-repo inspection: posts.author's only remaining reader
-- was client-side search-matching (lib/search.ts), now switched to the live
-- profile display name; comments.author's only reader was the comment list
-- (now resolved via profiles too). Neither is referenced by any other SQL
-- file, RLS policy, or RPC. Existing posts/comments are test data — the rows
-- themselves are untouched, only this one no-longer-used column is dropped
-- from each.

alter table public.posts drop column if exists author;
alter table public.comments drop column if exists author;

-- ============================================================================
-- 5. create_post_with_media — no longer writes posts.author
-- ============================================================================
-- Same signature and return type as every earlier version, so this
-- create-or-replace is safe. Every other field (including thumbnail_url and
-- per-photo latitude/longitude/location_name) is preserved byte-for-byte.

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
    title, caption, tags, rating, rating_count,
    show_on_map, latitude, longitude, location_name, user_id
  )
  values (
    post_input->>'title',
    post_input->>'caption',
    array(select jsonb_array_elements_text(coalesce(post_input->'tags', '[]'::jsonb))),
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
