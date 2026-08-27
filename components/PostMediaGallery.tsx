"use client";

import Link from "next/link";
import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import DemoPhoto from "@/components/DemoPhoto";
import PostFullscreenGallery from "@/components/PostFullscreenGallery";
import { resolveImageAspectRatio } from "@/lib/postDisplay";
import type { PostMedia } from "@/types/post";

export type ViewOnMapTarget = { href: string; label: string };

type PostMediaGalleryProps = {
  /** Ordered by position; media[0] is the cover. Never reordered here. */
  media: PostMedia[];
  /** Used for alt text — pass getDisplayTitle(post) from the caller. */
  title: string;
  /** From /post/[id]?mediaId=... — which photo to open the gallery on. Only
   *  meaningful for PhotoGallery (the other variants have exactly one item). */
  initialMediaId?: number;
  /** Fires with the currently-visible photo whenever it changes (including
   *  via a swipe inside the fullscreen viewer) — lets the caller (PostDetail)
   *  own one single "active media" concept. Only fired by PhotoGallery. */
  onActiveMediaChange?: (media: PostMedia) => void;
  /** Precomputed by the caller (media-aware precedence lives in PostDetail) —
   *  null/undefined renders no pill at all. */
  viewOnMapTarget?: ViewOnMapTarget | null;
};

// A real finger tap naturally includes a few pixels of incidental movement —
// too small a threshold would misread genuine taps as swipes.
const TAP_MAX_MOVEMENT_PX = 12;

/**
 * Distinguishes a tap from a swipe using nothing but the pointer's start/end
 * coordinates — no preventDefault, no gesture library, native scrolling is
 * completely unaffected. Exported so PostFullscreenGallery can reuse it for
 * its own tap-to-close, matching this codebase's existing pattern of
 * exporting a small shared hook alongside its main component.
 *
 * Ignores any gesture where more than one pointer was ever down at once —
 * without this, a second finger touching down mid-pinch would silently
 * overwrite the tracked start point, and a quick two-finger pinch could
 * read back as a small enough net movement to register as a tap (closing
 * PostFullscreenGallery, or opening it, mid-gesture).
 */
export function usePointerTap(onTap: () => void) {
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const activePointerCountRef = useRef(0);
  const multiTouchRef = useRef(false);

  function onPointerDown(event: PointerEvent) {
    activePointerCountRef.current += 1;
    if (activePointerCountRef.current > 1) {
      multiTouchRef.current = true;
      return;
    }
    multiTouchRef.current = false;
    startRef.current = { x: event.clientX, y: event.clientY };
  }

  function onPointerUp(event: PointerEvent) {
    activePointerCountRef.current = Math.max(0, activePointerCountRef.current - 1);
    const start = startRef.current;
    startRef.current = null;
    if (multiTouchRef.current || !start) return;
    const dx = Math.abs(event.clientX - start.x);
    const dy = Math.abs(event.clientY - start.y);
    if (dx < TAP_MAX_MOVEMENT_PX && dy < TAP_MAX_MOVEMENT_PX) {
      onTap();
    }
  }

  return { onPointerDown, onPointerUp };
}

/** Compact overlay pill for "View on Map" — same visual language as the
 *  page-counter pill, placed in the opposite corner. A plain sibling
 *  element (never nested inside the tap-to-fullscreen target), so tapping
 *  it navigates instead of also opening the fullscreen viewer. */
function ViewOnMapPill({ target }: { target: ViewOnMapTarget }) {
  return (
    <Link
      href={target.href}
      className="absolute bottom-3 left-3 inline-flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-bold text-white"
    >
      📍 {target.label}
    </Link>
  );
}

/**
 * A video post is always exactly one item (the composer's mode rules already
 * guarantee photos and video are never mixed), so this only ever needs a
 * single, non-paged <video> — no gallery wrapper, no indicator, no fullscreen
 * viewer (photo fullscreen is explicitly out of scope for video this phase).
 */
function VideoMedia({ item, viewOnMapTarget }: { item: PostMedia; viewOnMapTarget?: ViewOnMapTarget | null }) {
  return (
    <div className="relative">
      {/* Do not autoplay with sound — playback starts only via the native controls.
          #t=0.001 forces iOS Safari to decode/paint a frame before playback starts. */}
      <video
        src={`${item.url}#t=0.001`}
        controls
        playsInline
        preload="metadata"
        className="aspect-[4/3] w-full bg-black object-contain"
      />
      {viewOnMapTarget ? <ViewOnMapPill target={viewOnMapTarget} /> : null}
    </div>
  );
}

/** Identical sizing to a plain single-photo post — no scroll container, no
 *  indicator — plus tap-to-fullscreen. */
function SinglePhotoMedia({
  item,
  title,
  viewOnMapTarget,
}: {
  item: PostMedia;
  title: string;
  viewOnMapTarget?: ViewOnMapTarget | null;
}) {
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  // Bumped on every open so PostFullscreenGallery remounts with fresh internal
  // state each time — same pattern as PostManageSheet's manageSheetKey.
  const [fullscreenKey, setFullscreenKey] = useState(0);
  const tapHandlers = usePointerTap(() => {
    setFullscreenKey((key) => key + 1);
    setIsFullscreenOpen(true);
  });

  return (
    <div className="relative">
      <div {...tapHandlers}>
        <DemoPhoto
          src={item.url}
          alt={title}
          className="w-full"
          style={{ aspectRatio: resolveImageAspectRatio(item.aspectRatio) }}
        />
      </div>
      {viewOnMapTarget ? <ViewOnMapPill target={viewOnMapTarget} /> : null}
      <PostFullscreenGallery
        key={fullscreenKey}
        media={[item]}
        title={title}
        open={isFullscreenOpen}
        initialIndex={0}
        onClose={() => setIsFullscreenOpen(false)}
      />
    </div>
  );
}

