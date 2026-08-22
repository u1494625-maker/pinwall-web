import { withTimeout } from "@/lib/asyncUtils";
import { supabase } from "@/lib/supabase/client";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
/** `https://<project-ref>.supabase.co` -> `<project-ref>` — used only to build
 *  the resumable-upload hostname below. */
const SUPABASE_PROJECT_REF = SUPABASE_URL.replace(/^https?:\/\//, "").split(".")[0];

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
export const MAX_VIDEO_BYTES = 300 * 1024 * 1024; // 300MB

/** Photos and video cover images. */
export const POST_IMAGE_BUCKET = "post-image";
/** Video files only — never covers, never photos. See supabase/post_video_bucket.sql. */
export const POST_VIDEO_BUCKET = "post-video";
export type StorageBucket = typeof POST_IMAGE_BUCKET | typeof POST_VIDEO_BUCKET;

// A single-shot upload (a photo, or a video's cover image) should be quick —
// if the underlying fetch stalls with no response at all, this guarantees the
// caller sees a clear error instead of hanging on "Uploading…" forever. Not
// applied to uploadVideoResumable: a large video's TUS transfer can
// legitimately take a long time while still making real progress, so an
// outer timeout there would abort a slow-but-healthy upload — that path
// already has its own robust retry/resume logic instead (see below).
const SINGLE_SHOT_UPLOAD_TIMEOUT_MS = 30000;

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

  const { error: uploadError } = await withTimeout(
    supabase.storage.from(POST_IMAGE_BUCKET).upload(path, file, { contentType: file.type }),
    SINGLE_SHOT_UPLOAD_TIMEOUT_MS,
    `"${file.name}" couldn't be uploaded — the connection stalled. Check your connection and try again.`,
  );

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

  const { data } = supabase.storage.from(POST_IMAGE_BUCKET).getPublicUrl(path);

  if (!data?.publicUrl) {
    throw new Error("Failed to get a public URL for the uploaded file.");
  }

  return { url: data.publicUrl, path };
}

export type ResumableUploadCallbacks = {
  /** Fraction 0–1, called as chunks are acknowledged by the server. */
  onProgress?: (fraction: number) => void;
  /** Aborting sends a real termination request to Supabase (shouldTerminate
   *  = true) rather than just stopping locally, so an interrupted/cancelled
   *  video doesn't leave a resumable session hanging server-side. */
  signal?: AbortSignal;
};

/**
 * Uploads a video via Supabase Storage's resumable (TUS) endpoint instead of
 * uploadPostMedia's single-shot PUT — into the dedicated `post-video` bucket
 * (never post-image), same path scheme, same ownership-scoped RLS shape
 * (see supabase/post_video_bucket.sql; "Users can upload into their own
 * post-video folder" is bucket+path scoped, not upload-method scoped —
 * confirmed live against this project, for the equivalent post-image policy,
 * before writing this function: an unauthenticated request is rejected at
 * the JWT stage, and a request bearing only the anon key correctly fails
 * RLS with "new row violates row-level security policy," exactly like the
 * existing upload path). Only the transport differs, so a large file can
 * survive a temporary network drop: tus-js-client's own retryDelays resume
 * the SAME in-memory Upload instance from the server-acknowledged offset
 * automatically. This deliberately does not persist upload state across a
 * reload/tab close (no findPreviousUploads/localStorage fingerprint) — that
 * is out of scope for this version; see lib/composerDraft.ts's own doc
 * comment for why.
 *
 * Endpoint host, the fixed 6MB chunk size, the metadata key names, and
 * retryDelays all match Supabase's current resumable-upload documentation
 * verbatim — chunkSize specifically is documented as a hard requirement,
 * not a tunable.
 */
