"use client";

import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent, type SyntheticEvent } from "react";
import { VIDEO_EXTENSIONS } from "@/lib/mediaComposer";
import { setPendingCapture } from "@/lib/pendingCapture";
import { ALLOWED_MEDIA_TYPES } from "@/lib/storage";

export type AddPostChoice = "album" | "camera" | "text";

type AddPostActionSheetProps = {
  open: boolean;
  onClose: () => void;
  onChoose: (choice: AddPostChoice) => void;
};

const OPTIONS: { choice: AddPostChoice; label: string; description?: string }[] = [
  { choice: "album", label: "Choose from album" },
  { choice: "camera", label: "Camera", description: "Take a photo or video" },
  { choice: "text", label: "Text" },
];

const CLOSE_ANIMATION_MS = 200;

/**
 * Built on the native <dialog> element rather than a custom overlay: opening it with
 * showModal() gives us an inert background, native focus containment, and Escape-to-close
 * for free, with no extra dependency and no manual focus-trap code.
 */
export default function AddPostActionSheet({ open, onClose, onChoose }: AddPostActionSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Deliberately kept inside this <dialog> (not lifted to a parent like
  // BottomNav) — showModal() makes everything outside the dialog inert, so
  // triggering a hidden input from outside it would risk an extra
  // iOS/WebKit interaction edge case. Living here keeps the "Camera" tap
  // and the input's own .click() in the same active modal/user-gesture
  // context.
  const cameraInputRef = useRef<HTMLInputElement>(null);
  // Tracks whether this open-cycle has had a chance to paint in its hidden
  // position before flipping to visible, so the slide-up actually animates
  // instead of popping straight into place.
  const [hasEnteredDom, setHasEnteredDom] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) dialog.showModal();
      const raf = requestAnimationFrame(() => setHasEnteredDom(true));
      return () => cancelAnimationFrame(raf);
    }

    // `isVisible` below already reacts to `open` immediately, so the slide-down
    // starts right away; this timeout just waits for that CSS transition to
    // finish before actually closing the native dialog and resetting for next time.
    const timeout = setTimeout(() => {
      if (dialog.open) dialog.close();
      setHasEnteredDom(false);
    }, CLOSE_ANIMATION_MS);
    return () => clearTimeout(timeout);
  }, [open]);

  const isVisible = open && hasEnteredDom;

  function handleDialogClick(event: MouseEvent<HTMLDialogElement>) {
    // A click landing on the <dialog> itself (not one of its children) means
    // the dimmed backdrop area was tapped.
    if (event.target === dialogRef.current) {
      onClose();
    }
  }

  function handleCancelEvent(event: SyntheticEvent<HTMLDialogElement>) {
    // Fired by the browser on Escape. Prevent the native instant-close so our
    // slide-down animation plays first, then close through the same path as
    // every other dismissal.
    event.preventDefault();
    onClose();
  }

  // "Camera" doesn't call onChoose on tap like the other two options do --
  // it must synchronously trigger the hidden capture input first (same
  // click handler, same user-gesture context WebKit requires), and only
  // hand off to onChoose once a real File comes back. Navigating before
  // that would abandon the WKWebView picker mid-flight.
  function handleOptionClick(choice: AddPostChoice) {
    if (choice === "camera") {
      cameraInputRef.current?.click();
      return;
    }
    onChoose(choice);
  }

  // Do not assume iOS always fires `change` with an empty FileList on
  // cancel -- some cancellation paths never fire it at all. Either way,
  // simply not calling onChoose is enough: no File means nothing happens,
  // the sheet stays exactly as it was (open, on top of nothing), and the
  // user can choose Camera again, Album, Text, or Cancel.
  function handleCameraCapture(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow capturing again later without stale state
    if (!file) return;
    setPendingCapture(file);
    onChoose("camera");
  }

  return (
    <dialog
      ref={dialogRef}
      onClick={handleDialogClick}
      onCancel={handleCancelEvent}
      onClose={onClose}
      aria-label="Create a post"
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-black/50"
    >
      <div
        className={`fixed inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-3xl bg-white pb-[calc(env(safe-area-inset-bottom)+0.5rem)] shadow-[0_-10px_40px_rgba(0,0,0,0.15)] transition-transform duration-200 ease-out ${
          isVisible ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="space-y-1 p-3">
          {OPTIONS.map((option) => (
            <button
              key={option.choice}
              type="button"
              onClick={() => handleOptionClick(option.choice)}
              className="flex w-full flex-col items-center rounded-2xl px-4 py-4 text-center transition-colors hover:bg-stone-50 active:bg-stone-100"
            >
              <span className="text-base font-semibold text-stone-900">{option.label}</span>
              {option.description ? (
                <span className="mt-0.5 text-xs text-stone-400">{option.description}</span>
              ) : null}
            </button>
          ))}
        </div>

        {/* Hidden, camera-forced capture input for the "Camera" option above --
            same accept list as MediaComposerFields' own combined photo/video
            input, so the OS offers exactly the same file types either way. */}
        <input
          ref={cameraInputRef}
          type="file"
          accept={`${ALLOWED_MEDIA_TYPES.join(",")},image/heic,image/heif,.heic,.heif,${VIDEO_EXTENSIONS.join(",")}`}
          capture="environment"
          onChange={handleCameraCapture}
          className="hidden"
        />

        <div className="mt-1 border-t border-stone-100 p-3">
          <button
            type="button"
            onClick={onClose}
            className="flex w-full items-center justify-center rounded-2xl px-4 py-4 text-base font-semibold text-stone-500 transition-colors hover:bg-stone-50 active:bg-stone-100"
          >
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
