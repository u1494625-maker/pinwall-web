import { supabase } from "@/lib/supabase/client";

// GIF is not a supported photo format — no animated-image handling exists
// anywhere in this app, so it's excluded here rather than silently accepted
// and then mishandled.
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;

// video/quicktime (.mov) is commonly produced by iPhone cameras. Safari/iOS play it
// natively; Chrome/Firefox support depends on the file's internal codec (H.264 is fine,
// HEVC often isn't). That's a browser/codec limitation, not something fixable here
// without server-side transcoding, which is out of scope.
export const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;

export const ALLOWED_MEDIA_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES] as const;

// Photo sizing is no longer a flat byte ceiling — see lib/imageOptimization.ts
// for the source-safety limit, optimization target, and dimension cap that
// replace what used to be a single MAX_IMAGE_BYTES here.
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

/**
 * Uploads a file into the calling user's own folder in the `post-image` bucket,
 * grouped under `draftId` (one per post being composed) so a post's media all
 * lives under one prefix. `draftId` is generated client-side (crypto.randomUUID())
 * before the post row exists — Storage RLS only checks the first path segment
 * (the user id), so a client-generated id here is exactly as valid as a DB id.
 */
export async function uploadPostMedia(file: File, userId: string, draftId: string): Promise<UploadedMedia> {
  const path = `${userId}/${draftId}/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, { contentType: file.type });

  if (uploadError) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    // storage-js wraps a real Supabase Storage response as StorageApiError (a
    // specific, meaningful message — size/MIME/policy rejection); anything
    // else — a bare fetch() rejection with no response at all, e.g. a dropped
    // mobile connection — comes back as StorageUnknownError. Worth telling
    // apart: one means "Supabase rejected this," the other means "the request
    // never made it," and the fix for each is completely different.
    const isNetworkFailure = uploadError.name === "StorageUnknownError";
    const reason = isNetworkFailure
      ? "the network connection was interrupted during upload. Check your connection and try again."
      : `${uploadError.message}.`;
    throw new Error(`"${file.name}" (${sizeMb}MB) couldn't be uploaded — ${reason}`);
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
