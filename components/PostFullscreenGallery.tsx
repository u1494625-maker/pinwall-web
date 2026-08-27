"use client";

import { useEffect, useRef, useState, type PointerEvent, type SyntheticEvent } from "react";
import DemoPhoto from "@/components/DemoPhoto";
import { useZoomPan } from "@/lib/useZoomPan";
import type { PostMedia } from "@/types/post";

type PostFullscreenGalleryProps = {
  media: PostMedia[];
  title: string;
  open: boolean;
  /** Which photo to open on — read once, the moment `open` becomes true. */
  initialIndex: number;
  onClose: () => void;
  /** Called whenever the visible photo changes while open, so the caller's
   *  own index (e.g. the normal gallery's indicator) stays live-synced —
   *  omit for a single-photo post, where there's nothing to sync back. */
  onIndexChange?: (index: number) => void;
};

/**
 * One slide, pinch-zoom/pan/tap-to-close-capable via useZoomPan (that hook
 * owns the entire tap/swipe/pinch/pan recognition for this whole gallery —
 * see its own doc comment) — only the currently-active (visible) slide is
 * ever actually touchable, so `active` both gates the gesture and resets
 * scale/translate back to 1/0/0 the moment this slide stops being current
 * (swiped away, or a fresh dialog instance on reopen, since
 * PostFullscreenGallery remounts via its own key prop). `onTap` is passed
 * to every slide uniformly, since only the active one ever has listeners
 * attached to actually invoke it.
 *
 * useZoomPan's state machine is touch-events-only by design (see its doc
 * comment for why pointer events proved fragile here) — which means it can
 * never fire for a mouse-only pointer in the first place, since a plain
 * mouse never dispatches touchstart/touchend at all. This app is used from
 * a real desktop/web browser as well as Capacitor iOS, so onPointerUp below
 * is the mouse-input path — deliberately NOT a plain onClick. A tap that
 * opens this dialog is followed, on real touchscreens, by a delayed
 * synthetic "ghost click" compatibility event browsers replay for the same
 * tap (standard mobile-browser behavior, confirmed here empirically via
 * CDP touch dispatch); by the time it fires, this now-open dialog's slide
 * sits at those same screen coordinates, so a plain onClick here would
 * immediately re-close the dialog it just opened. Filtering to
 * pointerType === "mouse" sidesteps that entirely: real mice never have a
 * delayed ghost pointer event synthesized after them (unlike the legacy
 * click family), so this only ever fires for a genuine mouse click, never
 * as an echo of the touch tap that opened this dialog in the first place.
 */
function ZoomableSlide({
  item,
  active,
  alt,
  onTap,
}: {
  item: PostMedia;
  active: boolean;
  alt: string;
  onTap: () => void;
}) {
  const zoomRef = useZoomPan({ active, onTap });
  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse") onTap();
  }
  return (
    <div ref={zoomRef} onPointerUp={handlePointerUp} className="h-full w-full shrink-0 snap-start snap-always">
      <DemoPhoto src={item.url} alt={alt} fit="contain" placeholderClassName="bg-black" className="size-full" />
    </div>
  );
}

/**
 * Built on the native <dialog> element, matching this app's existing
 * PostManageSheet/AddPostActionSheet pattern: showModal() gives an inert
 * background and Escape-to-close for free. Unlike those two, this needs no
 * entrance animation — a photo viewer opening instantly is a normal, expected
 * pattern.
 *
 * showModal() alone does NOT reliably stop the page underneath from
 * scrolling (confirmed empirically — it blocks interaction/focus, not
 * scroll), and plain `overflow: hidden` on body is documented to fail on iOS
 * Safari specifically. The position:fixed-with-restored-offset technique
 * below is the standard, cross-browser-reliable fix for that gap.
 */
export default function PostFullscreenGallery({
  media,
  title,
  open,
  initialIndex,
  onClose,
  onIndexChange,
}: PostFullscreenGalleryProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Only measurable once the dialog is actually open — <dialog> is
      // `display: none` (and scrollRef.current.clientWidth is 0) right up
      // until showModal() flips its `open` attribute, so this must run
      // after that call, not in a useLayoutEffect racing ahead of it.
      const el = scrollRef.current;
      if (el) el.scrollLeft = initialIndex * el.clientWidth;
    }
    if (!open && dialog.open) dialog.close();
  }, [open, initialIndex]);

  useEffect(() => {
    if (!open) return;
    const scrollY = window.scrollY;
    const { body } = document;
    const previous = { position: body.style.position, top: body.style.top, width: body.style.width };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    return () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el || el.clientWidth === 0) return;
    const index = Math.round(el.scrollLeft / el.clientWidth);
    const clamped = Math.min(Math.max(index, 0), media.length - 1);
    // Calling onIndexChange (the parent's setState) from inside this
    // component's own updater function would update a different component
    // during this component's render — kept as two separate, sequential
    // calls instead, gated on the closed-over currentIndex from this render.
    if (clamped !== currentIndex) {
      setCurrentIndex(clamped);
      onIndexChange?.(clamped);
    }
  }

  function handleCancelEvent(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancelEvent}
      onClose={onClose}
      aria-label="Photo viewer — tap to close"
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-black"
    >
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="no-scrollbar flex h-full w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain bg-black"
      >
        {media.map((item, index) => (
          <ZoomableSlide
            key={item.id}
            item={item}
            active={index === currentIndex}
            alt={`${title} — photo ${index + 1} of ${media.length}`}
            onTap={onClose}
          />
        ))}
      </div>
      {media.length > 1 ? (
        <span className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+0.75rem)] text-center text-[13px] font-bold text-white">
          {currentIndex + 1} / {media.length}
        </span>
      ) : null}
    </dialog>
  );
}
