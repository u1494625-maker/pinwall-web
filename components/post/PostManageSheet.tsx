"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent, type SyntheticEvent } from "react";
import { deletePost } from "@/lib/posts";
import { deletePostMedia, POST_IMAGE_BUCKET, POST_VIDEO_BUCKET } from "@/lib/storage";
import type { Post } from "@/types/post";

type PostManageSheetProps = {
  open: boolean;
  post: Post;
  onClose: () => void;
  onDeleted: () => void;
};

type Step = "menu" | "confirm";

const CLOSE_ANIMATION_MS = 200;

/**
 * Built on the native <dialog> element, matching components/add/AddPostActionSheet.tsx's
 * pattern (showModal() backdrop + slide-up transition) rather than a new sheet mechanism.
 *
 * The parent remounts this component (via a changing `key`) each time it opens, so internal
 * step/error/deletion state always starts fresh without resetting state inside an effect.
 */
export default function PostManageSheet({ open, post, onClose, onDeleted }: PostManageSheetProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [hasEnteredDom, setHasEnteredDom] = useState(false);
  const [step, setStep] = useState<Step>("menu");
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Remembers whether every media item's Storage object is already gone, so a retry after
  // a DB-delete failure only retries the DB delete — never re-runs deletePostMedia on
  // paths already removed (harmless either way — remove() is a no-op on a missing object
  // — but this avoids redundant calls on retry).
  const mediaDeletedRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) dialog.showModal();
      const raf = requestAnimationFrame(() => setHasEnteredDom(true));
      return () => cancelAnimationFrame(raf);
    }

    const timeout = setTimeout(() => {
      if (dialog.open) dialog.close();
      setHasEnteredDom(false);
    }, CLOSE_ANIMATION_MS);
    return () => clearTimeout(timeout);
  }, [open]);

  const isVisible = open && hasEnteredDom;

  function handleDialogClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === dialogRef.current && !isDeleting) {
      onClose();
    }
  }

  function handleCancelEvent(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    if (!isDeleting) onClose();
  }

  async function handleConfirmDelete() {
    setIsDeleting(true);
    setError(null);

    try {
      if (post.media.length > 0 && !mediaDeletedRef.current) {
        for (const item of post.media) {
          await deletePostMedia(item.storagePath, item.type === "video" ? POST_VIDEO_BUCKET : POST_IMAGE_BUCKET);
          // A video's cover lives in post-image as its own separate object,
          // tracked only via thumbnailStoragePath — never deleted otherwise.
          if (item.thumbnailStoragePath) {
            await deletePostMedia(item.thumbnailStoragePath, POST_IMAGE_BUCKET);
          }
        }
        mediaDeletedRef.current = true;
      }

      await deletePost(post.id);
      onDeleted();
    } catch (err) {
      setError(
        mediaDeletedRef.current
          ? `The media step completed, but the post couldn't be deleted: ${err instanceof Error ? err.message : "Unknown error"}`
          : err instanceof Error
            ? err.message
            : "Couldn't delete this post. Try again.",
      );
      setIsDeleting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClick={handleDialogClick}
      onCancel={handleCancelEvent}
      onClose={onClose}
      aria-label="Manage post"
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-black/50"
    >
      <div
        className={`fixed inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-3xl bg-white pb-[calc(env(safe-area-inset-bottom)+0.5rem)] shadow-[0_-10px_40px_rgba(0,0,0,0.15)] transition-transform duration-200 ease-out ${
          isVisible ? "translate-y-0" : "translate-y-full"
        }`}
      >
        {step === "menu" ? (
          <>
            <div className="space-y-1 p-3">
              <button
                type="button"
                onClick={() => router.push(`/post/${post.id}/edit`)}
                className="flex w-full items-center rounded-2xl px-4 py-4 text-left transition-colors hover:bg-stone-50 active:bg-stone-100"
              >
                <span className="text-base font-semibold text-stone-900">Edit</span>
              </button>
              <button
                type="button"
                onClick={() => setStep("confirm")}
                className="flex w-full items-center rounded-2xl px-4 py-4 text-left transition-colors hover:bg-red-50 active:bg-red-100"
              >
                <span className="text-base font-semibold text-red-600">Delete</span>
              </button>
            </div>
            <div className="mt-1 border-t border-stone-100 p-3">
              <button
                type="button"
                onClick={onClose}
                className="flex w-full items-center justify-center rounded-2xl px-4 py-4 text-base font-semibold text-stone-500 transition-colors hover:bg-stone-50 active:bg-stone-100"
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <div className="p-5">
            <h2 className="text-base font-black text-stone-900">Delete this post?</h2>
            <p className="mt-1.5 text-sm text-stone-500">This can&apos;t be undone.</p>
            {error ? <p className="mt-3 text-sm font-semibold text-red-600">{error}</p> : null}
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isDeleting}
                className="flex-1 rounded-2xl bg-stone-100 px-4 py-3 text-sm font-bold text-stone-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="flex-1 rounded-2xl bg-red-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
              >
                {isDeleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
