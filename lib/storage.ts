import { supabase } from "@/lib/supabase/client";

export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

// video/quicktime (.mov) is commonly produced by iPhone cameras. Safari/iOS play it
// natively; Chrome/Firefox support depends on the file's internal codec (H.264 is fine,
// HEVC often isn't). That's a browser/codec limitation, not something fixable here
// without server-side transcoding, which is out of scope.
export const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;

export const ALLOWED_MEDIA_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES] as const;

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50MB

const STORAGE_BUCKET = "post-image";

function sanitizeFileName(fileName: string): string {
  return fileName.trim().toLowerCase().replace(/[^a-z0-9.]+/g, "-");
}

export type UploadedMedia = {
  /** Public URL to store on the post row and render in the app. */
  url: string;
  /** Storage object path, kept so a failed DB insert can clean up the upload via deletePostMedia(). */
  path: string;
};

/** Uploads a file into the calling user's own folder in the `post-image` bucket. */
export async function uploadPostMedia(file: File, userId: string): Promise<UploadedMedia> {
  const path = `${userId}/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, { contentType: file.type });

  if (uploadError) {
    throw new Error(`Failed to upload file: ${uploadError.message}`);
  }

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);

  if (!data?.publicUrl) {
    throw new Error("Failed to get a public URL for the uploaded file.");
  }

  return { url: data.publicUrl, path };
}

/** Best-effort cleanup for an upload left orphaned by a failed database insert. */
export async function deletePostMedia(path: string): Promise<void> {
  const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([path]);

  if (error) {
    throw new Error(`Failed to remove uploaded file: ${error.message}`);
  }
}

/**
 * Derives a `post-image` bucket object path from a stored Supabase public URL, so a
 * post's media can be deleted without a separate stored-path column. Returns null
 * (never throws) for anything that isn't a recognizable public URL for this bucket —
 * callers must treat that as "nothing safe to delete", not silently proceed.
 */
export function getStoragePathFromPublicUrl(url: string): string | null {
  const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index === -1) return null;

  const rawPath = url.slice(index + marker.length).split(/[?#]/)[0];
  if (!rawPath) return null;

  try {
    return decodeURIComponent(rawPath);
  } catch {
    return null;
  }
}
