"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { convertHeicToJpeg, isHeicFile } from "@/lib/heic";
import { MAX_IMAGE_SOURCE_BYTES, prepareImageForUpload, type ImageDiagnostics } from "@/lib/imageOptimization";
import {
  deleteDraftMedia,
  getNextDraftMediaPosition,
  getOrCreateMediaDraft,
  insertDraftMedia,
  updateDraftMediaLocation,
} from "@/lib/postDrafts";
import {
  ALLOWED_MEDIA_TYPES,
  ALLOWED_VIDEO_TYPES,
  MAX_VIDEO_BYTES,
  POST_IMAGE_BUCKET,
  POST_VIDEO_BUCKET,
  deletePostMedia,
  uploadPostMedia,
  uploadVideoResumable,
  type StorageBucket,
} from "@/lib/storage";
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
 * uploading -> uploaded | error. "error" is always recoverable (retry or
 * remove); "uploading" always ends in one of the other two, never stuck.
 * Only ever meaningful when immediate upload is enabled (MediaPostEditor) —
 * EditPostForm's own "new" items are set to "uploaded" the instant they're
 * staged and never move from there, since nothing uploads them until
 * submit, exactly as today.
 *
 * FOR PHASE 5 (not yet implemented): publish_post_draft's own "at least one
 * draft_media row exists" check is a minimum integrity guard only — it
 * proves the draft isn't completely empty, not that every currently-
 * selected item has finished uploading (5 files picked, 1 persisted, 4
 * still "uploading" client-side still satisfies that check). Publish must
 * additionally be blocked client-side, before ever calling the RPC, while
 * any mediaItems/video entry here is "uploading" or "error" — this array of
 * per-item uploadStatus values is exactly what that future check reads.
 */
export type MediaUploadStatus = "uploading" | "uploaded" | "error";

/**
 * One media item in the composer's ordered list — either an already-
 * persisted photo (kept as-is, possibly moved and/or relocated) or a
 * locally-selected file. Both carry the same `location` field, and
 * reordering (handleMoveMedia) only ever moves whole array elements — a
 * photo's id/location/image always travel together as one object, never
 * tracked in a separate index-keyed structure.
 *
 * A "new" item's upload fields (uploadStatus/draftMediaId/storagePath/
 * uploadedUrl/uploadError) only apply when immediate upload is enabled
 * (see UseMediaComposerOptions.enableImmediateUpload) — previewUrl always
 * stays the local blob URL for display regardless of upload state, so nothing
 * re-renders/re-fetches once a background upload finishes; the new fields
 * exist purely to track the persisted draft_media row for later phases
 * (removal cleanup now, publish reuse later) and to drive the small
 * uploading/error affordance in MediaComposerFields.
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
      uploadStatus: MediaUploadStatus;
      draftMediaId?: number;
      storagePath?: string;
      uploadedUrl?: string;
      uploadError?: string;
    }
  | {
      key: string;
      /** A restored draft_media row from an earlier session (Phase 4A) —
       *  already durably uploaded, never a local File, never re-uploaded.
       *  Deliberately a THIRD kind, not folded into "existing": "existing"
       *  means already-published post_media (EditPostForm only), and
       *  removing one of those is a local-only, submit-time-reconciled
       *  operation (see EditPostForm). A restored draft item's removal must
       *  instead go through the SAME immediate Storage-then-draft_media
       *  delete lifecycle Phase 2 already built (see handleRemoveMedia
       *  below) — blurring the two kinds together would make removal
       *  silently point at the wrong table for one of them. */
      kind: "draft";
      id: number;
      type: MediaType;
      previewUrl: string;
      storagePath: string;
      aspectRatio: string | null;
      thumbnailUrl?: string;
      thumbnailStoragePath?: string;
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

/** Seeds one restored draft_media row into a "draft"-kind MediaComposerItem
 *  — see fetchMediaDraftForRestore (lib/postDrafts.ts) for where this data
 *  comes from. */
export type RestoredDraftMediaSeed = {
  id: number;
  type: MediaType;
  url: string;
  storagePath: string;
  aspectRatio: string | null;
  thumbnailUrl?: string;
  thumbnailStoragePath?: string;
  location?: { lat: number; lng: number };
};

/**
 * A video post's single video file — tracked as its own slot, never as an
 * array element like photos (a video post always has exactly one). "existing"
 * is only ever seeded by EditVideoPostFields (the server's current file);
 * "new" is a locally-selected replacement. Removing a staged "new"
 * replacement reverts to the original "existing" seed (see
 * useMediaComposer's handleRemoveVideo) — a video post can never be left
 * with none at all once one has been chosen. Same upload-field caveat as
 * MediaComposerItem's "new" kind above — only meaningful when immediate
 * upload is enabled. `uploadKey` is a stable id for this specific staged
 * attempt (distinct from any array `key`, since video has no array) used to
 * tell a stale, already-superseded upload's eventual completion apart from
 * the current one.
 */
export type VideoAsset =
  | { kind: "existing"; url: string; storagePath: string }
  | {
      kind: "new";
      file: File;
      previewUrl: string;
      uploadKey: string;
      uploadStatus: MediaUploadStatus;
      draftMediaId?: number;
      storagePath?: string;
      uploadedUrl?: string;
      uploadError?: string;
    }
  /** A restored draft video from an earlier session (Phase 4A) — same
   *  reasoning as MediaComposerItem's "draft" kind above: already durably
   *  uploaded, distinct from "existing" (published post_media, EditPostForm
   *  only) so replace/remove correctly targets draft_media, never post_media. */
  | { kind: "draft"; id: number; url: string; storagePath: string };

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

