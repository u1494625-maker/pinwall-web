-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready. Written to be safely re-runnable.
--
-- Context: persistent post drafts. Today, selecting a photo/video only ever
-- creates an in-memory File with a local blob-URL preview -- nothing touches
-- Supabase until Publish, so closing the app, losing network, or just
-- changing your mind loses everything, media included. This adds a real
-- server-side draft: two new tables, owner-only via RLS, that a draft's
-- media can be uploaded into (and text/settings autosaved into) well before
-- a post exists, plus one RPC that turns a draft into a real post.
--
-- Deliberately two new tables, not an extension of the existing post_media
-- (nullable post_id, added draft_id). A brand-new table starts RLS-enabled
-- with zero policies (default-deny) -- there's no legacy public policy a
-- future migration could forget to drop, and a cleanup query scoped to
-- draft_media can never reach a published post's row no matter how that
-- query is edited later. post_media's own meaning ("belongs to a public,
-- already-gated post") never changes.
--
-- Storage: unchanged, not touched by this file at all. Both the post-image
-- and post-video buckets are public (auth_and_ownership.sql, comment above
-- its Storage policies), so a draft's uploaded file is fetchable by its URL
-- alone from the moment it exists, with no RLS -- exactly like a normal
-- in-progress publish already briefly is today, just for a longer window.
-- The privacy guarantee here is the same one this app has always relied on:
-- the DB row (RLS), not Storage-URL secrecy. Publishing a draft therefore
-- never uploads, moves, or copies a Storage object -- draft_media and
-- post_media are meant to reference the exact same url/storage_path
-- before and after publish; only the owning DB row changes.
--
-- This migration is database-only. No app code depends on it yet.

-- ============================================================================
-- 1. post_drafts -- one row per (user, editor type) in progress
-- ============================================================================
-- Column set is exactly what MediaPostEditor/TextPostEditor already use
-- today (title/caption/tags/location/per-photo-location/text_template) --
-- nothing speculative added. The unique (user_id, post_type) constraint is
-- what gives "one active draft per editor per user" for free, with no
-- status/soft-delete column: both the Don't Save and Publish flows hard-
-- delete this row (see publish_post_draft below), so "does a row exist" is
-- always the right answer to "is there an active draft."
create table if not exists public.post_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  post_type text not null check (post_type in ('media', 'text')),
  title text,
  caption text,
  tags text[] not null default '{}',
  show_on_map boolean not null default false,
  latitude double precision,
  longitude double precision,
  location_name text,
  per_photo_location_mode boolean not null default false,
  text_template text check (text_template is null or text_template in ('note', 'quote', 'memo', 'basic')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, post_type)
);

alter table public.post_drafts enable row level security;

drop policy if exists "Users can read their own drafts" on public.post_drafts;
create policy "Users can read their own drafts"
  on public.post_drafts for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can create their own drafts" on public.post_drafts;
create policy "Users can create their own drafts"
  on public.post_drafts for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own drafts" on public.post_drafts;
create policy "Users can update their own drafts"
  on public.post_drafts for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own drafts" on public.post_drafts;
create policy "Users can delete their own drafts"
  on public.post_drafts for delete to authenticated
  using (auth.uid() = user_id);

-- No anon grant/policy at all -- a draft is never publicly visible, full stop.
grant select, insert, update, delete on table public.post_drafts to authenticated;

-- ============================================================================
-- 2. draft_media -- media metadata for a not-yet-published draft
-- ============================================================================
-- Mirrors post_media's columns minus post_id, plus draft_id. No user_id
-- column here either, matching post_media's own existing shape -- ownership
-- flows through draft_id -> post_drafts.user_id, the same one-hop pattern
-- post_media already uses via post_id -> posts.user_id. No video-cover
-- requirement: post_media doesn't enforce one today (that constraint was
-- added, then explicitly dropped/made optional), so this doesn't add one
-- either -- draft_media's validation stays aligned with post_media's actual
-- current behavior, not a stricter rule invented for drafts alone.
create table if not exists public.draft_media (
  id bigint generated always as identity primary key,
  draft_id uuid not null references public.post_drafts(id) on delete cascade,
  media_type text not null check (media_type in ('image', 'video')),
  url text not null,
  storage_path text not null,
  aspect_ratio text,
  position integer not null,
  thumbnail_url text,
  thumbnail_storage_path text,
  latitude double precision,
  longitude double precision,
  location_name text,
  created_at timestamptz not null default now(),
  unique (draft_id, position) deferrable initially deferred
);

create index if not exists draft_media_draft_id_idx on public.draft_media (draft_id);

alter table public.draft_media enable row level security;

drop policy if exists "Users can read their own draft media" on public.draft_media;
create policy "Users can read their own draft media"
  on public.draft_media for select to authenticated
  using (exists (
    select 1 from public.post_drafts d where d.id = draft_media.draft_id and d.user_id = auth.uid()
  ));

drop policy if exists "Users can insert media into their own drafts" on public.draft_media;
create policy "Users can insert media into their own drafts"
  on public.draft_media for insert to authenticated
  with check (exists (
    select 1 from public.post_drafts d where d.id = draft_media.draft_id and d.user_id = auth.uid()
  ));

