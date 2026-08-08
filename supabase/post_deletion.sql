-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready — until then, an owner's post-delete flow can remove
-- the `posts` row (already covered by the existing delete policy in
-- auth_and_ownership.sql) but will fail to remove the file from Storage.
--
-- Context: owner-only post deletion needs to (1) delete the `posts` row and
-- (2) remove the post's media object (if any) from the `post-image` bucket.
-- A real end-to-end test against the live project surfaced two gaps beyond
-- the RLS policies already in auth_and_ownership.sql — both are fixed below:
--
-- 1. Table-level DELETE privilege on public.posts. Postgres checks two
--    independent layers for a DELETE: the coarse-grained GRANT (can this
--    role run DELETE on this table at all) and RLS (once that's allowed,
--    which rows). The `authenticated` role never had DELETE granted on
--    `public.posts`, so every delete attempt failed before RLS's
--    `auth.uid() = user_id` check was ever reached — regardless of
--    ownership. RLS alone was never enough.
--
-- 2. A Storage SELECT policy on storage.objects. Supabase Storage's
--    `remove()` call needs to look up the object's row (to identify/return
--    what it removed) in addition to the DELETE policy that permits removing
--    it. The `post-image` bucket being public only means its *public URL* is
--    served without going through RLS at all — that says nothing about the
--    Storage API's own `storage.objects` access, which is a separate,
--    authenticated-role-scoped check. Without this policy, `remove()` could
--    not resolve the object even with the DELETE policy already in place.
--
-- Written to be safely re-runnable.

-- ============================================================================
-- 1. Table privilege: allow authenticated users to delete posts at all
-- ============================================================================
-- Required in addition to the "Users can delete their own posts" RLS policy
-- (auth_and_ownership.sql) — that policy only restricts *which* rows, not
-- whether the role can issue DELETE on this table in the first place.

grant delete on table public.posts to authenticated;

-- ============================================================================
-- 2. Storage: post-image bucket
-- ============================================================================
-- Both policies below are scoped identically: an authenticated user may only
-- touch objects inside their own folder (first path segment = their own
-- auth.uid()). SELECT is needed for Storage's remove() to resolve the object;
-- DELETE is needed to actually remove it.

drop policy if exists "Users can select their own post-image files" on storage.objects;

create policy "Users can select their own post-image files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'post-image'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete their own post-image files" on storage.objects;

create policy "Users can delete their own post-image files"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'post-image'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
