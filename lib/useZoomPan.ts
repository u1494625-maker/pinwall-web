"use client";

import { useEffect, useRef } from "react";

const MIN_SCALE = 1;
const MAX_SCALE = 4;
// Anything effectively back at 1 snaps exactly to it, rather than leaving a
// barely-off baseline (e.g. 1.004) sitting around after a pinch settles.
const SNAP_BACK_THRESHOLD = 1.02;
const SNAP_BACK_MS = 150;
// Same value and rationale as PostMediaGallery.tsx's usePointerTap (a real
// finger tap includes a few pixels of incidental movement) — not imported
// from there, since that would make this a circular import (see that
// file's own comment); kept in sync by convention, checked at each edit.
const TAP_MAX_MOVEMENT_PX = 12;

type UseZoomPanOptions = {
  /** Only the currently-visible slide should ever respond to touches. When
   *  this goes false (swiped away, or the fullscreen dialog closed —
   *  PostFullscreenGallery remounts fresh via its own key prop on every
   *  open, so there's nothing extra to do for "closed" specifically), any
   *  in-progress gesture is abandoned and the transform resets to 1/0/0 —
   *  there is no separate "which photo is zoomed" state to reconcile,
   *  since only ever one slide is active at a time. */
  active: boolean;
  /** Fires when a completed touch gesture on this slide qualifies as a tap:
   *  never more than one finger down at any point, and the primary finger
   *  never moved past TAP_MAX_MOVEMENT_PX — the same rule regardless of
   *  whether a pan was technically "armed" (state.scale > 1), so a tap
   *  closes the viewer whether zoomed in or not, and a real drag never
   *  does. Deliberately the ONLY tap/swipe/pinch/pan recognizer for
   *  PostFullscreenGallery — see this file's own top doc comment for why
   *  a separate pointer-event-based tap detector (usePointerTap) proved
   *  unreliable layered on top of this hook's raw touch listeners. */
  onTap?: () => void;
};

function touchDistance(a: Touch, b: Touch): number {
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Pinch-to-zoom + pan + tap-to-close for one fullscreen gallery slide — the
 * one unified touch-event state machine for this whole gesture surface
 * (tap, swipe, pinch, pan all reconciled together here), deliberately
 * touch-events-only rather than mixing in the pointer-event-based
 * usePointerTap the way an earlier version did. That mix was fragile: iOS
 * WKWebView fires pointercancel (not pointerup) once a drag is committed to
 * native scrolling, or once this hook's own touchmove preventDefault() is
 * called during a pinch/pan — and a pointer-based tap counter that only
 * listens for pointerup silently accumulates orphaned "still down" pointers
 * forever, eventually misreading every later tap as multi-touch. Touch
 * events don't have that ambiguity: touchend reliably fires for the full
 * gesture lifecycle even when native scrolling also happened for it.
 *
 * Plain refs and direct style mutation throughout for the zoom/pan
 * transform (never React state for the continuous gesture), same
 * imperative-DOM discipline as SwipeBackNav/pull-to-refresh elsewhere in
 * this app. Returns a ref to attach to the slide's own wrapper element;
 * nothing else to wire up. Gating single-finger pan vs. the shared
 * carousel's native scroll-snap swipe needs no coordination with that
 * container at all — calling preventDefault() inside this hook's own
 * touchmove (only when a pinch or an at-scale pan is actually in progress)
 * suppresses the ancestor's default scroll action for that same gesture; at
 * scale 1, a single finger never enters the pan branch, so normal
 * swipe-between-photos is completely untouched, and tap-tracking (below)
 * runs independently of it regardless.
 */
export function useZoomPan({ active, onTap }: UseZoomPanOptions) {
  const elementRef = useRef<HTMLDivElement>(null);
  const onTapRef = useRef(onTap);

  useEffect(() => {
    onTapRef.current = onTap;
  }, [onTap]);

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
      // Tracked independently of pinch/pan, from the first finger down to
      // the last finger up — a tap requires BOTH never-multi-touch AND
      // never-moved-past-threshold, checked once at touchend. Deliberately
      // tracked even while a pan is armed (state.scale > 1), so a genuine
      // tap while already zoomed in still closes the viewer; only an
      // actual drag (which also drives the pan above) disqualifies it.
      tap: null as null | { startX: number; startY: number; moved: boolean; multiTouch: boolean },
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
      if (event.touches.length === 1) {
        // Start of a brand-new gesture (first finger down) — always begin
        // tracking whether this turns out to be a tap, regardless of
        // whether pan also gets armed below.
        const touch = event.touches[0];
        state.tap = { startX: touch.clientX, startY: touch.clientY, moved: false, multiTouch: false };
      } else if (event.touches.length === 2 && state.tap) {
        // A second finger joining disqualifies the WHOLE gesture from ever
        // being a tap, even if it later reduces back to 1 or 0 fingers. (If
        // two fingers touch down simultaneously with no prior single-finger
        // start, state.tap is simply never set at all, which is the same
        // "never a tap" outcome by construction.)
        state.tap.multiTouch = true;
      }

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
      // Tap-disqualification runs independently of the pinch/pan branches
      // below — it only needs to know "did the primary finger ever move
      // past the threshold," not which gesture (if any) that movement was
      // interpreted as.
      if (state.tap && !state.tap.moved && event.touches.length >= 1) {
        const touch = event.touches[0];
        const dx = Math.abs(touch.clientX - state.tap.startX);
        const dy = Math.abs(touch.clientY - state.tap.startY);
        if (dx >= TAP_MAX_MOVEMENT_PX || dy >= TAP_MAX_MOVEMENT_PX) {
          state.tap.moved = true;
        }
      }

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

      if (event.touches.length === 0) {
        const tap = state.tap;
        state.tap = null;
        // touchcancel (this same handler is registered for both — see
        // below) never counts as a tap regardless of movement: it means
        // the OS/browser reinterpreted this gesture as something else
        // (e.g. a system gesture), not that the user completed a plain tap.
        if (event.type === "touchend" && tap && !tap.multiTouch && !tap.moved) {
          onTapRef.current?.();
        }
      }

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
