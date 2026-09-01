"use client";

import { useEffect, useRef, useState, type SyntheticEvent } from "react";

type ExitDraftSheetProps = {
  open: boolean;
  /** Disables both action buttons and the implicit-close paths (backdrop
   *  tap, Esc, Cancel) while a save/discard is in flight — the caller must
   *  never navigate away while either is still running. */
  isBusy: boolean;
  error: string | null;
  onSaveDraft: () => void;
  onDontSave: () => void;
  onStay: () => void;
};

const CLOSE_ANIMATION_MS = 200;

/**
 * Single-step exit-confirmation sheet for MediaPostEditor (Phase 3) — same
 * native <dialog> + slide-up pattern as DeleteAccountSheet/PostManageSheet,
 * deliberately simpler (no multi-step type-to-confirm gate): just a concise
 * title, one line of context, and Save Draft / Don't Save / Cancel.
 */
export default function ExitDraftSheet({ open, isBusy, error, onSaveDraft, onDontSave, onStay }: ExitDraftSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [hasEnteredDom, setHasEnteredDom] = useState(false);

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

  function handleCancelEvent(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    if (!isBusy) onStay();
  }

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancelEvent}
      onClose={onStay}
      aria-label="Save this draft?"
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-black/50"
    >
      <div
        className={`fixed inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-3xl bg-white pb-[calc(env(safe-area-inset-bottom)+0.5rem)] shadow-[0_-10px_40px_rgba(0,0,0,0.15)] transition-transform duration-200 ease-out ${
          isVisible ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="p-5">
          <h2 className="text-base font-black text-stone-900">Save this draft?</h2>
          <p className="mt-2 text-sm leading-6 text-stone-500">You can pick up where you left off later.</p>
          {error ? <p className="mt-3 text-sm font-semibold text-red-600">{error}</p> : null}
          <div className="mt-5 space-y-2">
            <button
              type="button"
              onClick={onSaveDraft}
              disabled={isBusy}
              className="w-full rounded-2xl bg-stone-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              Save Draft
            </button>
            <button
              type="button"
              onClick={onDontSave}
              disabled={isBusy}
              className="w-full rounded-2xl bg-red-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              Don&apos;t Save
            </button>
            <button
              type="button"
              onClick={onStay}
              disabled={isBusy}
              className="w-full rounded-2xl bg-stone-100 px-4 py-3 text-sm font-bold text-stone-700 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
