"use client";

import { useEffect, useRef, useState, type MouseEvent, type SyntheticEvent } from "react";
import { MAX_REPORT_REASON_LENGTH } from "@/lib/reports";

type ReportModalProps = {
  open: boolean;
  targetLabel: "post" | "comment";
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
};

const CLOSE_ANIMATION_MS = 200;

/**
 * Built on the native <dialog> element, matching
 * components/post/PostManageSheet.tsx's own pattern (showModal() backdrop +
 * slide-up transition) rather than a new sheet mechanism. Shared between
 * reporting a post and reporting a comment — the only difference is
 * targetLabel and what the caller's onSubmit actually does.
 *
 * The parent should remount this component (via a changing `key`) each time
 * it opens, same convention as PostManageSheet, so internal error/submitting
 * state always starts fresh rather than resetting inside an effect.
 */
export default function ReportModal({ open, targetLabel, onClose, onSubmit }: ReportModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [hasEnteredDom, setHasEnteredDom] = useState(false);
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (event.target === dialogRef.current && !isSubmitting) onClose();
  }

  function handleCancelEvent(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    if (!isSubmitting) onClose();
  }

  async function handleSubmit() {
    if (isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(reason.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't submit this report. Try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClick={handleDialogClick}
      onCancel={handleCancelEvent}
      onClose={onClose}
      aria-label={`Report this ${targetLabel}`}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-black/50"
    >
      <div
        className={`fixed inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-3xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-[0_-10px_40px_rgba(0,0,0,0.15)] transition-transform duration-200 ease-out ${
          isVisible ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <h2 className="text-base font-black text-stone-900">Report this {targetLabel}</h2>

        <label htmlFor="report-reason" className="mt-4 block text-xs font-bold text-stone-500">
          Why are you reporting this? <span className="font-normal text-stone-400">Optional</span>
        </label>
        <textarea
          id="report-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={MAX_REPORT_REASON_LENGTH}
          rows={3}
          placeholder="Tell us what's wrong…"
          className="mt-1.5 w-full resize-none rounded-2xl border border-stone-200 bg-stone-50 px-3.5 py-2.5 text-sm text-stone-900 outline-none placeholder:text-stone-400"
        />

        {error ? <p className="mt-3 text-sm font-semibold text-red-600">{error}</p> : null}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 rounded-2xl bg-stone-100 px-4 py-3 text-sm font-bold text-stone-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex-1 rounded-2xl bg-red-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            {isSubmitting ? "Submitting…" : "Submit report"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
