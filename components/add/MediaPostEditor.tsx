"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import ComposerBottomBar from "@/components/add/ComposerBottomBar";
import ComposerTopBar from "@/components/add/ComposerTopBar";
import PerPhotoLocationFields from "@/components/add/PerPhotoLocationFields";
import PostLocationFields from "@/components/add/PostLocationFields";
import TagChipInput from "@/components/add/TagChipInput";
import TitleField from "@/components/add/TitleField";
import DemoPhoto from "@/components/DemoPhoto";
import { useAuth } from "@/lib/auth/AuthProvider";
import { convertHeicToJpeg, isHeicFile } from "@/lib/heic";
import { MAX_IMAGE_SOURCE_BYTES, prepareImageForUpload, type ImageDiagnostics } from "@/lib/imageOptimization";
import { measureImageAspectRatio } from "@/lib/postDisplay";
import { addPost, type NewPostMediaInput } from "@/lib/posts";
import { ALLOWED_MEDIA_TYPES, MAX_VIDEO_BYTES, deletePostMedia, uploadPostMedia } from "@/lib/storage";
import { generateVideoThumbnail } from "@/lib/videoThumbnail";
import type { MediaType } from "@/types/post";

type MediaPostEditorProps = {
  /** How the user entered this editor — decides which file picker flavor to auto-open. */
  initialSource: "album" | "camera" | null;
};

/** A photo post may hold 1–10 photos. Trivially adjustable later. */
const MAX_PHOTO_ITEMS = 10;
/** A video post holds exactly one video — never mixed with photos, never more than one. */
const MAX_VIDEO_ITEMS = 1;

/** A locally-selected, not-yet-uploaded media item. Distinct from the persisted `PostMedia`. */
type DraftMediaItem = {
  key: string;
  file: File;
  /** The filename as originally selected, before any HEIC→JPEG conversion — kept for diagnostics. */
  originalName: string;
  previewUrl: string;
  type: MediaType;
  /** Set for every image item (undefined for video) — see lib/imageOptimization.ts. */
  imageDiagnostics?: ImageDiagnostics;
  /** This photo's own optional map location — only ever set for image items,
   *  and only submitted when perPhotoLocationMode is on (see handleSubmit). */
  location?: { lat: number; lng: number };
};

/**
 * A post's media "mode" is never stored — it's derived from whatever's
 * already selected, exactly like `post_type` is derived from `media` on the
 * read side. Removing every item naturally returns this to neutral (`null`)
 * on the next computation; no reset code needed.
 */
type MediaMode = "photo" | "video" | null;

function modeFor(items: DraftMediaItem[]): MediaMode {
  return items.length === 0 ? null : items[0].type === "video" ? "video" : "photo";
}

/**
 * Wraps uploadPostMedia with a diagnostic console line identifying exactly
 * which selected file failed and why (original filename, whether it went
 * through HEIC conversion, mime type, size) — the thrown error itself already
 * names the file/size for the user; this is the extra detail useful for
 * correlating a real-device report against the console.
 */
async function uploadWithDiagnostics(item: DraftMediaItem, userId: string, draftId: string) {
  try {
    return await uploadPostMedia(item.file, userId, draftId);
  } catch (uploadErr) {
    console.error("Media upload failed:", {
      originalName: item.originalName,
      originalMimeType: item.imageDiagnostics?.originalMimeType ?? item.file.type,
      originalSizeBytes: item.imageDiagnostics?.originalSizeBytes ?? item.file.size,
      originalWidth: item.imageDiagnostics?.originalWidth,
      originalHeight: item.imageDiagnostics?.originalHeight,
      optimizedMimeType: item.file.type,
      optimizedSizeBytes: item.file.size,
      optimizedWidth: item.imageDiagnostics?.optimizedWidth,
      optimizedHeight: item.imageDiagnostics?.optimizedHeight,
      wasHeicConverted: item.imageDiagnostics?.wasHeicConverted ?? false,
      wasResized: item.imageDiagnostics?.wasResized ?? false,
      compressionApplied: item.imageDiagnostics?.compressionApplied ?? false,
      mediaType: item.type,
      draftId,
    });
    throw uploadErr;
  }
}

