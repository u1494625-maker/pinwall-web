"use client";

import { PULL_TO_REFRESH_TRIGGER_DISTANCE_PX } from "@/lib/usePullToRefresh";

/** Minimal pull-to-refresh visual feedback — fades/labels in as the user
 *  drags, tells them once they've pulled far enough to release. Renders
 *  nothing while not actively pulling (the new order appearing immediately
 *  on release is the actual feedback that anything happened). */
export default function RefreshIndicator({ pullDistance }: { pullDistance: number }) {
  if (pullDistance <= 0) return null;

  const readyToRelease = pullDistance >= PULL_TO_REFRESH_TRIGGER_DISTANCE_PX;

  return (
    <div
      className="flex items-center justify-center py-2 text-xs font-bold text-orange-600"
      style={{ opacity: Math.min(pullDistance / 40, 1) }}
    >
      {readyToRelease ? "Release to refresh" : "Pull to refresh"}
    </div>
  );
}
