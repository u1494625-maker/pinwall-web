type DraftRestoredBannerProps = {
  /** True when the restored draft had at least one not-yet-uploaded local
   *  file that couldn't survive the reload — see lib/composerDraft.ts.
   *  MediaPostEditor's Phase 4A server-restored media is always durable, so
   *  it always passes false here — EditPostForm's own localStorage-restored
   *  draft still legitimately needs true sometimes. */
  needsMediaReselect: boolean;
  onDiscard: () => void;
  /** Optional — disables the button and swaps its label while an async
   *  discard is running, so a slow request can't be double-tapped. Omitted
   *  (defaults to false) by EditPostForm, whose discard is synchronous. */
  isDiscarding?: boolean;
};

/** Small, dismissible notice shown once after a composer draft is silently
 *  restored — shared by MediaPostEditor (create) and EditPostForm's
 *  photo-edit path so the two read identically. "Discard" removes the
 *  stored draft so it won't resurface on a future reload; it deliberately
 *  does not also wipe the fields currently on screen. */
export default function DraftRestoredBanner({ needsMediaReselect, onDiscard, isDiscarding = false }: DraftRestoredBannerProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-kavanaka-aqua/10 px-4 py-3">
      <p className="text-[12px] text-stone-700">
        {needsMediaReselect
          ? "Draft restored. Your text and settings were recovered. Please re-select your media."
          : "Draft restored."}
      </p>
      <button
        type="button"
        onClick={onDiscard}
        disabled={isDiscarding}
        className="shrink-0 text-[12px] font-bold text-kavanaka-aqua disabled:opacity-50"
      >
        {isDiscarding ? "Discarding…" : "Discard"}
      </button>
    </div>
  );
}
