"use client";

import { useEffect, useRef } from "react";

// Only a downward drag that starts genuinely at the top of the document
// counts — anywhere else is normal scrolling, untouched.
const DIRECTION_LOCK_PX = 10;
const COMMIT_DISTANCE_PX = 70;
const MAX_PULL_PX = 100;
// Rubber-band resistance so the pull feels bounded/native, not 1:1 forever.
const PULL_DAMPING = 0.5;
const SETTLE_MS = 200;

type UseExplorePullToRefreshOptions = {
  /** Native-only gate, computed by the caller — this hook attaches zero
   *  listeners at all when false, so web is completely untouched. */
  enabled: boolean;
  onRefresh: () => void;
  /** Drives the held "refreshing" resting position and when it releases
   *  back to 0 — tied to the SAME refresh() this hook triggers, not a
   *  locally-tracked guess, so the indicator reflects reality even if the
   *  underlying refresh takes a while. */
  refreshing: boolean;
};

/**
 * Native-feeling pull-to-refresh for Explore only (mounted by
 * ExplorePullToRefresh.tsx around Explore's feed content, nowhere else).
 *
 * Exactly like SwipeBackNav.tsx: every transform/transition is set
 * imperatively via direct DOM mutation, and cleared back to "" (never left
 * at translateY(0px), never will-change) the instant a gesture or the
 * refresh itself settles — a lingering non-none transform on an ancestor
 * would otherwise break any position:fixed descendant, which is exactly the
 * regression this whole file has to avoid reintroducing. There are none
 * inside the Explore feed content itself (PostCard has no fixed children),
 * but the discipline is kept identical on purpose.
 */
export function useExplorePullToRefresh({ enabled, onRefresh, refreshing }: UseExplorePullToRefreshOptions) {
  const contentRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const enabledRef = useRef(enabled);
  const onRefreshRef = useRef(onRefresh);
  const refreshingRef = useRef(refreshing);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);
  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);

  // Once the actual refresh completes, release the held position back to 0.
  useEffect(() => {
    if (refreshing) return;
    const content = contentRef.current;
    const indicator = indicatorRef.current;
    if (!content || !indicator) return;

    content.style.transition = `transform ${SETTLE_MS}ms ease-out`;
    indicator.style.transition = `transform ${SETTLE_MS}ms ease-out, opacity ${SETTLE_MS}ms ease-out`;
    content.style.transform = "translateY(0px)";
    indicator.style.opacity = "0";
    indicator.style.transform = "translateY(0px) scale(0.5)";

    const timeout = window.setTimeout(() => {
      content.style.transition = "";
      content.style.transform = "";
      indicator.style.transition = "";
      indicator.style.opacity = "";
      indicator.style.transform = "";
    }, SETTLE_MS);

    return () => window.clearTimeout(timeout);
  }, [refreshing]);

  useEffect(() => {
    const content = contentRef.current;
    const indicator = indicatorRef.current;
    if (!content || !indicator) return;
    // Re-bound to fresh, non-nullable consts -- TypeScript's narrowing of
    // `content`/`indicator` above doesn't persist into the nested function
    // declarations below (same closure-narrowing limitation as
    // SwipeBackNav.tsx), but a new binding captured here is non-null
    // throughout every closure that follows.
    const contentEl = content;
    const indicatorEl = indicator;

    const state = {
      tracking: false,
      direction: null as "vertical" | "horizontal" | null,
      startX: 0,
      startY: 0,
      pullDistance: 0,
    };

    function onTouchStart(event: TouchEvent) {
      if (!enabledRef.current || refreshingRef.current) return;
      if (event.touches.length !== 1) return;
      // Only from the very top of the document -- otherwise this is just
      // ordinary scrolling, and must stay completely untouched.
      if (window.scrollY > 0) return;

      const target = event.target as Element | null;
      if (target?.closest("dialog, [data-no-swipe-back]")) return;

      const touch = event.touches[0];
      state.tracking = true;
      state.direction = null;
      state.startX = touch.clientX;
      state.startY = touch.clientY;
      state.pullDistance = 0;
    }

    function onTouchMove(event: TouchEvent) {
      if (!state.tracking) return;
      const touch = event.touches[0];
      const dx = touch.clientX - state.startX;
      const dy = touch.clientY - state.startY;

      if (state.direction === null) {
        if (Math.abs(dx) < DIRECTION_LOCK_PX && Math.abs(dy) < DIRECTION_LOCK_PX) return;
        // Upward, horizontal-dominant, or already scrolled away from the
        // top by the time direction locks -- not a pull-to-refresh. Bail
        // without ever calling preventDefault so scrolling/the left-edge
        // swipe-back gesture proceed exactly as if this didn't exist.
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || window.scrollY > 0) {
          state.tracking = false;
          return;
        }
        state.direction = "vertical";
        contentEl.style.transition = "none";
        indicatorEl.style.transition = "none";
      }

      event.preventDefault();
      const damped = Math.min(MAX_PULL_PX, Math.max(0, dy) * PULL_DAMPING);
      state.pullDistance = damped;
      const progress = Math.min(1, damped / COMMIT_DISTANCE_PX);
      contentEl.style.transform = `translateY(${damped}px)`;
      indicatorEl.style.opacity = String(progress);
      indicatorEl.style.transform = `translateY(${damped}px) scale(${0.5 + progress * 0.5})`;
    }

    function settle(commit: boolean) {
      state.tracking = false;
      if (commit) {
        onRefreshRef.current();
        // Held at a small resting offset while the refresh is actually in
        // flight -- the `refreshing` effect above releases it once done.
        const restingOffset = COMMIT_DISTANCE_PX * 0.6;
        contentEl.style.transition = `transform ${SETTLE_MS}ms ease-out`;
        indicatorEl.style.transition = `transform ${SETTLE_MS}ms ease-out`;
        contentEl.style.transform = `translateY(${restingOffset}px)`;
        indicatorEl.style.opacity = "1";
        indicatorEl.style.transform = `translateY(${restingOffset}px) scale(1)`;
      } else {
        contentEl.style.transition = `transform ${SETTLE_MS}ms ease-out`;
        indicatorEl.style.transition = `transform ${SETTLE_MS}ms ease-out, opacity ${SETTLE_MS}ms ease-out`;
        contentEl.style.transform = "translateY(0px)";
        indicatorEl.style.opacity = "0";
        indicatorEl.style.transform = "translateY(0px) scale(0.5)";
        window.setTimeout(() => {
          contentEl.style.transition = "";
          contentEl.style.transform = "";
          indicatorEl.style.transition = "";
          indicatorEl.style.opacity = "";
          indicatorEl.style.transform = "";
        }, SETTLE_MS);
      }
    }

    function onTouchEnd() {
      if (!state.tracking || state.direction !== "vertical") {
        state.tracking = false;
        return;
      }
      settle(state.pullDistance >= COMMIT_DISTANCE_PX);
    }

    function onTouchCancel() {
      if (!state.tracking) return;
      settle(false);
    }

    contentEl.addEventListener("touchstart", onTouchStart, { passive: true });
    contentEl.addEventListener("touchmove", onTouchMove, { passive: false });
    contentEl.addEventListener("touchend", onTouchEnd, { passive: true });
    contentEl.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      contentEl.removeEventListener("touchstart", onTouchStart);
      contentEl.removeEventListener("touchmove", onTouchMove);
      contentEl.removeEventListener("touchend", onTouchEnd);
      contentEl.removeEventListener("touchcancel", onTouchCancel);
    };
  }, []);

  return { contentRef, indicatorRef };
}
