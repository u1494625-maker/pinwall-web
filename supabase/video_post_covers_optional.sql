-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: the user-uploaded video cover feature has been removed — a video
-- post now requires only a video file, no separate cover image. This drops
-- the CHECK constraint supabase/video_post_covers.sql added, which required
-- every video row to carry both thumbnail_url and thumbnail_storage_path;
-- that requirement no longer holds; enforcing it would reject every new
-- video row, which never sets either field anymore.
--
-- thumbnail_url/thumbnail_storage_path themselves are NOT dropped — they stay
-- as nullable, optional columns. A video row published while the cover
-- feature existed keeps whatever it already has (read-only now, never
-- written to again except by PostManageSheet's delete-cleanup path), and a
-- future real generated-thumbnail feature can reuse these same columns.
--
-- create_post_with_media / update_post_with_media need no further change
-- beyond this: both already write thumbnail_url/thumbnail_storage_path as
-- `item->>'thumbnailUrl'` / `item->>'thumbnailStoragePath'`, which is simply
-- null when the client doesn't send those keys — exactly what a new video
-- post's media_input now looks like. Nothing in either function assumes a
-- video row has a non-null thumbnail.
--
-- Safely re-runnable.

alter table public.post_media
  drop constraint if exists post_media_video_requires_cover;
