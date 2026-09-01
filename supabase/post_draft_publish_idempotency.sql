-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready — AFTER supabase/post_drafts.sql (this replaces
-- that file's publish_post_draft with a hardened version; same signature,
-- same table dependencies). Written to be safely re-runnable.
--
-- Phase 5: real draft -> published-post conversion, replacing the temporary
-- legacy addPost()-based publish path in MediaPostEditor/TextPostEditor.
-- This migration does two things:
--
-- 1. Adds posts.source_draft_id, so a publish is retry-safe. Without it, a
--    genuine failure mode exists: publish_post_draft's transaction commits
--    (post created, draft deleted) but the client never sees the response
--    (dropped connection) — a blind retry would find no draft left
--    (raise exception) with no way to recover the post id it already
--    created, or worse, could be tempted to publish a second time.
--    source_draft_id lets a retried call recognize "I already did this" and
--    return the SAME post id instead — checked first, before requiring the
--    draft row to still exist, since by the time of a retry the draft row
--    is usually already gone (deleted by the call that actually committed).
--
-- 2. Fixes a real behavior gap found by inspection: the original
--    publish_post_draft (post_drafts.sql) read d.show_on_map/d.latitude/
--    d.longitude directly into the new post, but never reproduced the
--    client's own existing "per-photo location mode fully supersedes the
--    post-level location" rule (MediaPostEditor.tsx's legacy submit path:
--    `showOnMap: perPhotoLocationMode ? false : showOnMap`) — meaning a
--    draft saved with per_photo_location_mode = true would have published
--    WITH the post-level map pin too, double-plotting the same post. Fixed
--    below by computing the effective show_on_map/latitude/longitude at
--    publish time only — the STORED draft row's own show_on_map is left
--    untouched, so restoring a draft still shows the user's real toggle
--    state.
--
-- Safely re-runnable in full.

-- ============================================================================
-- 1. posts.source_draft_id
-- ============================================================================
-- Nullable — a normal, non-draft-originated post (there are none yet, but
-- this stays true in general) simply has source_draft_id = null forever.
-- Plain `unique` (not a partial index) is enough: Postgres treats every NULL
-- as distinct from every other NULL for uniqueness purposes, so multiple
-- null-source posts coexist fine, and only a genuine duplicate non-null
-- value is ever rejected.

alter table public.posts
  add column if not exists source_draft_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'posts_source_draft_id_unique') then
    alter table public.posts
      add constraint posts_source_draft_id_unique unique (source_draft_id);
  end if;
end $$;

-- Not exposed in any UI — purely an internal recovery key. No RLS/grant
-- change needed: it's just one more column on a table whose existing
-- policies are already row-scoped, not column-scoped.

-- ============================================================================
-- 2. publish_post_draft — idempotent, reproduces per-photo location rule
-- ============================================================================
-- Same signature/return type as post_drafts.sql's version — safe
-- create-or-replace, no other caller exists.
--
-- security invoker, same as before: stays fully subject to posts/post_media/
-- post_drafts/draft_media RLS. The idempotency lookup below is itself
-- ownership-scoped (`and user_id = auth.uid()`) specifically so a caller can
-- only ever recover their OWN previously-published post — passing someone
-- else's draft id here can never return, let alone create, another user's
-- post.

create or replace function public.publish_post_draft(p_draft_id uuid)
returns bigint
language plpgsql
security invoker
as $$
declare
  d public.post_drafts;
  new_post_id bigint;
  media_count integer;
  effective_show_on_map boolean;
  effective_latitude double precision;
  effective_longitude double precision;
begin
  -- Idempotency check FIRST, before requiring the draft row to exist — a
  -- prior call may have already committed and deleted it. Owner-scoped: this
  -- can only ever find a post this same caller published.
  select id into new_post_id
    from public.posts
   where source_draft_id = p_draft_id
     and user_id = auth.uid();

  if found then
    return new_post_id;
  end if;

  select * into d
    from public.post_drafts
   where id = p_draft_id and user_id = auth.uid()
   for update;

  if not found then
    -- Distinguishes "never existed / not owned" from "a concurrent call to
    -- this same function raced past the idempotency check above and
    -- committed while we were blocked waiting for the row lock" — the
    -- second case is a genuine simultaneous double-publish (two requests in
    -- flight at once), not just a slow sequential retry, and deserves the
    -- same recovery as one. Cheap (one more indexed lookup), not a state
    -- machine.
    select id into new_post_id
      from public.posts
     where source_draft_id = p_draft_id
       and user_id = auth.uid();

    if found then
      return new_post_id;
    end if;

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

  -- Per-photo location fully supersedes the post-level location — matches
  -- the client's own existing rule (never submit both, avoids double-
  -- plotting the same post on the Map). Applied only to what gets
  -- published, never to the stored draft row itself (d.show_on_map is left
  -- alone so restoring this draft still reflects the real toggle state).
  if d.post_type = 'media' and d.per_photo_location_mode then
    effective_show_on_map := false;
    effective_latitude := null;
    effective_longitude := null;
  else
    effective_show_on_map := d.show_on_map;
    effective_latitude := d.latitude;
    effective_longitude := d.longitude;
  end if;

  insert into public.posts (
    user_id, title, caption, tags, rating, rating_count, show_on_map,
    latitude, longitude, location_name, text_template, source_draft_id
  )
  values (
    d.user_id, d.title, d.caption, d.tags, 0, 'New', effective_show_on_map,
    effective_latitude, effective_longitude, d.location_name, d.text_template, p_draft_id
  )
  returning id into new_post_id;

  if d.post_type = 'media' then
    -- Plain row-value copy, ordered by the already-reconciled contiguous
    -- position — the underlying Storage object never moves, copies, or
    -- re-uploads; url/storage_path are reused byte-for-byte.
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
  end if;

  -- Last step, on purpose: draft_media cascades away with it, and this is
  -- what makes a genuinely sequential retry find "no draft" and fall through
  -- to the idempotency check at the top instead of double-publishing.
  delete from public.post_drafts where id = p_draft_id;

  return new_post_id;
end;
$$;

grant execute on function public.publish_post_draft(uuid) to authenticated;
