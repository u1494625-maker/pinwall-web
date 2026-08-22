type DraftRestoredBannerProps = {
  /** True when the restored draft had at least one not-yet-uploaded local
   *  file that couldn't survive the reload — see lib/composerDraft.ts. */
  needsMediaReselect: boolean;
  onDiscard: () => void;
};

/** Small, dismissible notice shown once after a composer draft is silently
 *  restored — shared by MediaPostEditor (create) and EditPostForm's
 *  photo-edit path so the two read identically. "Discard" removes the
 *  stored draft so it won't resurface on a future reload; it deliberately
 *  does not also wipe the fields currently on screen. */
export default function DraftRestoredBanner({ needsMediaReselect, onDiscard }: DraftRestoredBannerProps) {
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
        className="shrink-0 text-[12px] font-bold text-kavanaka-aqua"
      >
        Discard
      </button>
    </div>
  );
}
