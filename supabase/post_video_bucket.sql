-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: video posts now upload the actual video file to a NEW bucket,
-- `post-video`, separate from `post-image` (which continues to hold photos
-- and video cover images). This file gives `post-video` the same
-- ownership-scoped RLS as `post-image` already has (auth_and_ownership.sql +
-- post_deletion.sql) — INSERT/SELECT/DELETE, all scoped to the authenticated
-- user's own first-level folder. No UPDATE policy, matching post-image's own
-- precedent: uploadProfileImage's upsert:true already works against
-- post-image with no UPDATE policy at all, and the resumable (TUS) upload
-- path was already confirmed (live, against this project) to work under
-- exactly this INSERT/SELECT/DELETE triad with no UPDATE — see
-- uploadVideoResumable's doc comment in lib/storage.ts.
--
-- Manual step this file cannot do: create the `post-video` bucket itself
-- (Dashboard → Storage → New bucket → public, matching post-image) and set
-- its file-size limit above the app's 300MB product ceiling (MAX_VIDEO_BYTES
-- in lib/storage.ts) — both are Storage configuration, not SQL, so they must
-- be done via the dashboard/Management API before this feature can be used
-- end-to-end. The RLS policies below are inert until that bucket exists.
--
-- Safely re-runnable.

drop policy if exists "Users can upload into their own post-video folder" on storage.objects;

create policy "Users can upload into their own post-video folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'post-video'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can select their own post-video files" on storage.objects;

create policy "Users can select their own post-video files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'post-video'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete their own post-video files" on storage.objects;

create policy "Users can delete their own post-video files"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'post-video'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
