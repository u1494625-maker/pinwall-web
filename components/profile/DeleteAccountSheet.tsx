"use client";

import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { deleteAccount } from "@/lib/account";

type DeleteAccountSheetProps = {
  open: boolean;
  onClose: () => void;
  /** Fired only after the server has confirmed the account is actually
   *  gone — the caller signs out and redirects from here, never
   *  speculatively before this fires. */
  onDeleted: () => void;
};

type Step = "warning" | "confirm";

const CLOSE_ANIMATION_MS = 200;
const CONFIRM_PHRASE = "DELETE";

/**
 * Built on the same native <dialog> + slide-up pattern as PostManageSheet
 * (this app's one other destructive-confirmation flow). Two steps: a
 * warning explaining exactly what's permanent, then a type-to-confirm text
 * gate — deliberately not a forced Google re-auth round trip, since every
 * other authenticated action in this app already trusts the current
 * session's access token alone (this endpoint does too, re-verified
 * server-side), and a type-to-confirm step is the same order of protection
 * against an accidental tap that the rest of the app relies on for other
 * destructive actions.
 *
 * The parent remounts this component (via a changing `key`) each time it
 * opens, matching PostManageSheet's own convention, so step/input/error
 * state always starts fresh without resetting anything inside an effect.
 */
export default function DeleteAccountSheet({ open, onClose, onDeleted }: DeleteAccountSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [hasEnteredDom, setHasEnteredDom] = useState(false);
  const [step, setStep] = useState<Step>("warning");
  const [confirmText, setConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
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

  function handleCancelEvent(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    if (!isDeleting) onClose();
  }

  async function handleConfirmDelete() {
    setIsDeleting(true);
    setError(null);

    try {
      await deleteAccount();
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete your account. Try again.");
      setIsDeleting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancelEvent}
      onClose={onClose}
      aria-label="Delete account"
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-black/50"
    >
      <div
        className={`fixed inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-3xl bg-white pb-[calc(env(safe-area-inset-bottom)+0.5rem)] shadow-[0_-10px_40px_rgba(0,0,0,0.15)] transition-transform duration-200 ease-out ${
          isVisible ? "translate-y-0" : "translate-y-full"
        }`}
      >
        {step === "warning" ? (
          <div className="p-5">
            <h2 className="text-base font-black text-stone-900">Delete your account?</h2>
            <p className="mt-2 text-sm leading-6 text-stone-500">
              This permanently deletes your account and everything tied to it — your posts, photos and videos,
              comments, messages, likes, saves, and follows. This can&apos;t be undone.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-2xl bg-stone-100 px-4 py-3 text-sm font-bold text-stone-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setStep("confirm")}
                className="flex-1 rounded-2xl bg-red-600 px-4 py-3 text-sm font-bold text-white"
              >
                Continue
              </button>
            </div>
          </div>
        ) : (
          <div className="p-5">
            <h2 className="text-base font-black text-stone-900">Type {CONFIRM_PHRASE} to confirm</h2>
            <p className="mt-1.5 text-sm text-stone-500">This is your last chance to back out.</p>
            <input
              type="text"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              disabled={isDeleting}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder={CONFIRM_PHRASE}
              className="mt-4 w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-base font-bold tracking-wide text-stone-900 outline-none placeholder:font-normal placeholder:text-stone-400 disabled:opacity-60"
            />
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
                disabled={isDeleting || confirmText !== CONFIRM_PHRASE}
                className="flex-1 rounded-2xl bg-red-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
              >
                {isDeleting ? "Deleting…" : "Delete account"}
              </button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
