import Link from "next/link";

type ComposerTopBarProps = {
  /** Where the back button goes — same destination the old "Cancel" link used. */
  cancelHref?: string;
};

/** Minimal sticky top bar shared by every composer screen: just a back button, no title. */
export default function ComposerTopBar({ cancelHref = "/" }: ComposerTopBarProps) {
  return (
    <div className="sticky top-0 z-10 border-b border-stone-100 bg-[#fbfaf7]/95 px-4 py-3 backdrop-blur">
      <Link
        href={cancelHref}
        aria-label="Cancel"
        className="grid size-9 place-items-center rounded-full text-2xl leading-none text-stone-700"
      >
        ‹
      </Link>
    </div>
  );
}
