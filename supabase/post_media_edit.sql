-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: Edit Post is gaining full media editing for photo posts — add,
-- delete, reorder, and per-photo/shared location changes, saved atomically
-- alongside the post row itself (see components/post/EditPostForm.tsx and
-- lib/posts.ts's updatePostWithMedia). Three gaps block this:
--
--   1. post_media has no UPDATE policy or grant at all today ("no update
--      policy: nothing writes updates to post_media yet" — post_media.sql).
--      Retained photos need their position/latitude/longitude/location_name
--      updated in place when the user reorders or relocates them.
--   2. post_media's `unique (post_id, position)` constraint is checked after
--      every statement by default. Reordering existing rows in place (e.g.
--      swapping position 0 and 1) can transiently collide with another row's
--      *current* position mid-transaction even though the final state is
--      fully valid — Postgres only skips this problem for constraints
--      explicitly marked deferrable. This applies both across separate
--      statements and within a single multi-row UPDATE.
--   3. There is no atomic way to synchronize "delete some post_media rows +
--      update retained rows' position/location + insert new rows + update
--      the posts row" from the client as several separate statements without
--      risking a half-updated post if one of them fails partway. A single
--      RPC (matching the existing create_post_with_media pattern) is the
--      established, minimal fix for that class of problem in this codebase.
--
-- Safely re-runnable in full.

-- ============================================================================
-- 1. post_media UPDATE policy + grant
-- ============================================================================
-- Same ownership shape as the existing insert/delete policies on this table
-- (post_media has no user_id of its own; ownership flows through the parent
-- post). Scoped to UPDATE only — select/insert/delete are unchanged.

drop policy if exists "Users can update media in their own posts" on public.post_media;

create policy "Users can update media in their own posts"
  on public.post_media
  for update
  to authenticated
  using (
    exists (
      select 1 from public.posts p
      where p.id = post_media.post_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.posts p
      where p.id = post_media.post_id and p.user_id = auth.uid()
    )
  );

grant update on table public.post_media to authenticated;

-- ============================================================================
-- 2. Defer the (post_id, position) unique constraint to commit time
-- ============================================================================
-- PostgreSQL's `ALTER TABLE ... ALTER CONSTRAINT` only supports FOREIGN KEY
-- constraints — it cannot change deferrability of a UNIQUE constraint in
-- place (confirmed against the documented ALTER TABLE grammar; there is no
-- variant of ALTER CONSTRAINT for unique/primary key/exclude constraints).
-- The only way to make an existing UNIQUE constraint deferrable is to drop
-- and recreate it with DEFERRABLE specified at creation time.
--
-- Rather than assume the constraint's name (Postgres's default auto-generated
-- name for the inline `unique (post_id, position)` in post_media.sql would be
-- post_media_post_id_position_key, but a renamed or differently-created
-- constraint would break a hardcoded reference), this block looks up the
-- real constraint at run time: the UNIQUE constraint on public.post_media
-- whose key columns are exactly {post_id, position} (no more, no fewer) —
-- and fails loudly instead of guessing if zero or more than one match.
--
-- Idempotent/safely re-runnable: skips the drop+recreate entirely once the
-- constraint is already deferrable. This only changes *when* uniqueness is
-- checked (at transaction commit instead of after each statement) — it does
-- not loosen what the constraint guarantees, and only affects post_media.
-- No data is at risk: recreating a UNIQUE constraint just re-validates
-- existing rows (which already satisfy it) and rebuilds its backing index.

do $$
declare
  v_conname text;
  v_condeferrable boolean;
begin
  select con.conname, con.condeferrable
  into strict v_conname, v_condeferrable
  from pg_constraint con
  where con.conrelid = 'public.post_media'::regclass
    and con.contype = 'u'
    and array_length(con.conkey, 1) = 2
    and (
      select count(*)
      from unnest(con.conkey) as k(attnum)
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
      where a.attname in ('post_id', 'position')
    ) = 2;

  if v_condeferrable then
    raise notice 'Constraint % is already deferrable — nothing to do.', v_conname;
  else
    execute format('alter table public.post_media drop constraint %I', v_conname);
    execute format(
      'alter table public.post_media add constraint %I unique (post_id, position) deferrable initially deferred',
      v_conname
    );
    raise notice 'Recreated constraint % as DEFERRABLE INITIALLY DEFERRED.', v_conname;
  end if;
exception
  when no_data_found then
    raise exception 'Could not find a UNIQUE constraint on public.post_media covering exactly (post_id, position) — inspect pg_constraint manually before proceeding.';
  when too_many_rows then
    raise exception 'Found more than one UNIQUE constraint on public.post_media covering (post_id, position) — inspect pg_constraint manually before proceeding.';
end $$;

-- ============================================================================
-- 3. update_post_with_media — atomic post + media synchronization
-- ============================================================================
-- security invoker (the default): stays fully subject to RLS on posts and
-- post_media, exactly like create_post_with_media — this only adds
-- transactional atomicity across the four statements below, not elevated
-- privilege. media_input is the COMPLETE final ordered list of media for this
-- post: an item with an `id` is a retained, possibly-moved/relocated photo;
-- an item with no `id` is a newly-uploaded photo; any existing post_media row
-- whose id is absent from media_input entirely is the user's deletion of
-- that photo, applied here. Storage cleanup for deleted photos and rollback
-- of newly-uploaded files on failure both happen client-side (Storage isn't
-- reachable from SQL) — see updatePostWithMedia in lib/posts.ts.

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

  -- Deleted photos: any existing row for this post not present (by id) in
  -- the final media_input list. The `item->>'id' is not null` filter in the
  -- subquery keeps this a clean NOT IN (a NULL in that set would otherwise
  -- make NOT IN match nothing, for every row).
  delete from public.post_media
  where post_id = p_post_id
    and id not in (
      select (item->>'id')::bigint
      from jsonb_array_elements(coalesce(media_input, '[]'::jsonb)) as item
      where item->>'id' is not null
    );

  -- Retained photos: update position + location fields in place. Position/
  -- location always come from the SAME jsonb item as the id, so a moved
  -- photo's own location travels with it by construction — never a
  -- separate index-keyed update.
  update public.post_media pm
  set
    position = (item->>'position')::integer,
    latitude = (item->>'latitude')::double precision,
    longitude = (item->>'longitude')::double precision,
    location_name = item->>'locationName'
  from jsonb_array_elements(coalesce(media_input, '[]'::jsonb)) as item
  where item->>'id' is not null
    and pm.id = (item->>'id')::bigint
    and pm.post_id = p_post_id;

  -- Newly added photos: no id yet, insert fresh rows.
  insert into public.post_media (
    post_id, media_type, url, storage_path, aspect_ratio, position,
    thumbnail_url, latitude, longitude, location_name
  )
  select
    p_post_id,
    item->>'type',
    item->>'url',
    item->>'storagePath',
    item->>'aspectRatio',
    (item->>'position')::integer,
    item->>'thumbnailUrl',
    (item->>'latitude')::double precision,
    (item->>'longitude')::double precision,
    item->>'locationName'
  from jsonb_array_elements(coalesce(media_input, '[]'::jsonb)) as item
  where item->>'id' is null;
end;
$$;

grant execute on function public.update_post_with_media(bigint, jsonb, jsonb) to authenticated;
