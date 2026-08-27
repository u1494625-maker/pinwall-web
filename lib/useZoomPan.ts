"use client";

import { useEffect, useRef } from "react";

const MIN_SCALE = 1;
const MAX_SCALE = 4;
// Anything effectively back at 1 snaps exactly to it, rather than leaving a
// barely-off baseline (e.g. 1.004) sitting around after a pinch settles.
const SNAP_BACK_THRESHOLD = 1.02;
const SNAP_BACK_MS = 150;

type UseZoomPanOptions = {
  /** Only the currently-visible slide should ever respond to touches. When
   *  this goes false (swiped away, or the fullscreen dialog closed —
   *  PostFullscreenGallery remounts fresh via its own key prop on every
   *  open, so there's nothing extra to do for "closed" specifically), any
   *  in-progress gesture is abandoned and the transform resets to 1/0/0 —
   *  there is no separate "which photo is zoomed" state to reconcile,
   *  since only ever one slide is active at a time. */
  active: boolean;
};

function touchDistance(a: Touch, b: Touch): number {
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Pinch-to-zoom + pan for one fullscreen gallery slide — plain refs and
 * direct style mutation throughout (never React state for the continuous
 * gesture), same imperative-DOM discipline as SwipeBackNav/pull-to-refresh
 * elsewhere in this app. Returns a ref to attach to the slide's own
 * wrapper element; nothing else to wire up. Gating single-finger pan vs.
 * the shared carousel's native scroll-snap swipe needs no coordination
 * with that container at all — calling preventDefault() inside this
 * hook's own touchmove (only when a pinch or an at-scale pan is actually
 * in progress) suppresses the ancestor's default scroll action for that
 * same gesture; at scale 1, a single finger never enters the pan branch,
 * so normal swipe-between-photos is completely untouched.
 */
export function useZoomPan({ active }: UseZoomPanOptions) {
  const elementRef = useRef<HTMLDivElement>(null);

  // Resets whenever this slide stops being the active one.
  useEffect(() => {
    if (active) return;
    const el = elementRef.current;
    if (!el) return;
    el.style.transition = "";
    el.style.transform = "";
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const node = elementRef.current;
    if (!node) return;
    // Re-bound to a fresh, non-nullable const: TypeScript's narrowing of
    // `node` above doesn't persist into the nested function declarations
    // below (same closure-narrowing limitation as SwipeBackNav.tsx), but a
    // new binding captured here is non-null throughout every closure that
    // follows.
    const el = node;

    const state = {
      scale: 1,
      translateX: 0,
      translateY: 0,
      pinch: null as null | {
        startDistance: number;
        startScale: number;
        startTranslateX: number;
        startTranslateY: number;
        offsetX: number;
        offsetY: number;
      },
      pan: null as null | { startX: number; startY: number; startTranslateX: number; startTranslateY: number },
    };

    function apply() {
      el.style.transform = `translate3d(${state.translateX}px, ${state.translateY}px, 0) scale(${state.scale})`;
    }

    // Keeps pan translation bounded so the image can never be dragged to
    // show empty space beyond its own (scaled) edges.
    function clampTranslate(scale: number, tx: number, ty: number) {
      const rect = el.getBoundingClientRect();
      const maxX = (rect.width * (scale - 1)) / 2;
      const maxY = (rect.height * (scale - 1)) / 2;
      return { x: clamp(tx, -maxX, maxX), y: clamp(ty, -maxY, maxY) };
    }

    function onTouchStart(event: TouchEvent) {
      if (event.touches.length === 2) {
        const [a, b] = [event.touches[0], event.touches[1]];
        const rect = el.getBoundingClientRect();
        const midpointX = (a.clientX + b.clientX) / 2;
        const midpointY = (a.clientY + b.clientY) / 2;
        state.pan = null;
        state.pinch = {
          startDistance: touchDistance(a, b),
          startScale: state.scale,
          startTranslateX: state.translateX,
          startTranslateY: state.translateY,
          // Gesture midpoint relative to the element's own center, in
          // local (unscaled) coordinates — used below to keep that point
          // visually anchored as scale changes ("centered on the gesture").
          offsetX: midpointX - (rect.left + rect.width / 2),
          offsetY: midpointY - (rect.top + rect.height / 2),
        };
      } else if (event.touches.length === 1 && state.scale > 1) {
        state.pinch = null;
        state.pan = {
          startX: event.touches[0].clientX,
          startY: event.touches[0].clientY,
          startTranslateX: state.translateX,
          startTranslateY: state.translateY,
        };
      }
    }

    function onTouchMove(event: TouchEvent) {
      if (event.touches.length === 2 && state.pinch) {
        event.preventDefault();
        const { pinch } = state;
        const currentDistance = touchDistance(event.touches[0], event.touches[1]);
        const newScale = clamp((pinch.startScale * currentDistance) / pinch.startDistance, MIN_SCALE, MAX_SCALE);
        const scaleDelta = newScale - pinch.startScale;
        const next = clampTranslate(
          newScale,
          pinch.startTranslateX - pinch.offsetX * (scaleDelta / pinch.startScale),
          pinch.startTranslateY - pinch.offsetY * (scaleDelta / pinch.startScale),
        );
        state.scale = newScale;
        state.translateX = next.x;
        state.translateY = next.y;
        apply();
      } else if (event.touches.length === 1 && state.pan) {
        event.preventDefault();
        const dx = event.touches[0].clientX - state.pan.startX;
        const dy = event.touches[0].clientY - state.pan.startY;
        const next = clampTranslate(state.scale, state.pan.startTranslateX + dx, state.pan.startTranslateY + dy);
        state.translateX = next.x;
        state.translateY = next.y;
        apply();
      }
    }

    function onTouchEnd(event: TouchEvent) {
      if (event.touches.length < 2) state.pinch = null;
      if (event.touches.length < 1) state.pan = null;

      if (state.scale <= SNAP_BACK_THRESHOLD) {
        state.scale = MIN_SCALE;
        state.translateX = 0;
        state.translateY = 0;
        el.style.transition = `transform ${SNAP_BACK_MS}ms ease-out`;
        apply();
        window.setTimeout(() => {
          // Fully cleared, not left at an explicit identity transform —
          // same discipline as SwipeBackNav/pull-to-refresh elsewhere in
          // this app: an element genuinely at rest carries no transform at
          // all, since an explicit (even identity) transform value still
          // creates a new containing block for any fixed/absolute
          // descendant, which "none" does not.
          el.style.transition = "";
          el.style.transform = "";
        }, SNAP_BACK_MS);
      }
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.style.transition = "";
      el.style.transform = "";
    };
  }, [active]);

  return elementRef;
}
