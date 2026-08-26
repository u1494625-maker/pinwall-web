"use client";

import { Capacitor } from "@capacitor/core";
import type { ReactNode } from "react";
import { useExplorePullToRefresh } from "@/lib/useExplorePullToRefresh";

type ExplorePullToRefreshProps = {
  onRefresh: () => void;
  refreshing: boolean;
  children: ReactNode;
};

/**
 * Wraps Explore's feed content only (not ExploreRefreshButton, which stays a
 * fixed sibling outside this — see PinWallHome.tsx) with a native-only pull-
 * to-refresh gesture. Always renders the identical DOM structure on web and
 * native (deciding native-vs-web only inside the hook's effects, same as
 * SwipeBackNav) so there's no hydration mismatch; on web the hook simply
 * never attaches any listener, so normal browser behavior is untouched.
 */
export default function ExplorePullToRefresh({ onRefresh, refreshing, children }: ExplorePullToRefreshProps) {
  const { contentRef, indicatorRef } = useExplorePullToRefresh({
    enabled: Capacitor.isNativePlatform(),
    onRefresh,
    refreshing,
  });

  return (
    <div className="relative overflow-hidden">
      <div
        ref={indicatorRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center opacity-0"
      >
        <span
          className={`mt-3 grid size-8 place-items-center rounded-full bg-white/95 text-base text-stone-500 shadow-[0_4px_16px_rgba(50,40,30,0.18)] ${
            refreshing ? "animate-spin" : ""
          }`}
        >
          ↻
        </span>
      </div>
      <div ref={contentRef}>{children}</div>
    </div>
  );
}
