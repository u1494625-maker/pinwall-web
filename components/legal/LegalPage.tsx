import Link from "next/link";
import type { ReactNode } from "react";

type LegalPageProps = {
  title: string;
  /** Omit for a non-versioned page (e.g. Support) that has no "effective
   *  date" concept — Privacy/Terms both still pass a real date and are
   *  unaffected. */
  effectiveDate?: string;
  children: ReactNode;
};

/**
 * Shared shell for /privacy and /terms — same page structure
 * (EditProfileForm/PostDetail's own `mx-auto max-w-md ... shadow-[...]`
 * pattern) as the rest of the app, but deliberately plain: no brand color
 * accents, no imagery, just a back link, a title, and prose. These are
 * meant to read as simple, professional legal documents, not a designed
 * product screen — and to work standalone for a visitor arriving from
 * Google's OAuth consent screen or an App Store review link, not just
 * from inside the app, so this renders with no auth requirement of its
 * own (BottomNav still renders underneath, same as every other route in
 * this app — nothing here suppresses it, hence the bottom padding below).
 *
 * Plain semantic HTML (h2/p/ul) inside `children`, styled centrally here
 * via descendant selectors rather than per-element utility classes in
 * every page — this project has no @tailwindcss/typography plugin
 * installed, so this is the minimal way to get consistent styling without
 * adding one just for two pages.
 */
export default function LegalPage({ title, effectiveDate, children }: LegalPageProps) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-28 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <div className="flex items-center gap-3 border-b border-stone-100 px-4 pb-3.5 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <Link
          href="/"
          aria-label="Back to Home"
          className="grid size-9 shrink-0 place-items-center rounded-full text-2xl leading-none text-stone-700"
        >
          ‹
        </Link>
        <h1 className="text-sm font-black text-stone-900">{title}</h1>
      </div>

      <article
        className="px-5 py-6 text-[15px] leading-relaxed text-stone-700
          [&_h2]:mb-2 [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-black [&_h2]:text-stone-900 [&_h2:first-child]:mt-0
          [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5
          [&_a]:font-semibold [&_a]:text-kavanaka-green [&_a]:underline"
      >
        {effectiveDate ? <p className="text-xs font-semibold text-stone-400">Effective {effectiveDate}</p> : null}
        {children}
      </article>
    </main>
  );
}
