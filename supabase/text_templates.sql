-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: Phase 6A lets a text-post author pick one of 4 fixed visual
-- templates (note/quote/memo/basic) at publish time. The template is a
-- property of the whole post, not of any individual rendered page — long
-- text is paginated purely client-side at render time (see lib/textPagination.ts
-- in the frontend change that follows this migration), so nothing about
-- pagination is represented here. caption remains the single, unabstracted
-- source of truth for search/moderation/accessibility — this migration only
-- adds a way to tag which of the 4 styles a post's caption should render as.
--
-- Safely re-runnable in full.

-- ============================================================================
-- 1. posts.text_template
-- ============================================================================
-- Nullable, no default. NULL means "not a templated text post" — every post
-- that exists before this migration runs is NULL and keeps rendering exactly
-- as it does today (see PostCard.tsx / PostDetail.tsx's existing `!cover`
-- fallback paths, unchanged by this migration). Media posts also stay NULL
-- forever; only TextPostEditor ever sets this, to one of the 4 values below.
--
-- Column and constraint are added as two separate, independently idempotent
-- statements — add column if not exists is a no-op if the column already
-- exists (regardless of constraint state), and the guarded do $$ block below
-- only adds posts_text_template_check if it isn't already present. This
-- matches the pattern originally used for posts_post_type_check in
-- supabase/post_types_and_media.sql, so either statement can be safely
-- re-run on its own, in any combination of already-applied/not-yet-applied.

alter table public.posts
  add column if not exists text_template text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'posts_text_template_check') then
    alter table public.posts
      add constraint posts_text_template_check
        check (text_template is null or text_template in ('note', 'quote', 'memo', 'basic'));
  end if;
end $$;

-- ============================================================================
-- 2. create_post_with_media — accepts textTemplate
-- ============================================================================
-- Same signature and return type as every earlier version, so this
-- create-or-replace is safe and the existing `grant execute ... to
-- authenticated` below still applies to it. Every other field (tags, rating,
-- location, all of post_media's columns including thumbnail_url and
-- per-photo latitude/longitude/location_name) is preserved byte-for-byte from
-- supabase/profile_identity_unification.sql's version — the only change is
-- one new column in the `insert into posts` list, sourced from
-- post_input->>'textTemplate'. A media post's create call simply won't
-- include that key, so post_input->>'textTemplate' is null and the column
-- stays null, exactly as intended.

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
    show_on_map, latitude, longitude, location_name, user_id, text_template
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
    (post_input->>'userId')::uuid,
    post_input->>'textTemplate'
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
