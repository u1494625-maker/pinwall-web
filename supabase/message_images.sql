-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: v1 image messages. A message becomes exactly one of TEXT
-- (body set, image_path null) or IMAGE (image_path set, body null) — never
-- both, never neither. Does not touch conversation creation, unread state,
-- the Realtime publication statement, or blocking's own tables/predicate —
-- all of that (messaging.sql, messaging_unread.sql, blocking.sql) is
-- unchanged and still governs everything except the two things below.
--
-- Unlike supabase/post_video_bucket.sql's own note that bucket creation
-- "cannot" be done in SQL: storage.buckets is a plain table this project's
-- migration role can insert into directly, so the bucket itself, its
-- public=false flag, its size limit, and its MIME allow-list are all
-- created HERE, not left to a manual Dashboard step — the exact gap that
-- made post-video's actual public/private status uncertain after the fact.
-- Verify after running this that the Supabase dashboard shows
-- message-images as a non-public bucket with these settings, since this
-- tool has no live connection to confirm it executed as written.
--
-- Safely re-runnable in full.

-- ============================================================================
-- 1. message-images bucket — private, size-capped, MIME-restricted
-- ============================================================================
-- allowed_mime_types matches ALLOWED_IMAGE_TYPES in lib/storage.ts exactly
-- (never heic/heif — those are always converted to JPEG client-side before
-- upload, see lib/heic.ts, so raw HEIC bytes never reach Storage). 10MB is
-- generous headroom above prepareImageForUpload's ~1.5MB soft target
-- (lib/imageOptimization.ts) while still bounding worst-case abuse well
-- under the 25MB client-side source guard (uncompressed originals never
-- reach Storage either way).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'message-images',
  'message-images',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ============================================================================
-- 2. messages: body becomes nullable, image_path added, exactly-one-of
-- ============================================================================
-- The original inline check (char_length(body) between 1 and 2000, from
-- messaging.sql) is located and dropped by inspecting its actual definition
-- rather than guessing its auto-generated name — same "look it up, don't
-- guess" approach as post_media_edit.sql's constraint rename. Harmless even
-- if this somehow finds nothing: a leftover length-only check would still
-- pass for every image row (body IS NULL makes char_length(body) evaluate
-- to NULL, which a CHECK treats as satisfied, never violated).

alter table public.messages alter column body drop not null;

alter table public.messages
  add column if not exists image_path text;

do $$
declare
  v_conname text;
begin
  select con.conname into v_conname
  from pg_constraint con
  where con.conrelid = 'public.messages'::regclass
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%char_length(body)%';

  if v_conname is not null then
    execute format('alter table public.messages drop constraint %I', v_conname);
  end if;
end $$;

alter table public.messages drop constraint if exists messages_body_or_image_check;
alter table public.messages
  add constraint messages_body_or_image_check check (
    (body is not null and char_length(body) between 1 and 2000 and image_path is null)
    or
    (image_path is not null and body is null)
  );

-- ============================================================================
-- 3. touch_conversation_on_message: image messages preview as "📷 Photo"
-- ============================================================================
-- Only the SET clause changes from messaging.sql's original — everything
-- else (security definer, trigger name/timing) is identical.

create or replace function public.touch_conversation_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set
    last_message_at = new.created_at,
    last_message_body = case when new.image_path is not null then '📷 Photo' else new.body end
  where id = new.conversation_id;

  return new;
end;
$$;

drop trigger if exists on_message_touch_conversation on public.messages;
create trigger on_message_touch_conversation
  after insert on public.messages
  for each row execute function public.touch_conversation_on_message();

-- ============================================================================
-- 4. safe_bigint — order-independent safe cast for Storage RLS below
-- ============================================================================
-- Postgres does NOT guarantee left-to-right short-circuit evaluation of AND
-- clauses in a policy expression (the planner may reorder them) — so
-- putting a numeric-format guard *before* a raw `::bigint` cast in the same
-- expression is not a reliable way to prevent that cast from ever running
-- against a malformed segment. This wraps the cast in an exception handler
-- instead, returning NULL (which simply never matches any real
-- conversation id, failing the policy cleanly) rather than letting a
-- malformed path segment raise an unhandled cast error, regardless of
-- evaluation order.

create or replace function public.safe_bigint(text_value text)
returns bigint
language plpgsql
immutable
as $$
begin
  return text_value::bigint;
exception when others then
  return null;
end;
$$;

grant execute on function public.safe_bigint(text) to authenticated;

-- ============================================================================
-- 5. Storage RLS for message-images
-- ============================================================================
-- Path convention: {senderUserId}/{conversationId}/{uuid}-{filename} —
-- userId first, matching every existing upload convention in this project
-- (post-image/post-video/profile — see lib/storage.ts), so the
-- account-deletion cleanup mechanism's own `${userId}/` prefix assumption
-- keeps working. conversationId is segment [2].
--
-- INSERT: sender-only (segment [1] = auth.uid()) AND genuine participant of
-- the conversation in segment [2] AND not blocked from that pair — the
-- exact same three conditions as the existing messages INSERT policy
-- (blocking.sql), just re-expressed against a Storage path instead of a
-- conversation_id column.
--
-- SELECT: any participant of the conversation in segment [2] — deliberately
-- does NOT check is_blocked_pair, matching the existing messages SELECT
-- policy (messaging.sql), which also never has: blocking hides a
-- conversation from the LIST and blocks NEW sends, but never hides already-
-- exchanged history from either side.
--
-- DELETE: sender-only (segment [1] = auth.uid()) — matches this project's
-- universal "always single-owner, never joint" delete pattern (post-image,
-- post-video, posts, comments, etc. — nothing in this codebase has ever
-- allowed a non-owner to delete shared content).

drop policy if exists "Senders can upload into their own message-images folder" on storage.objects;
create policy "Senders can upload into their own message-images folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'message-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.conversations c
      where c.id = public.safe_bigint((storage.foldername(name))[2])
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
    and not public.is_blocked_pair(
      (
        select case when c.user_a_id = auth.uid() then c.user_b_id else c.user_a_id end
        from public.conversations c
        where c.id = public.safe_bigint((storage.foldername(name))[2])
      )
    )
  );

drop policy if exists "Participants can view message-images in their conversations" on storage.objects;
create policy "Participants can view message-images in their conversations"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'message-images'
    and exists (
      select 1 from public.conversations c
      where c.id = public.safe_bigint((storage.foldername(name))[2])
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );

drop policy if exists "Senders can delete their own message-images" on storage.objects;
create policy "Senders can delete their own message-images"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'message-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- No anon policy on this bucket at all — message images are never public.
