import Link from "next/link";

type ComposerTopBarProps = {
  /** Where the back button goes — same destination the old "Cancel" link used. */
  cancelHref?: string;
  /** When provided, takes precedence over cancelHref and pops history
   *  (router.back()) instead of pushing a new entry. EditPostForm uses this:
   *  Edit is always entered via a push from Post Detail, so cancelling with
   *  a plain Link (another push) left a stray .../edit entry sandwiched in
   *  history — back() unwinds exactly the one entry Edit itself added. */
  onCancel?: () => void;
};

/** Minimal sticky top bar shared by every composer screen: just a back button, no title. */
export default function ComposerTopBar({ cancelHref = "/", onCancel }: ComposerTopBarProps) {
  const className = "grid size-9 place-items-center rounded-full text-2xl leading-none text-stone-700";

  if (onCancel) {
    return (
      <div className="sticky top-0 z-10 border-b border-stone-100 bg-[#fbfaf7]/95 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] backdrop-blur">
        <button type="button" onClick={onCancel} aria-label="Cancel" className={className}>
          ‹
        </button>
      </div>
    );
  }

  return (
    <div className="sticky top-0 z-10 border-b border-stone-100 bg-[#fbfaf7]/95 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] backdrop-blur">
      <Link href={cancelHref} aria-label="Cancel" className={className}>
        ‹
      </Link>
    </div>
  );
}
