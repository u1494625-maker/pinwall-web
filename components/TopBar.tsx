import Link from "next/link";
import type { ReactNode } from "react";

type TopBarProps = {
  children?: ReactNode;
};

export default function TopBar({ children }: TopBarProps) {
  return (
    <header className="sticky top-0 z-20 relative flex items-center justify-center border-b border-stone-200/80 bg-[#fbfaf7]/95 px-4 py-3 backdrop-blur">
      {children}
      <Link
        href="/search"
        aria-label="Search"
        className="absolute right-4 grid size-10 place-items-center rounded-full bg-stone-100 text-xl text-kavanaka-ink transition-colors hover:bg-stone-200"
      >
        <span aria-hidden="true">
          ⌕
        </span>
      </Link>
    </header>
  );
}
