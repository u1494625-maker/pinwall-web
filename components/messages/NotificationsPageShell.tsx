"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

type NotificationsPageShellProps = {
  title: string;
  children: ReactNode;
};

/** Shared top bar (back button + title) for the three notification
 *  category pages — BottomNav is hidden on these routes, so a back button
 *  is the only way out, matching Post Detail's own back-button convention. */
export default function NotificationsPageShell({ title, children }: NotificationsPageShellProps) {
  const router = useRouter();

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-10 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-stone-100 bg-[#fbfaf7]/95 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] backdrop-blur">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Go back"
          className="grid size-9 shrink-0 place-items-center rounded-full text-2xl leading-none text-stone-700"
        >
          ‹
        </button>
        <h1 className="text-base font-black text-stone-900">{title}</h1>
      </div>

      {children}
    </main>
  );
}
