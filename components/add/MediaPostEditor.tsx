"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import PostLocationFields from "@/components/add/PostLocationFields";
import DemoPhoto from "@/components/DemoPhoto";
import { useAuth } from "@/lib/auth/AuthProvider";
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
  const [tagsInput, setTagsInput] = useState("");
  const [showOnMap, setShowOnMap] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationName, setLocationName] = useState("");
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

    if (showOnMap && (!coords || !locationName.trim())) {
      setError("Choose a location on the map before publishing.");
      return;
    }

    setIsSubmitting(true);

    let uploadedPath: string | null = null;

    try {
      const postType = mediaPostTypeFor(mediaFile);
      const { url, path } = await uploadPostMedia(mediaFile, user.id);
      uploadedPath = path;

      const authorName = (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "Anonymous";

      const post = await addPost({
        postType,
        image: url,
        imageAlt: title.trim(),
        imageAspect: "aspect-[4/5]",
        title: title.trim(),
        caption: caption.trim(),
        tags: tagsInput
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        author: authorName,
        rating: 0,
        ratingCount: "New",
        showOnMap,
        latitude: showOnMap ? coords?.lat : undefined,
        longitude: showOnMap ? coords?.lng : undefined,
        locationName: showOnMap ? locationName.trim() : undefined,
        userId: user.id,
      });

      router.push(`/post/${post.id}`);
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
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] px-5 pb-28 pt-8 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <header>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-600">Share a find</p>
        <h1 className="mt-1 text-2xl font-black tracking-tight">Add a Spot</h1>
        <p className="mt-1 text-sm text-stone-500">Tell other students what makes it worth a visit.</p>
      </header>

      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        <div>
          <label className="text-xs font-bold text-stone-700" htmlFor="title">
            Title
          </label>
          <input
            id="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Blue Bottle Coffee — Mint Plaza"
            className="mt-1.5 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-400"
          />
        </div>

        <div>
          <label className="text-xs font-bold text-stone-700" htmlFor="media">
            Photo or video
          </label>
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
            <div className="mt-1.5">
              {isVideoPreview ? (
                <video
                  src={mediaPreviewUrl}
                  controls
                  playsInline
                  muted
                  className="aspect-[4/3] w-full rounded-xl bg-black object-contain"
                />
              ) : (
                <DemoPhoto src={mediaPreviewUrl} alt="Media preview" className="aspect-[4/3] w-full rounded-xl" />
              )}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-full bg-stone-100 px-3 py-1.5 text-[11px] font-bold text-stone-700 hover:bg-orange-100"
                >
                  Replace media
                </button>
                <button
                  type="button"
                  onClick={handleRemoveMedia}
                  className="rounded-full bg-stone-100 px-3 py-1.5 text-[11px] font-bold text-stone-700 hover:bg-orange-100"
                >
                  Remove media
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-1.5 flex w-full items-center justify-center rounded-xl border border-dashed border-stone-300 bg-white px-3 py-6 text-sm font-semibold text-stone-500 hover:border-orange-400"
            >
              + Choose a photo or video
            </button>
          )}
        </div>

        <div>
          <label className="text-xs font-bold text-stone-700" htmlFor="caption">
            Caption
          </label>
          <textarea
            id="caption"
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            rows={3}
            placeholder="What should people know before they go?"
            className="mt-1.5 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-400"
          />
        </div>

        <div>
          <label className="text-xs font-bold text-stone-700" htmlFor="tags">
            Tags
          </label>
          <input
            id="tags"
            value={tagsInput}
            onChange={(event) => setTagsInput(event.target.value)}
            placeholder="coffee, downtown, workspot"
            className="mt-1.5 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-400"
          />
          <p className="mt-1 text-[11px] text-stone-400">Separate tags with commas.</p>
        </div>

        <PostLocationFields
          showOnMap={showOnMap}
          onToggleShowOnMap={() => setShowOnMap((prev) => !prev)}
          coords={coords}
          onCoordsChange={setCoords}
          locationName={locationName}
          onLocationNameChange={setLocationName}
        />

        {error ? <p className="text-sm font-semibold text-red-600">{error}</p> : null}

        <div className="flex gap-3 pt-2">
          <Link
            href="/"
            className="flex-1 rounded-full border border-stone-300 px-5 py-3 text-center text-sm font-bold text-stone-700"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 rounded-full bg-stone-900 px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
          >
            {isSubmitting ? "Publishing…" : "Publish"}
          </button>
        </div>
      </form>
    </main>
  );
}
