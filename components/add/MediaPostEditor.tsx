"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import ComposerBottomBar from "@/components/add/ComposerBottomBar";
import ComposerTopBar from "@/components/add/ComposerTopBar";
import DraftRestoredBanner from "@/components/add/DraftRestoredBanner";
import MediaComposerFields from "@/components/add/MediaComposerFields";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  clearDraft,
  draftKeyForCreate,
  DRAFT_AUTOSAVE_DEBOUNCE_MS,
  loadDraft,
  saveDraft,
  type ComposerDraft,
} from "@/lib/composerDraft";
import { useMediaComposer, type MediaComposerItem } from "@/lib/mediaComposer";
import { measureImageAspectRatio } from "@/lib/postDisplay";
import { addPost, type NewPostMediaInput } from "@/lib/posts";
import {
  deletePostMedia,
  POST_IMAGE_BUCKET,
  POST_VIDEO_BUCKET,
  uploadPostMedia,
  uploadVideoResumable,
  type StorageBucket,
} from "@/lib/storage";

type MediaPostEditorProps = {
  /** How the user entered this editor — decides which file picker flavor to auto-open. */
  initialSource: "album" | "camera" | null;
};

/**
 * Wraps uploadPostMedia with a diagnostic console line identifying exactly
 * which selected file failed and why (original filename, whether it went
 * through HEIC conversion, mime type, size) — the thrown error itself already
 * names the file/size for the user; this is the extra detail useful for
 * correlating a real-device report against the console.
 */
