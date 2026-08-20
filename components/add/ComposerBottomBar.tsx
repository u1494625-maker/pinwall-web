type ComposerBottomBarProps = {
  isSubmitting: boolean;
  error?: string | null;
  submitLabel?: string;
  submittingLabel?: string;
};

/**
 * Fixed publish bar shared by every composer screen. Docks at the very bottom —
 * BottomNav is hidden on every /add* route (see BottomNav.tsx), so there's no
 * global nav underneath to stack above.
 *
 * No "Save draft" button: there's no backend or local persistence for drafts,
 * and a fake client-only draft would be more confusing than useful. "Post" is
 * the single primary action — callers editing an existing post (not creating
 * one) can override the label via submitLabel/submittingLabel.
 */
export default function ComposerBottomBar({
  isSubmitting,
  error,
  submitLabel = "Post",
  submittingLabel = "Publishing…",
}: ComposerBottomBarProps) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-md border-t border-stone-100 bg-white/95 px-5 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur">
      {error ? <p className="mb-2 text-center text-xs font-semibold text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-full bg-kavanaka-lime py-3 text-sm font-bold text-kavanaka-ink shadow-md shadow-kavanaka-lime/30 disabled:opacity-60"
      >
        {isSubmitting ? submittingLabel : submitLabel}
      </button>
    </div>
  );
}
