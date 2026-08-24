-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: uploadProfileImage() (lib/storage.ts) uploads avatar/background
-- images to a FIXED path per user (<uid>/profile/avatar.jpg or
-- .../background.jpg) with upsert: true, so replacing an image overwrites
-- the previous one in place rather than leaving an orphaned old file. The
-- first-ever upload for a user resolves to a plain INSERT (already
-- permitted by "Users can upload into their own post-image folder",
-- auth_and_ownership.sql) — but every subsequent change resolves to an
-- UPDATE against storage.objects, and no UPDATE policy has ever existed for
-- this bucket. Postgres RLS denies any command with no permissive policy,
-- so every second-and-later avatar/background change fails with "new row
-- violates row-level security policy."
--
-- This adds exactly one narrowly-scoped UPDATE policy, using the identical
-- ownership check every other post-image policy already uses — no broader
-- than the existing INSERT/SELECT/DELETE policies, never "any authenticated
-- user can upload anywhere." Same using/with-check-symmetric shape already
-- established for a narrow ownership-scoped UPDATE elsewhere in this
-- project (see post_media_edit.sql's UPDATE policy on post_media).
--
-- Safely re-runnable.

drop policy if exists "Users can update their own post-image files" on storage.objects;

create policy "Users can update their own post-image files"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'post-image'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'post-image'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