drop policy if exists "Users can update media in their own drafts" on public.draft_media;
create policy "Users can update media in their own drafts"
  on public.draft_media for update to authenticated
  using (exists (
    select 1 from public.post_drafts d where d.id = draft_media.draft_id and d.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.post_drafts d where d.id = draft_media.draft_id and d.user_id = auth.uid()
  ));

drop policy if exists "Users can delete media from their own drafts" on public.draft_media;
create policy "Users can delete media from their own drafts"
  on public.draft_media for delete to authenticated
  using (exists (
    select 1 from public.post_drafts d where d.id = draft_media.draft_id and d.user_id = auth.uid()
  ));

-- No anon grant/policy here either -- same reasoning as post_drafts above.
grant select, insert, update, delete on table public.draft_media to authenticated;

-- ============================================================================
-- 3. Keep post_drafts.updated_at current when its media changes
-- ============================================================================
-- Autosave already bumps updated_at on every text/settings change; without
-- this, uploading media with no recent text edit would leave updated_at
-- stale from an earlier save, and a future cleanup job reading updated_at
-- (drafts inactive for 3+ days) could sweep a draft that actually just had
-- real media activity. A DB-level guarantee, not something left to every
-- client code path to remember.
create or replace function public.touch_draft_updated_at()
returns trigger
language plpgsql
as $$
begin
  update public.post_drafts
     set updated_at = now()
   where id = coalesce(new.draft_id, old.draft_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists on_draft_media_touch_draft on public.draft_media;
create trigger on_draft_media_touch_draft
  after insert or update or delete on public.draft_media
  for each row execute function public.touch_draft_updated_at();

-- ============================================================================
-- 4. publish_post_draft -- turn a draft into a real post, atomically
-- ============================================================================
-- No parameters beyond the draft id -- title/caption/etc. are read straight
-- from the (locked) post_drafts row itself, never from a client-supplied
-- payload. This is what makes "what's saved is what publishes" true by
-- construction (a client can't accidentally publish edits the debounced
-- autosave hasn't actually written yet), and it's the same reason
-- create_post_with_media never needed a second source of truth either.
--
-- `select ... for update` locks the draft row for the rest of this
-- transaction -- the exact same pattern already used by
-- remove_reported_content in moderation.sql for the same reason: a genuine
-- concurrent double-publish (a double-tap, or a client retry after a
-- dropped connection) serializes instead of both proceeding, and the
-- second call's lock wait ends with `if not found` (the row is already
-- gone, deleted by the first call) rather than creating a second post.
--
-- Requires at least one draft_media row before publishing a media draft --
-- the same guarantee create_post_with_media's own existence protects today
-- ("a public post existing with zero/partial media"), reused here rather
-- than reinvented.
--
-- Storage is never touched by this function (SQL can't reach it, and
-- doesn't need to -- see the file header). The post_media insert below is a
-- plain row-value copy of already-uploaded url/storage_path values; the
-- underlying file never moves, copies, or re-uploads. security invoker, so
-- every insert/update/delete here still runs under normal RLS -- matching
-- create_post_with_media/update_post_with_media's existing convention.
create or replace function public.publish_post_draft(p_draft_id uuid)
returns bigint
language plpgsql
security invoker
as $$
declare
  d public.post_drafts;
  new_post_id bigint;
  media_count integer;
begin
  select * into d
    from public.post_drafts
   where id = p_draft_id and user_id = auth.uid()
   for update;

  if not found then
    raise exception 'Draft not found or not owned by caller';
  end if;

  if d.title is null or btrim(d.title) = '' then
    raise exception 'Draft is missing a title';
  end if;
  if d.caption is null or btrim(d.caption) = '' then
    raise exception 'Draft is missing a caption';
  end if;

  if d.post_type = 'media' then
    select count(*) into media_count from public.draft_media where draft_id = p_draft_id;
    if media_count = 0 then
      raise exception 'Draft has no media to publish';
    end if;
  end if;

  insert into public.posts (
    user_id, title, caption, tags, rating, rating_count, show_on_map,
    latitude, longitude, location_name, text_template
  )
  values (
    d.user_id, d.title, d.caption, d.tags, 0, 'New', d.show_on_map,
    d.latitude, d.longitude, d.location_name, d.text_template
  )
  returning id into new_post_id;

  insert into public.post_media (
    post_id, media_type, url, storage_path, aspect_ratio, position,
    thumbnail_url, thumbnail_storage_path, latitude, longitude, location_name
  )
  select
    new_post_id, media_type, url, storage_path, aspect_ratio, position,
    thumbnail_url, thumbnail_storage_path, latitude, longitude, location_name
  from public.draft_media
  where draft_id = p_draft_id
  order by position;

  -- Last step, on purpose: draft_media cascades away with it, and this is
  -- what makes a concurrent/retried second call fail cleanly (not found)
  -- instead of double-publishing.
  delete from public.post_drafts where id = p_draft_id;

  return new_post_id;
end;
$$;

grant execute on function public.publish_post_draft(uuid) to authenticated;
