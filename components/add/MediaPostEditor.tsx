"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import ComposerBottomBar from "@/components/add/ComposerBottomBar";
import ComposerTopBar from "@/components/add/ComposerTopBar";
import PostLocationFields from "@/components/add/PostLocationFields";
import TagChipInput from "@/components/add/TagChipInput";
import TitleField from "@/components/add/TitleField";
import DemoPhoto from "@/components/DemoPhoto";
import { useAuth } from "@/lib/auth/AuthProvider";
import { measureImageAspectRatio } from "@/lib/postDisplay";
import { addPost } from "@/lib/posts";
import {
  ALLOWED_MEDIA_TYPES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  deletePostMedia,
  uploadPostMedia,
} from "@/lib/storage";
import type { PostType } from "@/types/post";

type MediaPostEditorProps = {
  /** How the user entered this editor — decides which file picker flavor to auto-open. */
  initialSource: "album" | "camera" | null;
};

function mediaPostTypeFor(file: File): PostType {
  return file.type.startsWith("video/") ? "video" : "image";
}

/** Shared by both the "Choose from album" and "Camera" entries in the Add action sheet. */
export default function MediaPostEditor({ initialSource }: MediaPostEditorProps) {
  const router = useRouter();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasAutoOpenedRef = useRef(false);

  const [title, setTitle] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [showOnMap, setShowOnMap] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Revokes the previous object URL whenever it's replaced or the editor unmounts.
  useEffect(() => {
    if (!mediaPreviewUrl) return;
    return () => URL.revokeObjectURL(mediaPreviewUrl);
  }, [mediaPreviewUrl]);

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

  function handleMediaChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file later
    if (!file) return; // user canceled the picker — leave the editor as it was

    setError(null);

    if (!ALLOWED_MEDIA_TYPES.includes(file.type as (typeof ALLOWED_MEDIA_TYPES)[number])) {
      setError("Unsupported file type. Use a JPEG, PNG, WEBP, GIF, or AVIF photo, or an MP4, WEBM, or MOV video.");
      return;
    }

    const isVideo = file.type.startsWith("video/");
    const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (file.size > maxBytes) {
      setError(`That file is too large. Choose one under ${Math.round(maxBytes / (1024 * 1024))}MB.`);
      return;
    }

    setMediaFile(file);
    setMediaPreviewUrl(URL.createObjectURL(file));
  }

  function handleRemoveMedia() {
    setMediaFile(null);
    setMediaPreviewUrl(null);
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

    if (!mediaFile) {
      setError("Choose a photo or video before publishing.");
      return;
    }

    if (showOnMap && !coords) {
      setError("Choose a location on the map before publishing.");
      return;
    }

    setIsSubmitting(true);

    let uploadedPath: string | null = null;

    try {
      const postType = mediaPostTypeFor(mediaFile);
      // Measured synchronously here (not pre-fetched at selection time) so an
      // image post can never publish with a guessed/default aspect ratio just
      // because measurement hadn't finished yet — it either has the real
      // ratio by the time this resolves, or publishing fails with a real error.
      const imageAspect =
        postType === "video" ? "aspect-[4/5]" : await measureImageAspectRatio(mediaPreviewUrl!);

      const { url, path } = await uploadPostMedia(mediaFile, user.id);
      uploadedPath = path;

      const authorName = (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "Anonymous";

      await addPost({
        postType,
        image: url,
        imageAlt: title.trim(),
        imageAspect,
        title: title.trim(),
        caption: caption.trim(),
        tags,
        author: authorName,
        rating: 0,
        ratingCount: "New",
        showOnMap,
        latitude: showOnMap ? coords?.lat : undefined,
        longitude: showOnMap ? coords?.lng : undefined,
        userId: user.id,
      });

      router.replace("/me");
    } catch (err) {
      if (uploadedPath) {
        try {
          await deletePostMedia(uploadedPath);
        } catch {
          setError(
            "Publishing failed, and the uploaded file couldn't be cleaned up automatically. Please try again or contact support if this keeps happening.",
          );
          setIsSubmitting(false);
          return;
        }
      }
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setIsSubmitting(false);
    }
  }

  const isVideoPreview = mediaFile?.type.startsWith("video/") ?? false;

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-28 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <ComposerTopBar />

      <form onSubmit={handleSubmit} className="space-y-5 px-5 pt-4">
        <div>
          <input
            ref={fileInputRef}
            id="media"
            type="file"
            accept={ALLOWED_MEDIA_TYPES.join(",")}
            capture={initialSource === "camera" ? "environment" : undefined}
            onChange={handleMediaChange}
            className="hidden"
          />

          {mediaPreviewUrl ? (
            <div className="relative size-24">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Replace media"
                className="block size-24 overflow-hidden rounded-2xl"
              >
                {isVideoPreview ? (
                  <video src={mediaPreviewUrl} muted playsInline className="size-full object-cover" />
                ) : (
                  <DemoPhoto src={mediaPreviewUrl} alt="Media preview" className="size-full" />
                )}
              </button>
              <button
                type="button"
                onClick={handleRemoveMedia}
                aria-label="Remove media"
                className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-stone-900 text-[10px] text-white"
              >
                ×
              </button>
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
          )}
        </div>

        <TitleField value={title} onChange={setTitle} />

        <textarea
          id="caption"
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          rows={6}
          placeholder="Share something useful…"
          className="w-full resize-none border-none bg-transparent text-base leading-relaxed text-stone-900 outline-none placeholder:text-stone-400"
        />

        <TagChipInput tags={tags} onTagsChange={setTags} />

        <PostLocationFields
          showOnMap={showOnMap}
          onToggleShowOnMap={() => setShowOnMap((prev) => !prev)}
          coords={coords}
          onCoordsChange={setCoords}
        />

        <ComposerBottomBar isSubmitting={isSubmitting} error={error} />
      </form>
    </main>
  );
}