export async function uploadVideoResumable(
  file: File,
  userId: string,
  draftId: string,
  { onProgress, signal }: ResumableUploadCallbacks = {},
): Promise<UploadedMedia> {
  const path = `${userId}/${draftId}/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new Error("You need to be signed in to upload a video.");
  }

  // Dynamically imported so the TUS client is only fetched when a video is
  // actually being uploaded — matches this codebase's existing pattern for
  // other client-only heavy libraries (leaflet, heic-to).
  const { Upload, DetailedError } = await import("tus-js-client");

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const upload = new Upload(file, {
      endpoint: `https://${SUPABASE_PROJECT_REF}.storage.supabase.co/storage/v1/upload/resumable`,
      headers: {
        authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "x-upsert": "false",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      chunkSize: 6 * 1024 * 1024,
      metadata: {
        bucketName: POST_VIDEO_BUCKET,
        objectName: path,
        contentType: file.type || "video/mp4",
        cacheControl: "3600",
      },
      onError: (error) => {
        if (settled) return;
        settled = true;
        // A DetailedError with no originalResponse means the request never
        // got a reply at all (connection dropped) — retryDelays already
        // exhausted its own attempts by the time this fires. Anything with
        // a real response is Supabase actually rejecting the upload.
        const isNetworkFailure = error instanceof DetailedError && !error.originalResponse;
        const reason = isNetworkFailure
          ? "the network connection was interrupted during upload. Check your connection and try again."
          : `${error.message}.`;
        reject(new Error(`"${file.name}" couldn't be uploaded — ${reason}`));
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        if (bytesTotal > 0) onProgress?.(bytesUploaded / bytesTotal);
      },
      onSuccess: () => {
        if (settled) return;
        settled = true;
        resolve();
      },
    });

    if (signal) {
      if (signal.aborted) {
        settled = true;
        upload.abort(true).catch(() => {});
        reject(new Error("Upload cancelled."));
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          if (settled) return;
          settled = true;
          upload.abort(true).catch(() => {});
          reject(new Error("Upload cancelled."));
        },
        { once: true },
      );
    }

    upload.start();
  });

  const { data } = supabase.storage.from(POST_VIDEO_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) {
    throw new Error("Failed to get a public URL for the uploaded file.");
  }

  return { url: data.publicUrl, path };
}

/**
 * Best-effort cleanup for an upload left orphaned by a failed database
 * insert, or removal of a superseded/deleted file. `bucket` is required
 * (never defaulted) — a photo/cover path belongs in POST_IMAGE_BUCKET, a
 * video file's path belongs in POST_VIDEO_BUCKET, and getting this wrong
 * either silently fails to delete the real file or, worse, could target the
 * wrong object if the same relative path ever existed in both buckets.
 */
export async function deletePostMedia(path: string, bucket: StorageBucket): Promise<void> {
  const { error } = await supabase.storage.from(bucket).remove([path]);

  if (error) {
    throw new Error(`Failed to remove uploaded file: ${error.message}`);
  }
}

/**
 * Uploads a cropped profile image (avatar or background) to a FIXED path per
 * user per kind — `${userId}/profile/avatar.jpg` / `.../background.jpg` —
 * with `upsert: true`, so replacing an image overwrites the previous one in
 * place. Unlike uploadPostMedia's unique-path-per-file scheme (where a
 * collision would be a bug), a profile image deliberately always replaces
 * the last one: there is never an orphaned old file to separately clean up.
 * The returned URL carries a cache-busting query param (the underlying
 * Storage path never changes, so without this a browser/CDN could keep
 * serving the previous image after a replace).
 */
export async function uploadProfileImage(file: Blob, userId: string, kind: "avatar" | "background"): Promise<string> {
  const path = `${userId}/profile/${kind}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from(POST_IMAGE_BUCKET)
    .upload(path, file, { contentType: "image/jpeg", upsert: true });

  if (uploadError) {
    throw new Error(`Couldn't upload your ${kind} image — ${uploadError.message}.`);
  }

  const { data } = supabase.storage.from(POST_IMAGE_BUCKET).getPublicUrl(path);

  if (!data?.publicUrl) {
    throw new Error(`Failed to get a public URL for the uploaded ${kind} image.`);
  }

  return `${data.publicUrl}?v=${Date.now()}`;
}