/** Shared by both the "Choose from album" and "Camera" entries in the Add action sheet. */
export default function MediaPostEditor({ initialSource }: MediaPostEditorProps) {
  const router = useRouter();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasAutoOpenedRef = useRef(false);
  const mediaItemsRef = useRef<DraftMediaItem[]>([]);

  const [title, setTitle] = useState("");
  const [mediaItems, setMediaItems] = useState<DraftMediaItem[]>([]);
  const [caption, setCaption] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [showOnMap, setShowOnMap] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [perPhotoLocationMode, setPerPhotoLocationMode] = useState(false);
  const [selectedLocationKeys, setSelectedLocationKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConvertingHeic, setIsConvertingHeic] = useState(false);

  const mode = modeFor(mediaItems);

  // Turning per-photo mode OFF — whether the user toggles it directly or
  // handleRemoveMedia collapses it for them below — must also drop any pins
  // already assigned, so "off" really means today's exact behavior, not
  // "off, but still secretly submitting per-photo pins."
  function turnOffPerPhotoLocationMode() {
    setPerPhotoLocationMode(false);
    setSelectedLocationKeys(new Set());
    setMediaItems((items) => items.map((item) => ({ ...item, location: undefined })));
  }

  // The master "Show this post on the map" switch — turning it off must also
  // exit per-photo mode and drop any per-photo pins, so no per-photo data
  // can survive hidden behind a location section that now looks fully off.
  function handleToggleShowOnMap() {
    setShowOnMap((prev) => {
      const next = !prev;
      if (!next) {
        turnOffPerPhotoLocationMode();
      }
      return next;
    });
  }

  function handleTogglePerPhotoLocationMode() {
    if (perPhotoLocationMode) {
      turnOffPerPhotoLocationMode();
      return;
    }
    // Per-photo mode is only ever reachable while "Show this post on the
    // map" is already on (it's nested inside that section) — never touch
    // showOnMap here, only the post-level coords it fully supersedes.
    setPerPhotoLocationMode(true);
    setCoords(null);
  }

  function handleTogglePhotoSelection(key: string) {
    setSelectedLocationKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Assigns one location to every currently selected photo at once. The
  // selection deliberately stays active afterward — dragging the same pin
  // again re-applies to the same batch, and the picker stays open — until
  // the user explicitly changes which photos are selected.
  function handleSetLocationForSelectedPhotos(location: { lat: number; lng: number }) {
    setMediaItems((prev) => prev.map((item) => (selectedLocationKeys.has(item.key) ? { ...item, location } : item)));
  }

  function handleClearLocationForSelectedPhotos() {
    setMediaItems((prev) =>
      prev.map((item) => (selectedLocationKeys.has(item.key) ? { ...item, location: undefined } : item)),
    );
  }

  // Keeps the latest media items available to the unmount-only cleanup effect
  // below without making that effect depend on (and re-run per) every change.
  useEffect(() => {
    mediaItemsRef.current = mediaItems;
  }, [mediaItems]);

  // Revokes every object URL still outstanding when the editor unmounts.
  // Removing an item revokes its own URL immediately (see handleRemoveMedia),
  // so by the time this runs it only ever sees URLs that weren't already
  // revoked — no double-revoke.
  useEffect(() => {
    return () => {
      for (const item of mediaItemsRef.current) {
        URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, []);

  // Auto-open the picker once on arrival, matching how the user got here from
  // the action sheet — doesn't request camera permission itself; the browser's
  // own file-picker UI decides whether/how to offer the camera.
  useEffect(() => {
    if (hasAutoOpenedRef.current) return;
    if (initialSource === "album" || initialSource === "camera") {
      hasAutoOpenedRef.current = true;
      fileInputRef.current?.click();
    }
  }, [initialSource]);

  async function handleMediaChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ""; // allow re-selecting the same file(s) later
    if (files.length === 0) return; // user canceled the picker — leave the editor as it was

    setError(null);

    // Recomputed per-batch, then locked in the moment the batch's first valid
    // item is accepted (not merely attempted) — see modeFor's doc comment.
    let currentMode = mode;
    let queuedPhotoCount = mode === "photo" ? mediaItems.length : 0;
    let queuedVideoCount = mode === "video" ? 1 : 0;
    const newItems: DraftMediaItem[] = [];
    let modeConflictMessage: string | null = null;
    let overflowCount = 0;
    let rejectedCount = 0;
    let processingFailedCount = 0;

    for (const file of files) {
      const isVideo = file.type.startsWith("video/");
      const candidateType: MediaType = isVideo ? "video" : "image";

      // Product-rule (mode) check first — before wasting HEIC/size work on a
      // file that can't be accepted regardless of its own validity. Both
      // directions of "wrong type for the locked mode" are rejected the same
      // way as "this type's slot is already full" — a video post's single
      // slot (MAX_VIDEO_ITEMS) filled is indistinguishable from "no photos
      // allowed here" from the user's point of view.
      if (currentMode === "photo" && candidateType === "video") {
        modeConflictMessage ??= "Photo posts can contain photos only.";
        continue;
      }
      if (currentMode === "video" && candidateType === "image") {
        modeConflictMessage ??= "Video posts can contain only one video.";
        continue;
      }
      if (candidateType === "video" && queuedVideoCount >= MAX_VIDEO_ITEMS) {
        modeConflictMessage ??= "Video posts can contain only one video.";
        continue;
      }
      if (candidateType === "image" && queuedPhotoCount >= MAX_PHOTO_ITEMS) {
        overflowCount += 1;
        continue;
      }

      const isHeicSource = !isVideo && isHeicFile(file);

      if (!isHeicSource && !ALLOWED_MEDIA_TYPES.includes(file.type as (typeof ALLOWED_MEDIA_TYPES)[number])) {
        rejectedCount += 1;
        continue;
      }

      // Images (HEIC included) share one unified source-safety ceiling — a
      // guard against absurd files/memory use, not a quality target. See
      // lib/imageOptimization.ts for the optimization target and dimension
      // cap that do the actual size-shaping work. Video keeps its own,
      // unrelated ceiling.
      const maxSourceBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_SOURCE_BYTES;
      if (file.size > maxSourceBytes) {
        rejectedCount += 1;
        continue;
      }

      let fileToUse = file;
      let imageDiagnostics: ImageDiagnostics | undefined;

      if (isHeicSource) {
        setIsConvertingHeic(true);
        try {
          fileToUse = await convertHeicToJpeg(file);
        } catch {
          rejectedCount += 1;
          setIsConvertingHeic(false);
          continue;
        }
        setIsConvertingHeic(false);
      }

      if (!isVideo) {
        try {
          const prepared = await prepareImageForUpload(fileToUse, isHeicSource);
          fileToUse = prepared.file;
          imageDiagnostics = prepared.diagnostics;
        } catch {
          processingFailedCount += 1;
          continue;
        }
      }

      newItems.push({
        key: crypto.randomUUID(),
        file: fileToUse,
        originalName: file.name,
        previewUrl: URL.createObjectURL(fileToUse),
        type: candidateType,
        imageDiagnostics,
      });

      if (candidateType === "video") {
        queuedVideoCount += 1;
        currentMode = "video";
      } else {
        queuedPhotoCount += 1;
        currentMode ??= "photo";
      }
    }

    if (newItems.length > 0) {
      setMediaItems((prev) => [...prev, ...newItems]);
    }

    const messages: string[] = [];
    if (modeConflictMessage) messages.push(modeConflictMessage);
    if (overflowCount > 0) {
      messages.push(
        `You can add up to ${MAX_PHOTO_ITEMS} photos per post — ${overflowCount} file${overflowCount === 1 ? " was" : "s were"} not added.`,
      );
    }
    if (rejectedCount > 0) {
      messages.push(
        `${rejectedCount} file${rejectedCount === 1 ? " couldn't" : "s couldn't"} be added — check file type and size (JPEG/PNG/WEBP/AVIF/HEIC photos, MP4/WEBM/MOV videos).`,
      );
    }
    if (processingFailedCount > 0) {
      messages.push(
        `${processingFailedCount} photo${processingFailedCount === 1 ? " couldn't" : "s couldn't"} be processed.`,
      );
    }
    if (messages.length > 0) setError(messages.join(" "));
  }

  function handleRemoveMedia(key: string) {
    const item = mediaItems.find((i) => i.key === key);
    if (item) URL.revokeObjectURL(item.previewUrl);
    const remaining = mediaItems.filter((i) => i.key !== key);

    // Per-photo mode only makes sense with >1 photo — collapse back to the
    // single-location editor the moment that stops being true, mirroring
    // modeFor's "removing every item returns to neutral" convention already
    // used in this file.
    if (perPhotoLocationMode && remaining.length <= 1) {
      setSelectedLocationKeys(new Set());
      setPerPhotoLocationMode(false);
      setMediaItems(remaining.map((i) => ({ ...i, location: undefined })));
      return;
    }

    // A removed photo can no longer be "selected" — drop it from the batch
    // rather than leaving a phantom entry pointing at nothing.
    setSelectedLocationKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setMediaItems(remaining);
  }

  function handleMoveMedia(key: string, direction: -1 | 1) {
    setMediaItems((prev) => {
      const index = prev.findIndex((i) => i.key === key);
      if (index === -1) return prev;
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;

      const next = prev.slice();
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // If the session drops mid-edit, RequireAuth swaps this whole page to
    // LoginScreen on its own — this guard just protects the submit itself.
    if (!user) return;

    if (!title.trim() || !caption.trim()) {
      setError("Add a title and caption before publishing.");
      return;
    }

    if (mediaItems.length === 0) {
      setError("Choose at least one photo or video before publishing.");
      return;
    }

    if (!perPhotoLocationMode && showOnMap && !coords) {
      setError("Choose a location on the map before publishing.");
      return;
    }

    setIsSubmitting(true);

    // One draft id per publish attempt, groups this post's media under a
    // single Storage folder — see uploadPostMedia.
    const draftId = crypto.randomUUID();
    const uploadedPaths: string[] = [];

    try {
      const media: NewPostMediaInput[] = [];

      // Sequential, not parallel: with a small max item count, this keeps
      // rollback bookkeeping trivial — uploadedPaths always reflects exactly
      // what succeeded so far the instant anything fails.
      for (let index = 0; index < mediaItems.length; index += 1) {
        const item = mediaItems[index];
        // Images already know their real (post-optimization) dimensions from
        // the pipeline — no need to re-decode via measureImageAspectRatio.
        // That helper is kept only as a defensive fallback for the
        // unexpected case imageDiagnostics is somehow missing.
        const aspectRatio =
          item.type === "video"
            ? "4/5"
            : item.imageDiagnostics
              ? `${item.imageDiagnostics.optimizedWidth}/${item.imageDiagnostics.optimizedHeight}`
              : await measureImageAspectRatio(item.previewUrl);
        const { url, path } = await uploadWithDiagnostics(item, user.id, draftId);
        uploadedPaths.push(path);

        let thumbnailUrl: string | undefined;
        if (item.type === "video") {
          // Best-effort only: a failure here must never block publishing the
          // video itself — it just falls back to the existing play-glyph
          // marker, same as any video published before thumbnails existed.
          try {
            const thumbnailBlob = await generateVideoThumbnail(item.file);
            const thumbnailFile = new File([thumbnailBlob], "thumbnail.jpg", { type: "image/jpeg" });
            const uploadedThumbnail = await uploadPostMedia(thumbnailFile, user.id, draftId);
            uploadedPaths.push(uploadedThumbnail.path);
            thumbnailUrl = uploadedThumbnail.url;
          } catch (thumbnailErr) {
            console.error("Video thumbnail generation failed (publishing without one):", thumbnailErr);
          }
        }

        media.push({
          type: item.type,
          url,
          storagePath: path,
          aspectRatio,
          position: index,
          thumbnailUrl,
          latitude: perPhotoLocationMode ? item.location?.lat : undefined,
          longitude: perPhotoLocationMode ? item.location?.lng : undefined,
        });
      }

      await addPost({
        title: title.trim(),
        caption: caption.trim(),
        tags,
        rating: 0,
        ratingCount: "New",
        // Per-photo mode fully supersedes the post-level location — never
        // submit both for the same post (avoids double-plotting it on the Map).
        showOnMap: perPhotoLocationMode ? false : showOnMap,
        latitude: perPhotoLocationMode ? undefined : showOnMap ? coords?.lat : undefined,
        longitude: perPhotoLocationMode ? undefined : showOnMap ? coords?.lng : undefined,
        userId: user.id,
        media,
      });

      router.replace("/me");
    } catch (err) {
      if (uploadedPaths.length > 0) {
        const failedCleanupPaths: string[] = [];
        for (const path of uploadedPaths) {
          try {
            await deletePostMedia(path);
          } catch {
            failedCleanupPaths.push(path);
          }
        }
        if (failedCleanupPaths.length > 0) {
          setError(
            "Publishing failed, and some uploaded files couldn't be cleaned up automatically. Please try again or contact support if this keeps happening.",
          );
          setIsSubmitting(false);
          return;
        }
      }
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setIsSubmitting(false);
    }
  }

  const showAddMoreTile = mode !== "video" && mediaItems.length < MAX_PHOTO_ITEMS;

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-28 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <ComposerTopBar />

      <form onSubmit={handleSubmit} className="space-y-5 px-5 pt-4">
        <div>
          <input
            ref={fileInputRef}
            id="media"
            type="file"
            multiple
            accept={`${ALLOWED_MEDIA_TYPES.join(",")},image/heic,image/heif,.heic,.heif`}
            capture={initialSource === "camera" ? "environment" : undefined}
            onChange={handleMediaChange}
            className="hidden"
          />

          {mediaItems.length === 0 ? (
            isConvertingHeic ? (
              <div
                aria-live="polite"
                className="grid size-24 place-items-center rounded-2xl border border-dashed border-stone-300 bg-white text-center text-[10px] font-semibold text-stone-400"
              >
                Converting…
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Add a photo or video"
                className="grid size-24 place-items-center rounded-2xl border border-dashed border-stone-300 bg-white text-2xl text-stone-400"
              >
                +
              </button>
            )
          ) : (
            <>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {mediaItems.map((item, index) => (
                  <div key={item.key} className="relative size-24 shrink-0">
                    <div className="size-24 overflow-hidden rounded-2xl">
                      {item.type === "video" ? (
                        <video src={item.previewUrl} muted playsInline className="size-full object-cover" />
                      ) : (
                        <DemoPhoto src={item.previewUrl} alt={`Media ${index + 1}`} className="size-full" />
                      )}
                    </div>

                    {index === 0 ? (
                      <span className="absolute left-1 top-1 rounded-full bg-stone-900/80 px-1.5 py-0.5 text-[9px] font-bold text-white">
                        Cover
                      </span>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => handleRemoveMedia(item.key)}
                      aria-label="Remove media"
                      className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-stone-900 text-[10px] text-white"
                    >
                      ×
                    </button>

                    <div className="absolute inset-x-1 bottom-1 flex justify-between">
                      <button
                        type="button"
                        onClick={() => handleMoveMedia(item.key, -1)}
                        disabled={index === 0}
                        aria-label="Move left"
                        className="grid size-5 place-items-center rounded-full bg-white/90 text-[10px] font-bold text-stone-700 shadow disabled:invisible"
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveMedia(item.key, 1)}
                        disabled={index === mediaItems.length - 1}
                        aria-label="Move right"
                        className="grid size-5 place-items-center rounded-full bg-white/90 text-[10px] font-bold text-stone-700 shadow disabled:invisible"
                      >
                        ›
                      </button>
                    </div>
                  </div>
                ))}

                {showAddMoreTile ? (
                  isConvertingHeic ? (
                    <div
                      aria-live="polite"
                      className="grid size-24 shrink-0 place-items-center rounded-2xl border border-dashed border-stone-300 bg-white text-center text-[10px] font-semibold text-stone-400"
                    >
                      Converting…
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      aria-label="Add more media"
                      className="grid size-24 shrink-0 place-items-center rounded-2xl border border-dashed border-stone-300 bg-white text-2xl text-stone-400"
                    >
                      +
                    </button>
                  )
                ) : null}
              </div>

              {mode === "video" ? (
                <p className="mt-1.5 text-[11px] text-stone-400">
                  Remove the current video before adding photos.
                </p>
              ) : null}
            </>
          )}
        </div>

        <TitleField value={title} onChange={setTitle} />

        <textarea
          id="caption"
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          rows={6}
          placeholder="Share something…"
          className="w-full resize-none border-none bg-transparent text-base leading-relaxed text-stone-900 outline-none placeholder:text-stone-400"
        />

        <TagChipInput tags={tags} onTagsChange={setTags} />

        {/* "More than one location?" is nested inside PostLocationFields' own
            showOnMap section (via children) so it — and everything below it —
            only ever appears while "Show this post on the map" is on. */}
        <PostLocationFields
          showOnMap={showOnMap}
          onToggleShowOnMap={handleToggleShowOnMap}
          coords={coords}
          onCoordsChange={setCoords}
          hidePicker={perPhotoLocationMode}
        >
          {mode === "photo" && mediaItems.length > 1 ? (
            <>
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-kavanaka-aqua/10 px-4 py-3">
                <div>
                  <p className="text-[12px] font-semibold text-kavanaka-aqua">More than one location?</p>
                  <p className="mt-0.5 text-[11px] text-stone-600">Set locations for individual photos.</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={perPhotoLocationMode}
                  aria-label="Turn per-photo locations on or off"
                  onClick={handleTogglePerPhotoLocationMode}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                    perPhotoLocationMode ? "bg-kavanaka-aqua" : "bg-stone-200"
                  }`}
                >
                  <span
                    className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                      perPhotoLocationMode ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {perPhotoLocationMode ? (
                <PerPhotoLocationFields
                  photos={mediaItems}
                  selectedKeys={selectedLocationKeys}
                  onTogglePhoto={handleTogglePhotoSelection}
                  onSetLocationForSelected={handleSetLocationForSelectedPhotos}
                  onClearLocationForSelected={handleClearLocationForSelectedPhotos}
                />
              ) : null}
            </>
          ) : null}
        </PostLocationFields>

        <ComposerBottomBar isSubmitting={isSubmitting} error={error} />
      </form>
    </main>
  );
}