function draftSeedToItem(seed: RestoredDraftMediaSeed): MediaComposerItem {
  return {
    key: `draft-${seed.id}`,
    kind: "draft",
    id: seed.id,
    type: seed.type,
    previewUrl: seed.url,
    storagePath: seed.storagePath,
    aspectRatio: seed.aspectRatio,
    thumbnailUrl: seed.thumbnailUrl,
    thumbnailStoragePath: seed.thumbnailStoragePath,
    location: seed.location,
  };
}

export type UseMediaComposerOptions = {
  initialItems?: ExistingMediaSeed[];
  /** Phase 4A restoration only — a restored draft's own photo rows, seeded
   *  as "draft"-kind items (see RestoredDraftMediaSeed). Only ever passed by
   *  MediaPostEditor; EditPostForm never sets this. Mutually exclusive with
   *  initialItems in practice (a caller seeds one or the other), but both
   *  are concatenated below so neither needs to know the other exists. */
  initialDraftItems?: RestoredDraftMediaSeed[];
  initialShowOnMap?: boolean;
  initialCoords?: { lat: number; lng: number } | null;
  /** Defaults to true if any seeded item already has its own location — the
   *  editor should open already reflecting per-photo mode rather than
   *  silently hiding existing per-photo pins behind a toggle that reads off. */
  initialPerPhotoLocationMode?: boolean;
  /** Seeds a video-post edit with the server's current video — omitted
   *  entirely for create (starts null) and for a photo post. Also how
   *  Phase 4A restoration seeds a restored draft video: a plain `{kind:
   *  "draft", ...}` object is a valid VideoAsset like any other. */
  initialVideo?: VideoAsset;
  /** Phase 4A restoration only — pre-seeds draftIdPromiseRef with an
   *  ALREADY-RESOLVED id, so a restored draft is immediately known to exist
   *  without ever calling ensureDraftId() first. Without this,
   *  resolveDraftIdIfStarted() would wrongly report "no draft" for a
   *  restored-but-not-yet-touched-this-session draft (nothing would have
   *  called ensureDraftId() yet to populate the ref) — e.g. Discard on the
   *  restoration banner, tapped before any new upload/edit this session. */
  initialDraftId?: string;
  /** Owner id for immediate-upload's Storage path/draft ownership — required
   *  (together with enableImmediateUpload) to actually trigger any upload.
   *  Omitted entirely by EditPostForm, which doesn't opt into this. */
  userId?: string;
  /** Off by default — only MediaPostEditor's create flow turns this on.
   *  EditPostForm never sets it, so every "new" item it stages is marked
   *  uploaded immediately (see handleMediaFiles/stageAndUploadVideo below)
   *  and no network call is ever made from this file for that caller — its upload-
   *  at-submit behavior is completely unchanged. */
  enableImmediateUpload?: boolean;
};

type UploadOutcome =
  | { status: "removed" }
  | { status: "error"; message: string }
  | { status: "success"; draftMediaId: number; storagePath: string; url: string };

/**
 * All media + map-location state and handlers shared by MediaPostEditor
 * (create) and EditPostForm's photo-edit path — lifted verbatim out of
 * MediaPostEditor so neither duplicates the file-validation/HEIC/
 * optimization pipeline, the add/remove/reorder logic, or the per-photo
 * location assignment logic. The only thing that differs between callers is
 * how the initial item list is seeded (empty for create, from an existing
 * post's media for edit), whether immediate upload is enabled, and what
 * happens on submit — all three stay in the calling component.
 */
