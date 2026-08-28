-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: posts.user_id was originally defined with `on delete set null`
-- (see auth_and_ownership.sql's own comment: "if a user account is ever
-- removed, their old posts survive as ownerless rather than being
-- deleted") -- written long before self-service account deletion existed.
-- Now that Delete Account (app/api/account/delete/route.ts) is real,
-- SET NULL means deleting your own account leaves your posts behind as
-- orphaned "Pinwall user" rows -- and since that route also deletes the
-- underlying Storage files by prefix independently of any database row,
-- those surviving posts point at photos/videos that are already gone,
-- rendering broken. This is not the intended behavior: deleting your
-- account should remove your posts and everything that depends on them,
-- the same way it already removes your comments, likes, saves, follows,
-- messages, and reports (all already `on delete cascade`).
--
-- This file changes ONLY the ON DELETE action on the existing FK -- same
-- column, same referenced table, same nullability. Postgres has no ALTER
-- ... ON DELETE syntax, so changing this requires dropping and re-adding
-- the constraint; this does not touch any row, any other constraint, or
-- any policy on public.posts. auth_and_ownership.sql itself is left
-- exactly as it was originally written, as historical record -- this file
-- is what's actually authoritative for this FK's behavior going forward.
--
-- Deliberately does NOT touch existing rows where user_id IS NULL today.
-- Some of those are legitimately pre-auth posts with no owner to begin
-- with (auth_and_ownership.sql's own original intent) and some may be
-- orphans left behind by this exact bug before this fix was applied --
-- this migration cannot tell those two cases apart, and guessing wrong
-- would either delete a legitimate historical post or leave a real orphan
-- behind. This fixes the FK for all FUTURE account deletions only, on
-- purpose; any already-existing orphan should be identified and removed
-- separately, deliberately, not swept up automatically here.
--
-- Once this is applied, no application code change is required:
-- app/api/account/delete/route.ts already does nothing more than call
-- supabase.auth.admin.deleteUser(userId) after Storage cleanup and lets
-- the database's own cascades handle every dependent row -- this fix
-- makes that assumption true for posts/post_media too, the same way it
-- already was for every other user-owned table.
--
-- One accepted, deliberate consequence, not a new one: a PENDING (not yet
-- reviewed) report against a post will now cascade away if that post's
-- author deletes their own account, since the report row itself
-- references the post. This is not a new evasion path -- the existing
-- "Users can delete their own posts" policy (auth_and_ownership.sql) has
-- no report-related restriction at all, so a user can already delete
-- their own reported post today via the ordinary in-app delete flow,
-- account deletion or not; comments already cascade the same way. An
-- ALREADY-REVIEWED report is unaffected either way -- moderation_history.sql's
-- durable snapshot (content_preview, target_author_user_id,
-- content_post_id) is captured on the reports row itself at review time,
-- specifically so it survives the target being hard-deleted later.
--
-- Safely re-runnable in full: DROP CONSTRAINT IF EXISTS, then re-add with
-- the same name and target, just the new ON DELETE action.

alter table public.posts drop constraint if exists posts_user_id_fkey;

alter table public.posts
  add constraint posts_user_id_fkey
  foreign key (user_id) references auth.users(id)
  on delete cascade;
