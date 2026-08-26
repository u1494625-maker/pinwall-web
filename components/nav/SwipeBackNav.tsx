"use client";

import { Capacitor } from "@capacitor/core";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

// A touch must begin within this many px of the physical left edge to be
// considered a back-swipe attempt at all — matches iOS's own screen-edge pan
// gesture convention, so it never competes with an ordinary horizontal
// gesture (e.g. swiping between photos) that starts away from the edge.
const EDGE_ZONE_PX = 24;
// Movement below this, in either axis, isn't enough to commit to a direction
// yet — avoids misreading a slightly-diagonal touch as vertical scroll (or
// vice versa) based on just its first pixel or two.
const DIRECTION_LOCK_PX = 10;
// Two independent ways to commit, exactly like a native interactive pop
// gesture: drag far enough, or flick fast enough even if short.
const COMMIT_FRACTION_OF_WIDTH = 0.3;
const COMMIT_VELOCITY_PX_PER_MS = 0.5;
const SLIDE_OUT_MS = 220;
const SNAP_BACK_MS = 220;

/**
 * Semantic allowlist, not "everything except the 4 root tabs" — a screen
 * only qualifies if its own Back control is already a plain router.back()
 * (or lands on the identical destination in practice), so a swipe can never
 * do something its real Back button wouldn't. Deliberately excludes the
 * /add* compose flows (their Cancel does more than plain back — draft
 * clearing/a different push) and /post/*\/edit and admin pages.
 */
function isSwipeBackEligible(pathname: string): boolean {
  if (pathname.startsWith("/post/")) {
    return !pathname.endsWith("/edit");
  }
  if (pathname.startsWith("/profile/")) return true;
  if (pathname === "/me/edit" || pathname === "/me/followers" || pathname === "/me/following") return true;
  if (pathname.startsWith("/messages/")) return true;
  if (pathname.startsWith("/map/cluster/")) return true;
  if (pathname.startsWith("/tag/")) return true;
  if (pathname === "/saved") return true;
  if (pathname === "/search") return true;
  return false;
}

type GestureState = {
  tracking: boolean;
  direction: "horizontal" | "vertical" | null;
  startX: number;
  startY: number;
  startTime: number;
  dragX: number;
};

function freshState(): GestureState {
  return { tracking: false, direction: null, startX: 0, startY: 0, startTime: 0, dragX: 0 };
}

type SwipeBackNavProps = {
  children: ReactNode;
};

/**
 * One reusable, globally-mounted edge-swipe-to-go-back gesture (see
 * app/layout.tsx) — native-only (Capacitor.isNativePlatform()), so the
 * website's own behavior is untouched by construction, not just by care.
 *
 * Drags the page via direct DOM style mutation (not React state) so the
 * transform updates every frame without a re-render; the transform is
 * cleared back to "" (not left at translateX(0px)) the instant a gesture
 * settles, since a lingering non-none transform would otherwise change how
 * any position:fixed descendant (action bars, dialogs, the fullscreen
 * gallery) is positioned for the rest of that page's lifetime.
 */
export default function SwipeBackNav({ children }: SwipeBackNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const routerRef = useRef(router);
  const eligibleRef = useRef(false);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    eligibleRef.current = Capacitor.isNativePlatform() && isSwipeBackEligible(pathname);
  }, [pathname]);

  // A completed back-swipe changes the pathname on its own; this also
  // covers every other kind of navigation (tab switches, links, etc.),
  // guaranteeing the next page never inherits a stale transform/transition.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    node.style.transition = "";
    node.style.transform = "";
  }, [pathname]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    // Re-bound to a fresh, non-nullable const: TypeScript's control-flow
    // narrowing of `node` above doesn't persist into the nested function
    // declarations below (a known closure-narrowing limitation), but a new
    // binding captured at this already-narrowed point is a plain
    // HTMLDivElement throughout every closure that follows.
    const el = node;

    const state = freshState();

    function onTouchStart(event: TouchEvent) {
      if (!eligibleRef.current) return;
      if (event.touches.length !== 1) return;

      const target = event.target as Element | null;
      // Overlays that need their own full control of touches inside them —
      // sheets/modals (all native <dialog>s in this app) and the one
      // full-screen non-dialog overlay (image crop), tagged explicitly.
      if (target?.closest("dialog, [data-no-swipe-back]")) return;

      const touch = event.touches[0];
      if (touch.clientX > EDGE_ZONE_PX) return;

      state.tracking = true;
      state.direction = null;
      state.startX = touch.clientX;
      state.startY = touch.clientY;
      state.startTime = Date.now();
      state.dragX = 0;
    }

    function onTouchMove(event: TouchEvent) {
      if (!state.tracking) return;
      const touch = event.touches[0];
      const dx = touch.clientX - state.startX;
      const dy = touch.clientY - state.startY;

      if (state.direction === null) {
        if (Math.abs(dx) < DIRECTION_LOCK_PX && Math.abs(dy) < DIRECTION_LOCK_PX) return;
        // Leftward or vertical-dominant -- not a back-swipe. Bail out
        // without ever calling preventDefault so scrolling/other gestures
        // proceed exactly as if this handler didn't exist.
        if (dx <= 0 || Math.abs(dy) > Math.abs(dx)) {
          state.tracking = false;
          return;
        }
        state.direction = "horizontal";
        el.style.transition = "none";
      }

      event.preventDefault();
      state.dragX = Math.max(0, dx);
      el.style.transform = `translateX(${state.dragX}px)`;
    }

    function settle(commit: boolean) {
      state.tracking = false;
      const duration = commit ? SLIDE_OUT_MS : SNAP_BACK_MS;
      el.style.transition = `transform ${duration}ms ease-out`;
      if (commit) {
        el.style.transform = "translateX(100%)";
        window.setTimeout(() => routerRef.current.back(), duration);
      } else {
        el.style.transform = "translateX(0px)";
        window.setTimeout(() => {
          el.style.transition = "";
          el.style.transform = "";
        }, duration);
      }
    }

    function onTouchEnd() {
      if (!state.tracking || state.direction !== "horizontal") {
        state.tracking = false;
        return;
      }
      const elapsed = Math.max(1, Date.now() - state.startTime);
      const velocity = state.dragX / elapsed;
      const width = window.innerWidth || 1;
      const commit = state.dragX > width * COMMIT_FRACTION_OF_WIDTH || velocity > COMMIT_VELOCITY_PX_PER_MS;
      settle(commit);
    }

    function onTouchCancel() {
      if (!state.tracking) return;
      settle(false);
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
    };
  }, []);

  return (
    <div ref={containerRef} style={{ willChange: "transform" }}>
      {children}
    </div>
  );
}
