-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: Pinwall is moving from one scalar media field per post
-- (`posts.image` / `post_type` / `image_aspect` / `image_alt`) to a proper
-- one-to-many `post_media` table, so a post can eventually hold multiple
-- photos/videos. There are no real users and no production data — existing
-- posts are disposable test data — so this migration deletes them outright
-- and drops the legacy columns immediately rather than staging a dual-write
-- transition. `post_media` becomes the sole source of truth for post media
-- from this point on.
--
-- Manual step this file can't do: after running this, also delete any
-- existing objects in the `post-image` Storage bucket via the Supabase
-- dashboard (Storage → post-image → select all → delete). Deleting rows from
-- storage.objects directly via SQL does not reliably delete the underlying
-- files, so that cleanup is a dashboard action, not part of this script.
--
-- Safely re-runnable except for the one-time data delete in section 1.

-- ============================================================================
-- 1. Delete existing (test) posts
-- ============================================================================
-- Irreversible. Confirmed acceptable: no real users, no production data worth
-- preserving. Safe to run even before post_media exists below — there's
-- nothing yet for a cascade to reach.

delete from public.posts;

-- ============================================================================
-- 2. post_media table
-- ============================================================================

create table if not exists public.post_media (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.posts(id) on delete cascade,
  media_type text not null check (media_type in ('image', 'video')),
  url text not null,
  storage_path text not null,
  aspect_ratio text,
  position integer not null,
  created_at timestamptz not null default now(),
  unique (post_id, position)
);

create index if not exists post_media_post_id_idx on public.post_media (post_id);

-- ============================================================================
-- 3. Row Level Security on post_media
-- ============================================================================
-- post_media has no user_id of its own — ownership flows through the parent
-- post, the same pattern as every other owner-scoped check in this project.

alter table public.post_media enable row level security;

drop policy if exists "Public can read post media" on public.post_media;

create policy "Public can read post media"
  on public.post_media
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Users can insert media into their own posts" on public.post_media;

create policy "Users can insert media into their own posts"
  on public.post_media
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.posts p
      where p.id = post_media.post_id and p.user_id = auth.uid()
    )
  );

drop policy if exists "Users can delete media from their own posts" on public.post_media;

create policy "Users can delete media from their own posts"
  on public.post_media
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.posts p
      where p.id = post_media.post_id and p.user_id = auth.uid()
    )
  );

-- No update policy: nothing writes updates to post_media yet (no "edit media"
-- feature exists) — add one only when that feature actually exists.

-- ============================================================================
-- 4. Table-level privileges
-- ============================================================================
-- Learned the hard way with `posts` (see post_deletion.sql / post_editing.sql):
-- an RLS policy alone does not grant a role permission to run an operation on
-- a table at all — both the GRANT and the policy are required. Granting this
-- up front here instead of rediscovering the gap via a failed live test.

grant select on table public.post_media to anon, authenticated;
grant insert, delete on table public.post_media to authenticated;

-- ============================================================================
-- 5. create_post_with_media — atomic post + media insert
-- ============================================================================
-- Runs with security invoker (the default — not specifying `security definer`
-- below is what keeps it that way), so it stays fully subject to the RLS
-- policies above and on `posts`; it only adds transactional atomicity across
-- the two inserts, not elevated privilege. Without this, a post row and its
-- media rows are two separate statements from the client, leaving a window
-- where a public, publicly-readable post could exist with zero or partial
-- media rows.

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

  insert into public.post_media (post_id, media_type, url, storage_path, aspect_ratio, position)
  select
    new_post_id,
    item->>'type',
    item->>'url',
    item->>'storagePath',
    item->>'aspectRatio',
    (item->>'position')::integer
  from jsonb_array_elements(coalesce(media_input, '[]'::jsonb)) as item;

  return new_post_id;
end;
$$;

grant execute on function public.create_post_with_media(jsonb, jsonb) to authenticated;

-- ============================================================================
-- 6. Drop legacy single-media columns from posts
-- ============================================================================
-- Safe now that post_media exists and section 1 already cleared every row
-- that depended on these columns. Dropping post_type also drops its
-- posts_post_type_check constraint automatically (Postgres cascades check
-- constraints scoped to a single dropped column).

alter table public.posts drop column if exists image;
alter table public.posts drop column if exists image_alt;
alter table public.posts drop column if exists image_aspect;
alter table public.posts drop column if exists post_type;
