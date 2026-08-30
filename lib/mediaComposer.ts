"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { convertHeicToJpeg, isHeicFile } from "@/lib/heic";
import { MAX_IMAGE_SOURCE_BYTES, prepareImageForUpload, type ImageDiagnostics } from "@/lib/imageOptimization";
import { ALLOWED_MEDIA_TYPES, ALLOWED_VIDEO_TYPES, MAX_VIDEO_BYTES } from "@/lib/storage";
import type { MediaType } from "@/types/post";

/** A photo post may hold 1–10 photos. Trivially adjustable later. */
export const MAX_PHOTO_ITEMS = 10;
/** A video post holds exactly one video — never mixed with photos, never more than one. */
export const MAX_VIDEO_ITEMS = 1;

/** Known video file extensions, used only as a fallback when file.type is
 *  empty/ambiguous — see detectMediaType below. Exported so the <input
 *  accept> string (MediaComposerFields.tsx) stays in sync with what this
 *  module actually recognizes, rather than duplicating the list. */
export const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm"];

function hasVideoExtension(fileName: string): boolean {
  const name = fileName.toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/**
 * iOS Safari (and some other mobile browsers) can hand back a File with an
 * empty or generic `type` for a video picked from the Photos library —
 * especially .MOV. Trusting file.type alone for classification silently
 * mistakes these for images, which then hit the image-decode pipeline
 * instead of the video path and never surface a clear error. MIME is
 * trusted first; only when it doesn't clearly say "video/*" or "image/*" do
 * we fall back to the filename extension — and only for extensions we
 * actually know are video. Anything else still defaults to "image" (same as
 * before this fix) rather than being guessed as video.
 */
function detectMediaType(file: File): MediaType {
  const mime = file.type.toLowerCase();
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  return hasVideoExtension(file.name) ? "video" : "image";
}

/**
 * One media item in the composer's ordered list — either an already-
 * persisted photo (kept as-is, possibly moved and/or relocated) or a
 * locally-selected, not-yet-uploaded file. Both carry the same `location`
 * field, and reordering (handleMoveMedia) only ever moves whole array
 * elements — a photo's id/location/image always travel together as one
 * object, never tracked in a separate index-keyed structure.
 */
export type MediaComposerItem =
  | {
      key: string;
      kind: "existing";
      id: number;
      type: MediaType;
      previewUrl: string;
      storagePath: string;
      aspectRatio: string | null;
      thumbnailUrl?: string;
      location?: { lat: number; lng: number };
    }
  | {
      key: string;
      kind: "new";
      type: MediaType;
      previewUrl: string;
      file: File;
      originalName: string;
      imageDiagnostics?: ImageDiagnostics;
      location?: { lat: number; lng: number };
    };

export type ExistingMediaSeed = {
  id: number;
  type: MediaType;
  url: string;
  storagePath: string;
  aspectRatio: string | null;
  thumbnailUrl?: string;
  location?: { lat: number; lng: number };
};

/**
 * A video post's single video file — tracked as its own slot, never as an
 * array element like photos (a video post always has exactly one). "existing"
 * is only ever seeded by EditVideoPostFields (the server's current file);
 * "new" is a locally-selected replacement not yet uploaded. Removing a
 * staged "new" replacement reverts to the original "existing" seed (see
 * useMediaComposer's handleRemoveVideo) — a video post can never be left
 * with none at all once one has been chosen.
 */
export type VideoAsset =
  | { kind: "existing"; url: string; storagePath: string }
  | { kind: "new"; file: File; previewUrl: string };

/**
 * A post's media "mode" is never stored — it's derived from whatever's
 * already selected, exactly like `post_type` is derived from `media` on the
 * read side. Removing every item naturally returns this to neutral (`null`)
 * on the next computation; no reset code needed.
 */
export type MediaMode = "photo" | "video" | null;

function modeFor(items: MediaComposerItem[], video: VideoAsset | null): MediaMode {
  if (items.length > 0) return "photo";
  if (video) return "video";
  return null;
}

function seedToItem(seed: ExistingMediaSeed): MediaComposerItem {
  return {
    key: `existing-${seed.id}`,
    kind: "existing",
    id: seed.id,
    type: seed.type,
    previewUrl: seed.url,
    storagePath: seed.storagePath,
    aspectRatio: seed.aspectRatio,
    thumbnailUrl: seed.thumbnailUrl,
    location: seed.location,
  };
}

export type UseMediaComposerOptions = {
  initialItems?: ExistingMediaSeed[];
  initialShowOnMap?: boolean;
  initialCoords?: { lat: number; lng: number } | null;
  /** Defaults to true if any seeded item already has its own location — the
   *  editor should open already reflecting per-photo mode rather than
   *  silently hiding existing per-photo pins behind a toggle that reads off. */
  initialPerPhotoLocationMode?: boolean;
  /** Seeds a video-post edit with the server's current video — omitted
   *  entirely for create (starts null) and for a photo post. */
  initialVideo?: VideoAsset;
};

/**
 * All media + map-location state and handlers shared by MediaPostEditor
 * (create) and EditPostForm's photo-edit path — lifted verbatim out of
 * MediaPostEditor so neither duplicates the file-validation/HEIC/
 * optimization pipeline, the add/remove/reorder logic, or the per-photo
 * location assignment logic. The only thing that differs between callers is
 * how the initial item list is seeded (empty for create, from an existing
 * post's media for edit) and what happens on submit — both stay in the
 * calling component.
 */
export function useMediaComposer({
  initialItems = [],
  initialShowOnMap = false,
  initialCoords = null,
  initialPerPhotoLocationMode,
  initialVideo,
}: UseMediaComposerOptions = {}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const mediaItemsRef = useRef<MediaComposerItem[]>([]);
  const videoRef = useRef<VideoAsset | null>(null);

  const [mediaItems, setMediaItems] = useState<MediaComposerItem[]>(() => initialItems.map(seedToItem));
  const [showOnMap, setShowOnMap] = useState(initialShowOnMap);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(initialCoords);
  const [perPhotoLocationMode, setPerPhotoLocationMode] = useState(
    initialPerPhotoLocationMode ?? initialItems.some((item) => item.location != null),
  );
  const [selectedLocationKeys, setSelectedLocationKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isConvertingHeic, setIsConvertingHeic] = useState(false);

  // The seed to revert to when a staged "new" replacement is removed — null
  // for create (nothing to revert to, removal just clears the slot), the
  // server's original asset for edit. Captured once; never recomputed, so a
  // replacement staged earlier in the session always reverts to the SAME
  // original even after several replace/remove cycles.
  const [video, setVideo] = useState<VideoAsset | null>(initialVideo ?? null);
  const initialVideoRef = useRef<VideoAsset | null>(initialVideo ?? null);

  const mode = modeFor(mediaItems, video);

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

  // Keeps the latest media items/video available to the unmount-only cleanup
  // effect below without making that effect depend on (and re-run per) every
  // change.
  useEffect(() => {
    mediaItemsRef.current = mediaItems;
  }, [mediaItems]);
  useEffect(() => {
    videoRef.current = video;
  }, [video]);

  // Revokes every object URL still outstanding when the composer unmounts.
  // Only ever meaningful for "new" items/video (an "existing" one's
  // previewUrl/url is a real remote URL, never a blob: URL) — revoking a
  // non-blob URL is a harmless no-op regardless, but this is scoped precisely
  // on purpose. Removing an item revokes its own URL immediately (see
  // handleRemoveMedia/handleRemoveVideo), so by the time this runs it only
  // ever sees URLs that weren't already revoked — no double-revoke.
  useEffect(() => {
    return () => {
      for (const item of mediaItemsRef.current) {
        if (item.kind === "new") URL.revokeObjectURL(item.previewUrl);
      }
      if (videoRef.current?.kind === "new") URL.revokeObjectURL(videoRef.current.previewUrl);
    };
  }, []);

  // The single processing pipeline for any newly selected photo/video batch,
  // regardless of source — the real <input>'s onChange (below) and a camera
  // File handed off from AddPostActionSheet (see MediaPostEditor) both
  // funnel through this one function, so mode-locking, HEIC conversion,
  // optimization, size limits, and error messaging are never duplicated.
  async function handleMediaFiles(inputFiles: File[] | FileList) {
    const files = Array.from(inputFiles);
    if (files.length === 0) return; // nothing to process — leave the editor as it was

    setError(null);

    // Recomputed per-batch, then locked in the moment the batch's first valid
    // item is accepted (not merely attempted) — see modeFor's doc comment.
    let currentMode = mode;
    let queuedPhotoCount = mode === "photo" ? mediaItems.length : 0;
    let queuedVideoCount = mode === "video" ? 1 : 0;
    const newItems: MediaComposerItem[] = [];
    // A video file never becomes a mediaItems array element — it's routed
    // into the dedicated `video` slot instead (see VideoAsset's doc comment).
    // At most one can ever be accepted per batch (MAX_VIDEO_ITEMS), enforced
    // by the same queuedVideoCount check below as before.
    let acceptedVideoFile: File | null = null;
    let modeConflictMessage: string | null = null;
    let overflowCount = 0;
    let unsupportedVideoCount = 0;
    let unsupportedPhotoCount = 0;
    let videoTooLargeCount = 0;
    let photoTooLargeCount = 0;
    let processingFailedCount = 0;

    for (const file of files) {
      const candidateType = detectMediaType(file);
      const isVideo = candidateType === "video";

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

      // MIME is the normal path; a video whose MIME came back empty/generic
      // but whose filename has a known video extension (the iOS Safari .MOV
      // case detectMediaType already recognized above) is still validated
      // as a legitimate, supported video rather than rejected for lacking a
      // MIME match it was never going to have.
      const mimeRecognized = ALLOWED_MEDIA_TYPES.includes(file.type as (typeof ALLOWED_MEDIA_TYPES)[number]);
      const videoRecognizedByExtension = isVideo && !mimeRecognized && hasVideoExtension(file.name);

      if (!isHeicSource && !mimeRecognized && !videoRecognizedByExtension) {
        if (isVideo) unsupportedVideoCount += 1;
        else unsupportedPhotoCount += 1;
        continue;
      }

      // Images (HEIC included) share one unified source-safety ceiling — a
      // guard against absurd files/memory use, not a quality target. See
      // lib/imageOptimization.ts for the optimization target and dimension
      // cap that do the actual size-shaping work. Video keeps its own,
      // unrelated ceiling.
      const maxSourceBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_SOURCE_BYTES;
      if (file.size > maxSourceBytes) {
        if (isVideo) videoTooLargeCount += 1;
        else photoTooLargeCount += 1;
        continue;
      }

      let fileToUse = file;
      let imageDiagnostics: ImageDiagnostics | undefined;

      if (isHeicSource) {
        setIsConvertingHeic(true);
        try {
          fileToUse = await convertHeicToJpeg(file);
        } catch {
          processingFailedCount += 1;
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

      if (isVideo) {
        acceptedVideoFile = fileToUse;
      } else {
        newItems.push({
          key: crypto.randomUUID(),
          kind: "new",
          file: fileToUse,
          originalName: file.name,
          previewUrl: URL.createObjectURL(fileToUse),
          type: candidateType,
          imageDiagnostics,
        });
      }

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
    if (acceptedVideoFile) {
      const file = acceptedVideoFile;
      setVideo((prev) => {
        if (prev?.kind === "new") URL.revokeObjectURL(prev.previewUrl);
        return { kind: "new", file, previewUrl: URL.createObjectURL(file) };
      });
    }

    const messages: string[] = [];
    if (modeConflictMessage) messages.push(modeConflictMessage);
    if (overflowCount > 0) {
      messages.push(
        `You can add up to ${MAX_PHOTO_ITEMS} photos per post — ${overflowCount} file${overflowCount === 1 ? " was" : "s were"} not added.`,
      );
    }
    if (unsupportedVideoCount > 0) {
      messages.push(
        unsupportedVideoCount === 1
          ? "This video format isn't supported."
          : `${unsupportedVideoCount} videos had an unsupported format.`,
      );
    }
    if (unsupportedPhotoCount > 0) {
      messages.push(
        unsupportedPhotoCount === 1
          ? "This photo format isn't supported."
          : `${unsupportedPhotoCount} photos had an unsupported format.`,
      );
    }
    if (videoTooLargeCount > 0) {
      const maxVideoMb = Math.round(MAX_VIDEO_BYTES / (1024 * 1024));
      messages.push(
        videoTooLargeCount === 1
          ? `This video is too large. Maximum size is ${maxVideoMb} MB.`
          : `${videoTooLargeCount} videos were too large. Maximum size is ${maxVideoMb} MB.`,
      );
    }
    if (photoTooLargeCount > 0) {
      const maxPhotoMb = Math.round(MAX_IMAGE_SOURCE_BYTES / (1024 * 1024));
      messages.push(
        photoTooLargeCount === 1
          ? `This photo is too large. Maximum size is ${maxPhotoMb} MB.`
          : `${photoTooLargeCount} photos were too large. Maximum size is ${maxPhotoMb} MB.`,
      );
    }
    if (processingFailedCount > 0) {
      messages.push(
        processingFailedCount === 1
          ? "This photo couldn't be processed."
          : `${processingFailedCount} photos couldn't be processed.`,
      );
    }
    if (messages.length > 0) setError(messages.join(" "));
  }

  // Thin <input onChange> adapter — reads the real FileList, clears the
  // input for re-selection, and delegates to the shared pipeline above.
  async function handleMediaChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    event.target.value = ""; // allow re-selecting the same file(s) later
    await handleMediaFiles(files ?? []);
  }

  function handleRemoveMedia(key: string) {
    const item = mediaItems.find((i) => i.key === key);
    if (item && item.kind === "new") URL.revokeObjectURL(item.previewUrl);
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

  // Used only once mode === "video" — a dedicated single-file input, separate
  // from fileInputRef's array-oriented picker. Only reachable after a video
  // is already staged (see handleMediaChange's first-pick routing above), so
  // this always means "replace the current video," never "pick the first one."
  async function handleVideoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);

    const candidateType = detectMediaType(file);
    if (candidateType !== "video") {
      setError("Choose a video file.");
      return;
    }

    const mimeRecognized = ALLOWED_VIDEO_TYPES.includes(file.type as (typeof ALLOWED_VIDEO_TYPES)[number]);
    if (!mimeRecognized && !hasVideoExtension(file.name)) {
      setError("This video format isn't supported.");
      return;
    }

    if (file.size > MAX_VIDEO_BYTES) {
      setError(`This video is too large. Maximum size is ${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))} MB.`);
      return;
    }

    setVideo((prev) => {
      if (prev?.kind === "new") URL.revokeObjectURL(prev.previewUrl);
      return { kind: "new", file, previewUrl: URL.createObjectURL(file) };
    });
  }

  // Cancels a staged replacement, reverting to the original seed (null for
  // create — back to the empty "+ Add a video" placeholder; the server's
  // existing video for edit) — never leaves a video post with no video at
  // all once one has been chosen, per the product model.
  function handleRemoveVideo() {
    setVideo((prev) => {
      if (prev?.kind === "new") URL.revokeObjectURL(prev.previewUrl);
      return initialVideoRef.current;
    });
  }

  const showAddMoreTile = mode !== "video" && mediaItems.length < MAX_PHOTO_ITEMS;

  return {
    fileInputRef,
    mediaItems,
    mode,
    showOnMap,
    coords,
    setCoords,
    perPhotoLocationMode,
    selectedLocationKeys,
    error,
    setError,
    isConvertingHeic,
    showAddMoreTile,
    handleMediaChange,
    handleMediaFiles,
    handleRemoveMedia,
    handleMoveMedia,
    handleToggleShowOnMap,
    handleTogglePerPhotoLocationMode,
    handleTogglePhotoSelection,
    handleSetLocationForSelectedPhotos,
    handleClearLocationForSelectedPhotos,
    video,
    videoInputRef,
    handleVideoChange,
    handleRemoveVideo,
  };
}

export type MediaComposerState = ReturnType<typeof useMediaComposer>;
