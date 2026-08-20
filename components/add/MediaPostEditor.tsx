"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import ComposerBottomBar from "@/components/add/ComposerBottomBar";
import ComposerTopBar from "@/components/add/ComposerTopBar";
import MediaComposerFields from "@/components/add/MediaComposerFields";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useMediaComposer, type MediaComposerItem } from "@/lib/mediaComposer";
import { measureImageAspectRatio } from "@/lib/postDisplay";
import { addPost, type NewPostMediaInput } from "@/lib/posts";
import { deletePostMedia, uploadPostMedia } from "@/lib/storage";
import { generateVideoThumbnail } from "@/lib/videoThumbnail";

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

  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const composer = useMediaComposer();
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
        // Every item here is freshly selected (kind "new") — MediaPostEditor
        // never seeds pre-existing media, unlike EditPostForm's photo-edit path.
        if (item.kind !== "new") continue;
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

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-28 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <ComposerTopBar />

      <form onSubmit={handleSubmit} className="space-y-5 px-5 pt-4">
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

        <ComposerBottomBar isSubmitting={isSubmitting} error={error} />
      </form>
    </main>
  );
}