/**
 * 2–10 photos: one fixed-height horizontal scroll-snap strip. The height is a
 * stable viewer area — deliberately NOT derived from any single photo's
 * aspect ratio (that would let photo 1 dictate a box later photos get forced
 * into) — capped so it never grows unreasonably tall on a big screen. Every
 * slide is letterboxed (fit="contain") inside that same fixed box instead of
 * cropped or stretched, so neither the box nor the page below it ever jumps
 * mid-swipe, regardless of which photo's shape is currently visible.
 *
 * Tapping (not swiping) opens a fullscreen viewer at whichever photo is
 * currently snapped into view; swiping inside that viewer keeps this
 * component's own currentIndex in sync live, so closing it never needs a
 * separate reconciliation step.
 */
function PhotoGallery({
  media,
  title,
  initialMediaId,
  onActiveMediaChange,
  viewOnMapTarget,
}: {
  media: PostMedia[];
  title: string;
  initialMediaId?: number;
  onActiveMediaChange?: (media: PostMedia) => void;
  viewOnMapTarget?: ViewOnMapTarget | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Only the very first computed value is used to seed state — matching
  // PostFullscreenGallery's own initialIndex contract (read once, not
  // reactive to a later-changing initialMediaId prop).
  const initialIndex = useMemo(() => {
    if (initialMediaId == null) return 0;
    const index = media.findIndex((item) => item.id === initialMediaId);
    return index === -1 ? 0 : index;
  }, [media, initialMediaId]);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  // Bumped on every open so PostFullscreenGallery remounts with fresh internal
  // state each time — same pattern as PostManageSheet's manageSheetKey.
  const [fullscreenKey, setFullscreenKey] = useState(0);
  const tapHandlers = usePointerTap(() => {
    setFullscreenKey((key) => key + 1);
    setIsFullscreenOpen(true);
  });

  // Jump straight to the requested photo on mount, before paint — no visible
  // scroll animation through the intervening slides.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = initialIndex * el.clientWidth;
    // Only ever runs for the initial mount value — see initialIndex's own comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el || el.clientWidth === 0) return;
    const index = Math.round(el.scrollLeft / el.clientWidth);
    const clamped = Math.min(Math.max(index, 0), media.length - 1);
    if (clamped !== currentIndex) {
      setCurrentIndex(clamped);
      onActiveMediaChange?.(media[clamped]);
    }
  }

  // currentIndex is the one authoritative index — this is the single place
  // an EXTERNAL change (fullscreen's own swipe) is reconciled back into it,
  // and it's also the only place that needs to force this gallery's own
  // scroll position to match: the normal gallery is hidden behind
  // fullscreen's opaque dialog/backdrop while this fires, so there's no
  // live user drag on THIS element to fight. (handleScroll, above, is the
  // opposite direction — a live drag on this element updating currentIndex
  // to match — so it deliberately never writes scrollLeft back.)
  function handleFullscreenIndexChange(index: number) {
    setCurrentIndex(index);
    onActiveMediaChange?.(media[index]);
    const el = scrollRef.current;
    if (el) el.scrollLeft = index * el.clientWidth;
  }

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        {...tapHandlers}
        className="no-scrollbar flex h-[min(70svh,560px)] snap-x snap-mandatory overflow-x-auto overscroll-x-contain bg-[#fbfaf7]"
      >
        {media.map((item, index) => (
          <div key={item.id} className="w-full shrink-0 snap-start snap-always">
            <DemoPhoto
              src={item.url}
              alt={`${title} — photo ${index + 1} of ${media.length}`}
              fit="contain"
              placeholderClassName="bg-[#fbfaf7]"
              className="size-full"
            />
          </div>
        ))}
      </div>
      <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-bold text-white">
        {currentIndex + 1} / {media.length}
      </span>
      {viewOnMapTarget ? <ViewOnMapPill target={viewOnMapTarget} /> : null}
      <PostFullscreenGallery
        key={fullscreenKey}
        media={media}
        title={title}
        open={isFullscreenOpen}
        initialIndex={currentIndex}
        onClose={() => setIsFullscreenOpen(false)}
        onIndexChange={handleFullscreenIndexChange}
      />
    </div>
  );
}

export default function PostMediaGallery({
  media,
  title,
  initialMediaId,
  onActiveMediaChange,
  viewOnMapTarget,
}: PostMediaGalleryProps) {
  if (media.length === 0) return null;
  if (media[0].type === "video") return <VideoMedia item={media[0]} viewOnMapTarget={viewOnMapTarget} />;
  if (media.length === 1) return <SinglePhotoMedia item={media[0]} title={title} viewOnMapTarget={viewOnMapTarget} />;
  return (
    <PhotoGallery
      media={media}
      title={title}
      initialMediaId={initialMediaId}
      onActiveMediaChange={onActiveMediaChange}
      viewOnMapTarget={viewOnMapTarget}
    />
  );
}