async function uploadWithDiagnostics(item: Extract<MediaComposerItem, { kind: "new" }>, userId: string, draftId: string) {
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
  const hasAutoOpenedRef = useRef(false);

  const draftKey = draftKeyForCreate();
  // Read once at mount — a later change to the draft in storage (e.g. from
  // another tab) is never reflected back into an already-open composer.
  const [initialDraft] = useState<ComposerDraft | null>(() => loadDraft(draftKey));
  const [showDraftBanner, setShowDraftBanner] = useState(() => initialDraft !== null);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [title, setTitle] = useState(() => initialDraft?.title ?? "");
  const [caption, setCaption] = useState(() => initialDraft?.caption ?? "");
  const [tags, setTags] = useState<string[]>(() => initialDraft?.tags ?? []);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Fraction 0–1 while a video is uploading via the resumable path; null the
  // rest of the time (including for a photo-only post, which never touches
  // this at all).
  const [videoUploadProgress, setVideoUploadProgress] = useState<number | null>(null);
  // Drives the submit button's label for a video post's multi-step publish —
  // null for a photo/empty post, which keeps ComposerBottomBar's plain
  // default ("Publishing…") exactly as before.
  const [stage, setStage] = useState<"uploading-video" | "uploading-cover" | "saving" | null>(null);

  const composer = useMediaComposer({
    initialShowOnMap: initialDraft?.showOnMap,
    initialCoords: initialDraft?.coords ?? null,
    initialPerPhotoLocationMode: initialDraft?.perPhotoLocationMode,
  });
  const {
    fileInputRef,
    mediaItems,
    mode,
    showOnMap,
    coords,
    perPhotoLocationMode,
    selectedLocationKeys,
    error,
    setError,
    isConvertingHeic,
    showAddMoreTile,
    handleMediaChange,
    handleRemoveMedia,
    handleMoveMedia,
    handleToggleShowOnMap,
    handleTogglePerPhotoLocationMode,
    handleTogglePhotoSelection,
    handleSetLocationForSelectedPhotos,
    handleClearLocationForSelectedPhotos,
    setCoords,
    video,
    cover,
    videoInputRef,
    coverInputRef,
    handleVideoChange,
    handleRemoveVideo,
    handleCoverChange,
    handleRemoveCover,
  } = composer;

  // Auto-open the picker once on arrival, matching how the user got here from
  // the action sheet — doesn't request camera permission itself; the browser's
  // own file-picker UI decides whether/how to offer the camera.
  useEffect(() => {
    if (hasAutoOpenedRef.current) return;
    if (initialSource === "album" || initialSource === "camera") {
      hasAutoOpenedRef.current = true;
      fileInputRef.current?.click();
    }
  }, [initialSource, fileInputRef]);

  // Debounced autosave — text/settings only, never the local media Files
  // themselves (those aren't JSON-serializable and, more importantly,
  // aren't meant to survive a reload at all in this version — see
  // lib/composerDraft.ts). Skipped entirely once a submit is underway;
  // nothing that matters changes mid-submit, and it would otherwise race
  // with the clear-on-success below.
  useEffect(() => {
    if (isSubmitting) return;

    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      saveDraft(draftKey, {
        version: 1,
        mode: "create",
        title,
        caption,
        tags,
        showOnMap,
        coords,
        perPhotoLocationMode,
        existingMediaOrder: [], // create never has pre-existing server media
        knownServerMediaIds: [], // create never has pre-existing server media
        hasUnsavedLocalMedia:
          mediaItems.some((item) => item.kind === "new") || video?.kind === "new" || cover?.kind === "new",
        savedAt: Date.now(),
      });
    }, DRAFT_AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    };
  }, [draftKey, isSubmitting, title, caption, tags, showOnMap, coords, perPhotoLocationMode, mediaItems, video, cover]);

  function cancelPendingDraftSave() {
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
  }

  // Preserves the exact same destination (a plain push to "/") the default
  // ComposerTopBar Link would have used — only adding the draft-clear side
  // effect, not changing where Cancel goes.
  function handleCancel() {
    cancelPendingDraftSave();
    clearDraft(draftKey);
    router.push("/");
  }

  function handleDiscardDraft() {
    cancelPendingDraftSave();
    clearDraft(draftKey);
    setShowDraftBanner(false);
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

    if (mode === null) {
      setError("Choose at least one photo or video before publishing.");
      return;
    }

    if (mode === "video" && !cover) {
      setError("Add a cover image before publishing.");
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
    const uploadedPaths: { path: string; bucket: StorageBucket }[] = [];

    try {
      const media: NewPostMediaInput[] = [];

      if (mode === "video") {
        // MediaPostEditor only ever creates — video/cover here are always a
        // freshly selected local file, never "existing" (that only happens
        // in EditVideoPostFields). Asserted, not just assumed, so a future
        // change to this invariant fails loudly instead of silently.
        if (!video || video.kind !== "new") throw new Error("Expected a newly selected video.");
        if (!cover || cover.kind !== "new") throw new Error("Expected a newly selected cover image.");

        setStage("uploading-video");
        setVideoUploadProgress(0);
        let videoUrl: string, videoPath: string;
        try {
          ({ url: videoUrl, path: videoPath } = await uploadVideoResumable(video.file, user.id, draftId, {
            onProgress: setVideoUploadProgress,
          }));
        } finally {
          setVideoUploadProgress(null);
        }
        uploadedPaths.push({ path: videoPath, bucket: POST_VIDEO_BUCKET });

        setStage("uploading-cover");
        const uploadedCover = await uploadPostMedia(cover.file, user.id, draftId);
        uploadedPaths.push({ path: uploadedCover.path, bucket: POST_IMAGE_BUCKET });

        media.push({
          type: "video",
          url: videoUrl,
          storagePath: videoPath,
          aspectRatio: "4/5",
          position: 0,
          thumbnailUrl: uploadedCover.url,
          thumbnailStoragePath: uploadedCover.path,
        });
      } else {
        // Sequential, not parallel: with a small max item count, this keeps
        // rollback bookkeeping trivial — uploadedPaths always reflects
        // exactly what succeeded so far the instant anything fails.
        for (let index = 0; index < mediaItems.length; index += 1) {
          const item = mediaItems[index];
          // Every item here is freshly selected (kind "new") — MediaPostEditor
          // never seeds pre-existing media, unlike EditPostForm's photo-edit path.
          if (item.kind !== "new") continue;
          // Images already know their real (post-optimization) dimensions
          // from the pipeline — no need to re-decode via
          // measureImageAspectRatio. That helper is kept only as a defensive
          // fallback for the unexpected case imageDiagnostics is missing.
          const aspectRatio = item.imageDiagnostics
            ? `${item.imageDiagnostics.optimizedWidth}/${item.imageDiagnostics.optimizedHeight}`
            : await measureImageAspectRatio(item.previewUrl);
          const { url, path } = await uploadWithDiagnostics(item, user.id, draftId);
          uploadedPaths.push({ path, bucket: POST_IMAGE_BUCKET });

          media.push({
            type: item.type,
            url,
            storagePath: path,
            aspectRatio,
            position: index,
            latitude: perPhotoLocationMode ? item.location?.lat : undefined,
            longitude: perPhotoLocationMode ? item.location?.lng : undefined,
          });
        }
      }

      setStage("saving");
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

      cancelPendingDraftSave();
      clearDraft(draftKey);
      router.replace("/me");
    } catch (err) {
      if (uploadedPaths.length > 0) {
        const failedCleanupPaths: string[] = [];
        for (const { path, bucket } of uploadedPaths) {
          try {
            await deletePostMedia(path, bucket);
          } catch {
            failedCleanupPaths.push(path);
          }
        }
        if (failedCleanupPaths.length > 0) {
          setError(
            "Publishing failed, and some uploaded files couldn't be cleaned up automatically. Please try again or contact support if this keeps happening.",
          );
          setIsSubmitting(false);
          setStage(null);
          return;
        }
      }
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setIsSubmitting(false);
      setStage(null);
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-28 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <ComposerTopBar onCancel={handleCancel} />

      <form onSubmit={handleSubmit} className="space-y-5 px-5 pt-4">
        {showDraftBanner ? (
          <DraftRestoredBanner
            needsMediaReselect={initialDraft?.hasUnsavedLocalMedia ?? false}
            onDiscard={handleDiscardDraft}
          />
        ) : null}

        <MediaComposerFields
          fileInputRef={fileInputRef}
          mediaItems={mediaItems}
          mode={mode}
          showAddMoreTile={showAddMoreTile}
          isConvertingHeic={isConvertingHeic}
          onMediaChange={handleMediaChange}
          onRemoveMedia={handleRemoveMedia}
          onMoveMedia={handleMoveMedia}
          captureEnvironment={initialSource === "camera"}
          video={video}
          cover={cover}
          videoInputRef={videoInputRef}
          coverInputRef={coverInputRef}
          onVideoChange={handleVideoChange}
          onRemoveVideo={handleRemoveVideo}
          onCoverChange={handleCoverChange}
          onRemoveCover={handleRemoveCover}
          title={title}
          onTitleChange={setTitle}
          caption={caption}
          onCaptionChange={setCaption}
          tags={tags}
          onTagsChange={setTags}
          showOnMap={showOnMap}
          onToggleShowOnMap={handleToggleShowOnMap}
          coords={coords}
          onCoordsChange={setCoords}
          perPhotoLocationMode={perPhotoLocationMode}
          onTogglePerPhotoLocationMode={handleTogglePerPhotoLocationMode}
          selectedLocationKeys={selectedLocationKeys}
          onTogglePhotoSelection={handleTogglePhotoSelection}
          onSetLocationForSelected={handleSetLocationForSelectedPhotos}
          onClearLocationForSelected={handleClearLocationForSelectedPhotos}
        />

        <ComposerBottomBar
          isSubmitting={isSubmitting}
          error={error}
          submittingLabel={
            stage === "uploading-video"
              ? `Uploading video… ${Math.round((videoUploadProgress ?? 0) * 100)}%`
              : stage === "uploading-cover"
                ? "Uploading cover…"
                : stage === "saving"
                  ? "Saving post…"
                  : "Publishing…"
          }
        />
      </form>
    </main>
  );
}
