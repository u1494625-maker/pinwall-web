"use client";

type ExploreRefreshButtonProps = {
  onRefresh: () => void;
  refreshing: boolean;
};

/**
 * Small, icon-only manual refresh control for Explore — replaces the pull-
 * to-refresh gesture. Fixed to the lower-left of the app's own centered
 * max-w-md column, using the same inset-x-0/mx-auto/max-w-md centering
 * technique BottomNav already uses (so this lines up with the app's visual
 * column, not the raw browser viewport edge, on a wide desktop window) —
 * positioned to clear BottomNav's fixed 80px-tall bar underneath it.
 */
export default function ExploreRefreshButton({ onRefresh, refreshing }: ExploreRefreshButtonProps) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-20 mx-auto flex w-full max-w-md justify-start px-4">
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label="Refresh"
        className="pointer-events-auto grid size-9 place-items-center rounded-full bg-white/90 text-base text-stone-500 shadow-[0_4px_16px_rgba(50,40,30,0.18)] backdrop-blur transition-opacity disabled:opacity-50"
      >
        <span aria-hidden="true" className={refreshing ? "animate-spin" : undefined}>
          ↻
        </span>
      </button>
    </div>
  );
}
