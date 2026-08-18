"use client";

/**
 * A small, dependency-free pull-to-refresh gesture — nothing like this
 * exists anywhere else in the app to reuse, so this is built from raw
 * touch/mouse events rather than a new package.
 *
 * Two independent input paths, both gated the same way (only starts
 * tracking when the page is already scrolled to the very top — confirmed
 * this app has no nested scroll container: <main> has no overflow of its
 * own, the whole document/window scrolls, so window.scrollY === 0 really
 * is "at the top of Explore"):
 *
 * - Touch (mobile, the priority): touchstart/touchmove/touchend, passive
 *   (never preventDefault), so native scroll physics are completely
 *   unaffected.
 * - Mouse (desktop/trackpad testing): mousedown + a drag while the button
 *   stays held, tracked via window-level mousemove/mouseup once a drag
 *   starts (so a fast pointer leaving the container doesn't lose it) —
 *   deliberately NOT a wheel listener. A trackpad's ordinary two-finger
 *   scroll dispatches wheel events, never mousedown, so it can never be
 *   mistaken for this gesture; only an actual press-and-drag (an
 *   unambiguously intentional action) engages it.
 */
import { useEffect, useRef, useState, type RefObject } from "react";

const PULL_TRIGGER_DISTANCE_PX = 70;
const MAX_PULL_DISTANCE_PX = 120;

export function usePullToRefresh(
  containerRef: RefObject<HTMLElement | null>,
  onRefresh: () => void,
): { pullDistance: number; isPulling: boolean } {
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const startYRef = useRef<number | null>(null);
  const pullDistanceRef = useRef(0);
  // Always the latest onRefresh, read inside the native handlers below
  // instead of closing over whichever render bound the listeners.
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function begin(clientY: number) {
      startYRef.current = window.scrollY === 0 ? clientY : null;
    }

    function move(clientY: number) {
      if (startYRef.current === null) return;
      const delta = clientY - startYRef.current;
      const clamped = delta > 0 ? Math.min(delta, MAX_PULL_DISTANCE_PX) : 0;
      pullDistanceRef.current = clamped;
      setPullDistance(clamped);
      setIsPulling(clamped > 0);
    }

    // Shared release path for both input types — the single place that can
    // ever call onRefresh, so one gesture (regardless of how many
    // move/touchmove events it produced) can only ever fire it once.
    function end() {
      const triggered = startYRef.current !== null && pullDistanceRef.current >= PULL_TRIGGER_DISTANCE_PX;
      startYRef.current = null;
      pullDistanceRef.current = 0;
      setPullDistance(0);
      setIsPulling(false);
      if (triggered) {
        onRefreshRef.current();
      }
    }

    function handleTouchStart(event: TouchEvent) {
      begin(event.touches[0].clientY);
    }
    function handleTouchMove(event: TouchEvent) {
      move(event.touches[0].clientY);
    }

    // Mouse drag: mousemove/mouseup are bound to `window` only while a
    // drag that started on `container` is active, so a fast or wide
    // movement (mouse leaving the container's bounds mid-drag) is never
    // lost — the standard pattern for tracking a drag gesture. Removed
    // again on mouseup so an ordinary click elsewhere never carries a
    // leftover listener.
    function handleMouseMove(event: MouseEvent) {
      move(event.clientY);
      // Only once an actual pull is underway (never on mousedown itself,
      // so an ordinary click/link tap is completely unaffected) — avoids
      // the browser starting a text-selection drag mid-gesture.
      if (pullDistanceRef.current > 0) {
        event.preventDefault();
      }
    }
    function handleMouseUp() {
      end();
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    }
    function handleMouseDown(event: MouseEvent) {
      if (window.scrollY !== 0) return;
      begin(event.clientY);
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: true });
    container.addEventListener("touchend", end);
    container.addEventListener("mousedown", handleMouseDown);

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", end);
      container.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [containerRef]);

  return { pullDistance, isPulling };
}

export const PULL_TO_REFRESH_TRIGGER_DISTANCE_PX = PULL_TRIGGER_DISTANCE_PX;