export function useMediaComposer({
  initialItems = [],
  initialDraftItems = [],
  initialShowOnMap = false,
  initialCoords = null,
  initialPerPhotoLocationMode,
  initialVideo,
  initialDraftId,
  userId,
  enableImmediateUpload = false,
}: UseMediaComposerOptions = {}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const mediaItemsRef = useRef<MediaComposerItem[]>([]);
  const videoRef = useRef<VideoAsset | null>(null);

  const [mediaItems, setMediaItems] = useState<MediaComposerItem[]>(() => [
    ...initialItems.map(seedToItem),
    ...initialDraftItems.map(draftSeedToItem),
  ]);
  const [showOnMap, setShowOnMap] = useState(initialShowOnMap);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(initialCoords);
  const [perPhotoLocationMode, setPerPhotoLocationMode] = useState(
    initialPerPhotoLocationMode ??
      (initialItems.some((item) => item.location != null) || initialDraftItems.some((item) => item.location != null)),
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

  // Caches the single in-flight/resolved get-or-create-draft request so
  // concurrent uploads (several photos selected at once) never race each
  // other into both seeing "no draft yet" and both trying to create one —
  // every upload this session awaits the exact same promise.
  // Pre-seeded with an ALREADY-RESOLVED promise when restoring a draft that
  // already exists server-side (initialDraftId) — see UseMediaComposerOptions'
  // own doc comment on initialDraftId for why this matters (resolveDraftIdIfStarted
  // must correctly report "yes, a draft exists" from the very first render
  // of a restored composer, before any new upload/edit has called
  // ensureDraftId() itself this session).
  const draftIdPromiseRef = useRef<Promise<string> | null>(
    initialDraftId ? Promise.resolve(initialDraftId) : null,
  );
  /**
   * Caches the in-flight/resolved promise (so concurrent uploads never race
   * each other into creating two drafts, per the doc comment below) — but a
   * REJECTION clears the cache back to null first, before the rejection
   * reaches any caller. Without this, one transient failure (e.g. a dropped
   * connection on the very first upload) would permanently poison every
   * later Retry with the same dead rejected promise, since a rejected
   * promise can never change state. The `draftIdPromiseRef.current ===
   * promise` guard matters because this .catch runs as a microtask — by the
   * time it fires, a *different* call could theoretically already have
   * replaced the ref (defensive, though not reachable in practice since
   * nothing else writes this ref while it already holds a promise).
   */
  function ensureDraftId(): Promise<string> {
    if (!draftIdPromiseRef.current) {
      const promise = userId ? getOrCreateMediaDraft(userId) : Promise.reject(new Error("Not signed in."));
      draftIdPromiseRef.current = promise;
      promise.catch(() => {
        if (draftIdPromiseRef.current === promise) {
          draftIdPromiseRef.current = null;
        }
      });
    }
    return draftIdPromiseRef.current;
  }

  /**
   * For the exit-confirmation flow (Phase 3) only: resolves to this draft's
   * id if a draft was actually created this session, or to null if it
   * wasn't. Never calls ensureDraftId() itself, so checking can never create
   * a draft merely by being called: a user who only typed a title/caption
   * and never picked media has nothing server-side to discard.
   *
   * Safe to treat as "definitely resolved, never rejects" ONLY once no
   * upload from this composer is still active — see prepareForDiscard below,
   * whose whole job is to guarantee exactly that before this is ever read
   * for a discard decision. Once draft creation has actually SUCCEEDED, this
   * ref only ever holds that resolved promise for the rest of the session
   * (ensureDraftId's rejection-clearing above only ever clears a REJECTED
   * promise, never a fulfilled one) — so there is no window where a
   * genuinely-created draft's id could be lost from here.
   */
  function resolveDraftIdIfStarted(): Promise<string | null> {
    return draftIdPromiseRef.current ?? Promise.resolve(null);
  }

  // Every currently-active uploadAndPersistMedia() call, keyed by the same
  // key/uploadKey used elsewhere — used only by prepareForDiscard below to
  // wait for uploads to fully settle before Storage prefix cleanup begins.
  // uploadAndPersistMedia never rejects (every branch inside it is caught),
  // so awaiting all of these always resolves once every upload has either
  // fully persisted or been fully rolled back.
  const activeUploadsRef = useRef<Map<string, Promise<UploadOutcome>>>(new Map());
  // Set synchronously (no await before it) the instant a discard starts, so
  // there is no gap where a new upload could be kicked off after cleanup
  // begins — checked at the top of every upload-initiating handler below.
  const isDiscardingRef = useRef(false);

  // Photo positions are claimed from a counter seeded from the draft's own
  // existing draft_media rows (getNextDraftMediaPosition), not derived from
  // mediaItems.length — a reused draft from an earlier session can already
  // have persisted media that Phase 2's freshly-mounted, empty local state
  // knows nothing about (restoration is Phase 4), so starting from 0 would
  // collide with unique(draft_id, position) the instant that draft already
  // had anything in it. Seeded once (nextPositionPromiseRef so concurrent
  // claims share the same lookup instead of each re-querying), then every
  // claim increments the resolved counter synchronously — safe even for
  // several files selected at once because each claimant's continuation
  // after the SAME shared promise resolves runs to completion (read then
  // increment) before the next queued continuation gets a turn, per normal
  // microtask ordering; no two callers can ever read the same value.
  const nextPositionPromiseRef = useRef<Promise<void> | null>(null);
  const nextPositionCounterRef = useRef<number | null>(null);
  async function claimNextPosition(draftId: string): Promise<number> {
    if (nextPositionCounterRef.current == null) {
      if (!nextPositionPromiseRef.current) {
        nextPositionPromiseRef.current = getNextDraftMediaPosition(draftId).then((next) => {
          nextPositionCounterRef.current = next;
        });
      }
      await nextPositionPromiseRef.current;
    }
    const claimed = nextPositionCounterRef.current!;
    nextPositionCounterRef.current = claimed + 1;
    return claimed;
  }

  // Keys (mediaItems' own key, or a VideoAsset's uploadKey) the user asked
  // to remove/replace while their upload was still in flight — a single-shot
  // Storage PUT can't be cancelled mid-flight, so the upload is left to
  // finish, but its eventual completion must neither re-add the item to
  // state nor leave an orphaned Storage object/draft_media row behind. Read-
  // and-clear (via Set.delete's boolean return) at every checkpoint inside
  // uploadAndPersistMedia below.
  const removedWhileUploadingRef = useRef<Set<string>>(new Set());
  // Video uploads DO support real cancellation (uploadVideoResumable takes
  // an AbortSignal) — used on remove/replace so a large in-flight video
  // upload doesn't keep spending bandwidth for nothing. Photos have no such
  // mechanism (uploadPostMedia is a plain single-shot PUT), so they rely
  // solely on the removedWhileUploadingRef cleanup-after-the-fact above —
  // building real cancellation for that path isn't part of this phase.
  const uploadAbortControllersRef = useRef<Map<string, AbortController>>(new Map());

  /**
   * The one place immediate upload actually happens — used for both photos
   * and video. Uploads via the existing uploadPostMedia/uploadVideoResumable
   * (unchanged, reused as-is) under `${userId}/${draftId}/...` (draftId is
   * now the persisted post_drafts.id, not a throwaway UUID), then records
   * one draft_media row pointing at that exact Storage object — never a
   * second upload, never a move/copy. Checks removedWhileUploadingRef after
   * every await; if the caller removed this item in the meantime, cleans up
   * whatever was already created (Storage object, then the draft_media row,
   * matching the same Storage-before-DB ordering used everywhere else in
   * this feature) and reports "removed" instead of touching component state.
   *
   * `position` is only ever passed explicitly for video (always 0, a single
   * slot whose only real collision risk is handled by stageAndUploadVideo's
   * own sequencing, not here) — photos claim theirs from claimNextPosition,
   * seeded from the draft's actual persisted rows, not local array length.
   *
   * IMPORTANT: if the Storage upload succeeds but the draft_media insert fails
   * AND the Storage rollback below also fails, this deliberately does NOT
   * claim that a later cleanup pass can find the orphan via draft_media —
   * it can't, since no row was ever created. The eventual stale-draft sweep
   * must delete by this draft's Storage PREFIX (`${userId}/${draftId}/`),
   * not by enumerating draft_media rows, specifically so it still catches
   * this case. Not implemented until Phase 6; recorded here so that design
   * doesn't quietly regress back to a draft_media-driven sweep later.
   */
  async function uploadAndPersistMedia(params: {
    key: string;
    file: File;
    mediaType: MediaType;
    aspectRatio: string | null;
    position?: number;
    signal?: AbortSignal;
  }): Promise<UploadOutcome> {
    let draftId: string;
    try {
      draftId = await ensureDraftId();
    } catch {
      return { status: "error", message: "Couldn't start this upload. Try again." };
    }
    if (removedWhileUploadingRef.current.delete(params.key)) return { status: "removed" };

    const bucket: StorageBucket = params.mediaType === "video" ? POST_VIDEO_BUCKET : POST_IMAGE_BUCKET;
    let uploaded: { url: string; path: string };
    try {
      uploaded =
        params.mediaType === "video"
          ? await uploadVideoResumable(params.file, userId!, draftId, { signal: params.signal })
          : await uploadPostMedia(params.file, userId!, draftId);
    } catch (err) {
      if (removedWhileUploadingRef.current.delete(params.key)) return { status: "removed" };
      return { status: "error", message: err instanceof Error ? err.message : "Upload failed." };
    }

    if (removedWhileUploadingRef.current.delete(params.key)) {
      try {
        await deletePostMedia(uploaded.path, bucket);
      } catch {
        // Best-effort. If this also fails, the object is now orphaned with
        // no draft_media row — see this function's own doc comment above
        // for why the eventual cleanup pass must sweep by Storage prefix,
        // not by draft_media, specifically to still catch this.
      }
      return { status: "removed" };
    }

    try {
      // Claiming a position is part of THIS try block on purpose, not a
      // separate step before it — a failure here (e.g. the position lookup
      // itself fails) must roll back the just-uploaded Storage object
      // exactly like an insertDraftMedia failure does, via the same catch
      // below, rather than leaving it behind uncleaned.
      const position = params.mediaType === "video" ? (params.position ?? 0) : await claimNextPosition(draftId);

      // Read the location fresh off mediaItemsRef right before inserting,
      // not from a value captured when the upload started — the user can
      // assign a per-photo pin (handleSetLocationForSelectedPhotos) while
      // this exact upload is still mid-flight, and this is what makes that
      // assignment land in the row instead of being silently dropped. Video
      // has no per-media location concept, so this is only ever meaningful
      // for a photo.
      const currentLocation =
        params.mediaType === "image"
          ? mediaItemsRef.current.find((i) => i.key === params.key)?.location
          : undefined;

      const draftMedia = await insertDraftMedia({
        draftId,
        mediaType: params.mediaType,
        url: uploaded.url,
        storagePath: uploaded.path,
        aspectRatio: params.aspectRatio,
        position,
        latitude: currentLocation?.lat,
        longitude: currentLocation?.lng,
      });

      if (removedWhileUploadingRef.current.delete(params.key)) {
        try {
          await deleteDraftMedia(draftMedia.id);
        } catch {
          // Best-effort — see above.
        }
        try {
          await deletePostMedia(uploaded.path, bucket);
        } catch {
          // Best-effort — see above.
        }
        return { status: "removed" };
      }

      return { status: "success", draftMediaId: draftMedia.id, storagePath: uploaded.path, url: uploaded.url };
    } catch {
      // Storage succeeded but either claiming a position or the DB insert
      // failed — roll back the upload so it's never left orphaned, and
      // never let the UI believe this item is safely persisted.
      try {
        await deletePostMedia(uploaded.path, bucket);
      } catch {
        // Best-effort — see above.
      }
      if (removedWhileUploadingRef.current.delete(params.key)) return { status: "removed" };
      return { status: "error", message: "Couldn't save this upload. Try again." };
    }
  }

  /** The persisted draft_media id for an item that already has one — "draft"
   *  (restored) or "new" that already finished uploading — or undefined for
   *  anything else (existing published media, or still uploading/errored,
   *  which has no persisted location field to write yet; see
   *  uploadAndPersistMedia's own insertDraftMedia call for how THAT case is
   *  covered instead, by reading the freshest location at insert time). */
  function persistedMediaId(item: MediaComposerItem): number | undefined {
    if (item.kind === "draft") return item.id;
    if (item.kind === "new") return item.draftMediaId;
    return undefined;
  }

  // Phase 5 — every location-write fired below is fire-and-forget from the
  // caller's point of view (the UI updates immediately; the server write
  // trails behind), but Publish needs to know none are still in flight
  // before it can trust draft_media's locations match what's on screen — see
  // awaitPendingLocationWrites below. Tracked as a plain Set of promises,
  // each removing itself once settled (via .finally); never rejects (the
  // writes below already .catch their own failures), so Promise.all over
  // this set is always safe.
  const pendingLocationWritesRef = useRef<Set<Promise<void>>>(new Set());
  function trackLocationWrite(promise: Promise<void>) {
    pendingLocationWritesRef.current.add(promise);
    void promise.finally(() => {
      pendingLocationWritesRef.current.delete(promise);
    });
  }

  // Turning per-photo mode OFF — whether the user toggles it directly or
  // handleRemoveMedia collapses it for them below — must also drop any pins
  // already assigned, so "off" really means today's exact behavior, not
  // "off, but still secretly submitting per-photo pins." Also persists the
  // clear for every already-uploaded/restored item that had a pin — without
  // this, a later restore would incorrectly bring back per-photo locations
  // the user explicitly turned off (see updateDraftMediaLocation).
  function turnOffPerPhotoLocationMode() {
    setPerPhotoLocationMode(false);
    setSelectedLocationKeys(new Set());
    for (const item of mediaItems) {
      if (!item.location) continue;
      const id = persistedMediaId(item);
      if (id != null) {
        trackLocationWrite(
          updateDraftMediaLocation(id, null).catch(() => {
            setError("Couldn't update photo locations. Try again.");
          }),
        );
      }
    }
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

  /** Fires the persisted-location write for every currently selected item
   *  that already has a draft_media row — shared by set/clear below. An item
   *  still mid-upload (no persisted id yet) is skipped here; its eventual
   *  insertDraftMedia call reads the freshest location off mediaItemsRef at
   *  that point instead, so nothing is lost, just written via a different
   *  path depending on timing. */
  function persistLocationForSelected(location: { lat: number; lng: number } | null) {
    for (const item of mediaItems) {
      if (!selectedLocationKeys.has(item.key)) continue;
      const id = persistedMediaId(item);
      if (id != null) {
        trackLocationWrite(
          updateDraftMediaLocation(id, location).catch(() => {
            setError("Couldn't save this photo's location. Try again.");
          }),
        );
      }
    }
  }

  // Assigns one location to every currently selected photo at once. The
  // selection deliberately stays active afterward — dragging the same pin
  // again re-applies to the same batch, and the picker stays open — until
  // the user explicitly changes which photos are selected.
  function handleSetLocationForSelectedPhotos(location: { lat: number; lng: number }) {
    setMediaItems((prev) => prev.map((item) => (selectedLocationKeys.has(item.key) ? { ...item, location } : item)));
    persistLocationForSelected(location);
  }

  function handleClearLocationForSelectedPhotos() {
    setMediaItems((prev) =>
      prev.map((item) => (selectedLocationKeys.has(item.key) ? { ...item, location: undefined } : item)),
    );
    persistLocationForSelected(null);
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
    // A discard is settling in-flight uploads before Storage cleanup begins
    // (see prepareForDiscard) — starting a brand new one now would defeat
    // that entirely. Defense in depth: the exit sheet's own modal already
    // makes this UI unreachable while a discard is running.
    if (isDiscardingRef.current) return;

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
        const key = crypto.randomUUID();
        newItems.push({
          key,
          kind: "new",
          file: fileToUse,
          originalName: file.name,
          previewUrl: URL.createObjectURL(fileToUse),
          type: candidateType,
          imageDiagnostics,
          uploadStatus: enableImmediateUpload ? "uploading" : "uploaded",
        });

        if (enableImmediateUpload && userId) {
          const aspectRatio = imageDiagnostics
            ? `${imageDiagnostics.optimizedWidth}/${imageDiagnostics.optimizedHeight}`
            : null;
          // No position passed here — uploadAndPersistMedia claims the next
          // one itself (claimNextPosition), seeded from the draft's actual
          // persisted rows rather than local array length (see its own
          // comment for why: this draft may already have media a not-yet-
          // implemented restore step hasn't loaded into mediaItems yet).
          const uploadPromise = uploadAndPersistMedia({ key, file: fileToUse, mediaType: "image", aspectRatio });
          activeUploadsRef.current.set(key, uploadPromise);
          void uploadPromise.then((outcome) => {
            activeUploadsRef.current.delete(key);
            if (outcome.status === "removed") return;
            setMediaItems((prev) =>
              prev.map((existingItem) => {
                if (existingItem.key !== key || existingItem.kind !== "new") return existingItem;
                return outcome.status === "success"
                  ? {
                      ...existingItem,
                      uploadStatus: "uploaded",
                      draftMediaId: outcome.draftMediaId,
                      storagePath: outcome.storagePath,
                      uploadedUrl: outcome.url,
                    }
                  : { ...existingItem, uploadStatus: "error", uploadError: outcome.message };
              }),
            );
          });
        }
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
      void stageAndUploadVideo(acceptedVideoFile);
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

  // Thin <input onChange> adapter — snapshots the FileList into a real
  // array BEFORE clearing the input, not after: clearing `.value` can
  // invalidate a still-referenced FileList, so converting first is what
  // guarantees the files actually reach handleMediaFiles.
  async function handleMediaChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ""; // allow re-selecting the same file(s) later
    await handleMediaFiles(files);
  }

  async function handleRemoveMedia(key: string) {
    const item = mediaItems.find((i) => i.key === key);
    if (!item) return;

    if (item.kind === "new" && item.uploadStatus === "uploading") {
      // Can't cancel a single-shot photo Storage upload mid-flight — let it
      // finish in the background; uploadAndPersistMedia's own
      // removedWhileUploadingRef checks clean up whatever it created without
      // ever touching mediaItems for a key that's no longer there.
      removedWhileUploadingRef.current.add(key);
    } else if (
      (item.kind === "new" && item.uploadStatus === "uploaded" && item.draftMediaId != null && item.storagePath) ||
      item.kind === "draft"
    ) {
      // Same Storage-then-draft_media lifecycle either way: a "new" item
      // that already finished uploading this session, or a "draft" item
      // restored from an earlier one — both are already-persisted
      // draft_media rows, never re-uploaded, never a "existing" published
      // post_media row (see MediaComposerItem's "draft" kind doc comment).
      const draftMediaId = item.kind === "draft" ? item.id : item.draftMediaId!;
      const storagePath = item.kind === "draft" ? item.storagePath : item.storagePath!;
      const bucket: StorageBucket = item.type === "video" ? POST_VIDEO_BUCKET : POST_IMAGE_BUCKET;
      try {
        // Storage first, then the DB row — if the DB delete fails, a stale
        // draft_media row pointing at an already-gone object is still safely
        // catchable by a later cleanup pass; the reverse order could leave a
        // Storage object with nothing left referencing it at all.
        await deletePostMedia(storagePath, bucket);
        await deleteDraftMedia(draftMediaId);
      } catch {
        setError("Couldn't remove this item. Try again.");
        return; // leave it in place — never claim removal succeeded when it didn't
      }
    }

    if (item.kind === "new") URL.revokeObjectURL(item.previewUrl);

    // Per-photo mode only makes sense with >1 photo — collapse back to the
    // single-location editor the moment that stops being true, mirroring
    // modeFor's "removing every item returns to neutral" convention already
    // used in this file. Decided from this render's mediaItems (accurate
    // for any single, normally-paced removal); the actual array update
    // below is computed independently from React's own queued `prev`, so
    // mediaItems can never end up wrong even if two removals were ever
    // queued back to back before a re-render lands.
    const willCollapsePerPhotoMode = perPhotoLocationMode && mediaItems.filter((i) => i.key !== key).length <= 1;

    setMediaItems((prev) => {
      const remaining = prev.filter((i) => i.key !== key);
      return willCollapsePerPhotoMode ? remaining.map((i) => ({ ...i, location: undefined })) : remaining;
    });

    if (willCollapsePerPhotoMode) {
      setSelectedLocationKeys(new Set());
      setPerPhotoLocationMode(false);
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

  /**
   * The draft_media id + storage path to clean up for whichever video is
   * currently occupying the slot, or null if there's nothing persisted to
   * clean up (no video yet, or a "new" one still mid-upload with no row yet).
   * Shared by stageAndUploadVideo and handleRemoveVideo below so both handle
   * a restored "draft" video exactly like an already-uploaded "new" one —
   * same two-step Storage-then-draft_media delete either way.
   */
  function persistedVideoRef(v: VideoAsset | null): { draftMediaId: number; storagePath: string } | null {
    if (v?.kind === "draft") return { draftMediaId: v.id, storagePath: v.storagePath };
    if (v?.kind === "new" && v.uploadStatus === "uploaded" && v.draftMediaId != null && v.storagePath) {
      return { draftMediaId: v.draftMediaId, storagePath: v.storagePath };
    }
    return null;
  }

  /**
   * Shared by the first-video-in-a-batch path (handleMediaFiles) and
   * "Replace video" (handleVideoChange below) — stages the new file locally
   * and kicks off its own upload, after first fully resolving whatever the
   * previous "new" video was doing:
   *
   * - Still uploading: no draft_media row exists for it yet (nothing to
   *   race), so this is fire-and-forget as before — mark it removed and let
   *   its own eventual completion clean itself up.
   * - Already uploaded: video always persists at position 0, under the
   *   same unique(draft_id, position) constraint as photos, so the old row
   *   MUST be deleted before the replacement's insert runs, not just
   *   "eventually" — an unawaited best-effort delete here could let the new
   *   insert race the old delete and fail. If this cleanup fails, the
   *   replacement is not staged at all: the old video stays in place, an
   *   error is shown, and the user can retry replacing.
   */
  async function stageAndUploadVideo(file: File): Promise<void> {
    // See handleMediaFiles' identical check above for why.
    if (isDiscardingRef.current) return;

    const previous = video;

    if (previous?.kind === "new" && previous.uploadStatus === "uploading") {
      removedWhileUploadingRef.current.add(previous.uploadKey);
      uploadAbortControllersRef.current.get(previous.uploadKey)?.abort();
    } else {
      const persisted = persistedVideoRef(previous);
      if (persisted) {
        try {
          await deletePostMedia(persisted.storagePath, POST_VIDEO_BUCKET);
          await deleteDraftMedia(persisted.draftMediaId);
        } catch {
          setError("Couldn't remove the previous video. Try again.");
          return; // do not stage the replacement -- position 0 may still be occupied
        }
      }
    }
    if (previous?.kind === "new") URL.revokeObjectURL(previous.previewUrl);

    const uploadKey = crypto.randomUUID();
    setVideo({
      kind: "new",
      file,
      previewUrl: URL.createObjectURL(file),
      uploadKey,
      uploadStatus: enableImmediateUpload ? "uploading" : "uploaded",
    });

    if (!enableImmediateUpload || !userId) return;

    const controller = new AbortController();
    uploadAbortControllersRef.current.set(uploadKey, controller);
    const uploadPromise = uploadAndPersistMedia({
      key: uploadKey,
      file,
      mediaType: "video",
      aspectRatio: null,
      position: 0,
      signal: controller.signal,
    });
    activeUploadsRef.current.set(uploadKey, uploadPromise);
    void uploadPromise.then((outcome) => {
      activeUploadsRef.current.delete(uploadKey);
      uploadAbortControllersRef.current.delete(uploadKey);
      if (outcome.status === "removed") return;
      setVideo((prev) => {
        if (!prev || prev.kind !== "new" || prev.uploadKey !== uploadKey) return prev; // superseded by a later replacement
        return outcome.status === "success"
          ? {
              ...prev,
              uploadStatus: "uploaded",
              draftMediaId: outcome.draftMediaId,
              storagePath: outcome.storagePath,
              uploadedUrl: outcome.url,
            }
          : { ...prev, uploadStatus: "error", uploadError: outcome.message };
      });
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

    await stageAndUploadVideo(file);
  }

  // Cancels a staged replacement, reverting to the original seed (null for
  // create — back to the empty "+ Add a video" placeholder; the server's
  // existing video for edit) — never leaves a video post with no video at
  // all once one has been chosen, per the product model.
  async function handleRemoveVideo() {
    const current = video;

    if (current?.kind === "new" && current.uploadStatus === "uploading") {
      removedWhileUploadingRef.current.add(current.uploadKey);
      uploadAbortControllersRef.current.get(current.uploadKey)?.abort();
    } else {
      const persisted = persistedVideoRef(current);
      if (persisted) {
        try {
          await deletePostMedia(persisted.storagePath, POST_VIDEO_BUCKET);
          await deleteDraftMedia(persisted.draftMediaId);
        } catch {
          setError("Couldn't remove this video. Try again.");
          return;
        }
      }
    }

    setVideo(() => {
      if (current?.kind === "new") URL.revokeObjectURL(current.previewUrl);
      return initialVideoRef.current;
    });
  }

  /** Re-attempts upload for a "new" item currently in "error" state — reuses
   *  the same already-validated/optimized File (HEIC conversion and image
   *  optimization already succeeded the first time; only the upload step
   *  failed), so retrying never re-runs that work. */
  function handleRetryMedia(key: string) {
    // See handleMediaFiles' identical check above for why.
    if (isDiscardingRef.current) return;
    const item = mediaItems.find((i) => i.key === key);
    if (!item || item.kind !== "new" || item.uploadStatus !== "error" || !enableImmediateUpload || !userId) return;

    setMediaItems((prev) =>
      prev.map((i) => (i.key === key && i.kind === "new" ? { ...i, uploadStatus: "uploading", uploadError: undefined } : i)),
    );
    const aspectRatio = item.imageDiagnostics
      ? `${item.imageDiagnostics.optimizedWidth}/${item.imageDiagnostics.optimizedHeight}`
      : null;
    // No position passed — see handleMediaFiles' own call site for why.
    const uploadPromise = uploadAndPersistMedia({ key, file: item.file, mediaType: item.type, aspectRatio });
    activeUploadsRef.current.set(key, uploadPromise);
    void uploadPromise.then((outcome) => {
      activeUploadsRef.current.delete(key);
      if (outcome.status === "removed") return;
      setMediaItems((prev) =>
        prev.map((existingItem) => {
          if (existingItem.key !== key || existingItem.kind !== "new") return existingItem;
          return outcome.status === "success"
            ? {
                ...existingItem,
                uploadStatus: "uploaded",
                draftMediaId: outcome.draftMediaId,
                storagePath: outcome.storagePath,
                uploadedUrl: outcome.url,
              }
            : { ...existingItem, uploadStatus: "error", uploadError: outcome.message };
        }),
      );
    });
  }

  /** Video analogue of handleRetryMedia above. */
  function handleRetryVideo() {
    // See handleMediaFiles' identical check above for why.
    if (isDiscardingRef.current) return;
    if (!video || video.kind !== "new" || video.uploadStatus !== "error" || !enableImmediateUpload || !userId) return;
    const current = video;

    setVideo((prev) => (prev && prev.kind === "new" ? { ...prev, uploadStatus: "uploading", uploadError: undefined } : prev));
    const controller = new AbortController();
    uploadAbortControllersRef.current.set(current.uploadKey, controller);
    const uploadPromise = uploadAndPersistMedia({
      key: current.uploadKey,
      file: current.file,
      mediaType: "video",
      aspectRatio: null,
      position: 0,
      signal: controller.signal,
    });
    activeUploadsRef.current.set(current.uploadKey, uploadPromise);
    void uploadPromise.then((outcome) => {
      activeUploadsRef.current.delete(current.uploadKey);
      uploadAbortControllersRef.current.delete(current.uploadKey);
      if (outcome.status === "removed") return;
      setVideo((prev) => {
        if (!prev || prev.kind !== "new" || prev.uploadKey !== current.uploadKey) return prev;
        return outcome.status === "success"
          ? {
              ...prev,
              uploadStatus: "uploaded",
              draftMediaId: outcome.draftMediaId,
              storagePath: outcome.storagePath,
              uploadedUrl: outcome.url,
            }
          : { ...prev, uploadStatus: "error", uploadError: outcome.message };
      });
    });
  }

  /**
   * Phase 3 hardening — Don't Save's required precondition before any
   * Storage/DB deletion may begin: no upload from this composer may still
   * be capable of creating a new Storage object under this draft's prefix
   * once cleanup starts. Three steps, in order:
   *
   * 1. isDiscardingRef flips true synchronously (no await before it), so
   *    every upload-initiating handler above starts refusing new work
   *    immediately — closes the gap a purely async check would leave open.
   * 2. Every "uploading" item (photo or video) is marked into
   *    removedWhileUploadingRef — the exact same mechanism handleRemoveMedia/
   *    handleRemoveVideo already use, so its completion runs its own
   *    existing Storage+DB rollback. Video additionally gets a real abort
   *    (uploadAbortControllersRef) since that path supports cancellation;
   *    photos don't, so they're left to finish and self-clean.
   * 3. Every currently-active uploadAndPersistMedia() call (activeUploadsRef)
   *    is awaited. That function never rejects, so Promise.all always
   *    resolves — and by the time it does, every one of those uploads has
   *    either fully persisted (draft_media row exists) or been fully rolled
   *    back (Storage object + row removed, or never created at all). Only
   *    after this can the caller safely delete the draft's Storage prefix
   *    and post_drafts row.
   */
  async function prepareForDiscard(): Promise<void> {
    isDiscardingRef.current = true;

    for (const item of mediaItemsRef.current) {
      if (item.kind === "new" && item.uploadStatus === "uploading") {
        removedWhileUploadingRef.current.add(item.key);
      }
    }

    const currentVideo = videoRef.current;
    if (currentVideo?.kind === "new" && currentVideo.uploadStatus === "uploading") {
      removedWhileUploadingRef.current.add(currentVideo.uploadKey);
      uploadAbortControllersRef.current.get(currentVideo.uploadKey)?.abort();
    }

    await Promise.all(Array.from(activeUploadsRef.current.values()));
    isDiscardingRef.current = false;
  }

  /**
   * Phase 4A hardening — Save Draft's required precondition before it can
   * compute a correct final media order or know whether anything is left in
   * "error": every currently-active immediate-upload operation must have
   * fully settled first. Deliberately the narrow opposite of
   * prepareForDiscard above — this does NOT mark anything removed, does NOT
   * abort anything, does NOT touch the draft at all. Save Draft wants
   * uploads to finish NORMALLY and then read the result, not be neutralized
   * because everything is about to be deleted.
   *
   * uploadAndPersistMedia never rejects, so this never rejects either.
   * Callers must read the settled state from mediaItemsRef/videoRef
   * afterward, not from their own possibly-stale mediaItems/video closure
   * variable — this function's own return value carries no data on purpose,
   * matching the requested narrow `Promise<void>` shape.
   */
  async function awaitActiveUploads(): Promise<void> {
    await Promise.all(Array.from(activeUploadsRef.current.values()));
  }

  /**
   * Phase 5 — waits for every currently-pending per-media location write
   * (handleSetLocationForSelectedPhotos/handleClearLocationForSelectedPhotos/
   * turnOffPerPhotoLocationMode's fire-and-forget updateDraftMediaLocation
   * calls) to settle. Called by Publish right before flushing the final
   * order/calling publish_post_draft — without this, a location changed
   * moments before tapping Publish could still be in flight when the RPC
   * reads draft_media, publishing a stale location. Never rejects (the
   * writes it's waiting on already .catch their own failures).
   */
  async function awaitPendingLocationWrites(): Promise<void> {
    await Promise.all(Array.from(pendingLocationWritesRef.current.values()));
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
    handleRetryMedia,
    handleToggleShowOnMap,
    handleTogglePerPhotoLocationMode,
    handleTogglePhotoSelection,
    handleSetLocationForSelectedPhotos,
    handleClearLocationForSelectedPhotos,
    video,
    videoInputRef,
    handleVideoChange,
    handleRemoveVideo,
    handleRetryVideo,
    resolveDraftIdIfStarted,
    prepareForDiscard,
    /** Phase 4A — exposed so MediaPostEditor's server-field/order autosave
     *  can ensure a draft exists using the SAME get-or-create mechanism
     *  uploads already use (never a second, parallel draft-creation path),
     *  per the explicit "Use the same get-or-create mechanism already
     *  built" requirement. */
    ensureDraftId,
    awaitActiveUploads,
    awaitPendingLocationWrites,
    /** Phase 4A hardening — read-only escape hatches onto the same refs
     *  prepareForDiscard/awaitActiveUploads already use internally to see
     *  the LATEST mediaItems/video, not whatever a caller's own closure
     *  captured when its async function started. Needed specifically
     *  because Save Draft awaits awaitActiveUploads() first: an upload that
     *  settles during that await updates state via setMediaItems/setVideo,
     *  which the CALLER's already-running function closure can never see on
     *  its own — only a ref, read fresh after the await, reflects it. */
    mediaItemsRef,
    videoRef,
  };
}

export type MediaComposerState = ReturnType<typeof useMediaComposer>;
