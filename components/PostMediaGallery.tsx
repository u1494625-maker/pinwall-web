"use client";

import { useRef, useState, type PointerEvent } from "react";
import DemoPhoto from "@/components/DemoPhoto";
import PostFullscreenGallery from "@/components/PostFullscreenGallery";
import { resolveImageAspectRatio } from "@/lib/postDisplay";
import type { PostMedia } from "@/types/post";

type PostMediaGalleryProps = {
  /** Ordered by position; media[0] is the cover. Never reordered here. */
  media: PostMedia[];
  /** Used for alt text — pass getDisplayTitle(post) from the caller. */
  title: string;
};

// A real finger tap naturally includes a few pixels of incidental movement —
// too small a threshold would misread genuine taps as swipes.
const TAP_MAX_MOVEMENT_PX = 12;

/**
 * Distinguishes a tap from a swipe using nothing but the pointer's start/end
 * coordinates — no preventDefault, no gesture library, native scrolling is
 * completely unaffected. Exported so PostFullscreenGallery can reuse it for
 * its own tap-to-close, matching this codebase's existing pattern of
 * exporting a small shared hook alongside its main component (see
 * useSavedPostIds in PostCard.tsx).
 */
export function usePointerTap(onTap: () => void) {
  const startRef = useRef<{ x: number; y: number } | null>(null);

  function onPointerDown(event: PointerEvent) {
    startRef.current = { x: event.clientX, y: event.clientY };
  }

  function onPointerUp(event: PointerEvent) {
    const start = startRef.current;
    startRef.current = null;
    if (!start) return;
    const dx = Math.abs(event.clientX - start.x);
    const dy = Math.abs(event.clientY - start.y);
    if (dx < TAP_MAX_MOVEMENT_PX && dy < TAP_MAX_MOVEMENT_PX) {
      onTap();
    }
  }

  return { onPointerDown, onPointerUp };
}

/**
 * A video post is always exactly one item (the composer's mode rules already
 * guarantee photos and video are never mixed), so this only ever needs a
 * single, non-paged <video> — no gallery wrapper, no indicator, no fullscreen
 * viewer (photo fullscreen is explicitly out of scope for video this phase).
 */
function VideoMedia({ item }: { item: PostMedia }) {
  return (
    // Do not autoplay with sound — playback starts only via the native controls.
    // #t=0.001 forces iOS Safari to decode/paint a frame before playback starts.
    <video
      src={`${item.url}#t=0.001`}
      controls
      playsInline
      preload="metadata"
      className="aspect-[4/3] w-full bg-black object-contain"
    />
  );
}

/** Identical sizing to a plain single-photo post — no scroll container, no
 *  indicator — plus tap-to-fullscreen. */
function SinglePhotoMedia({ item, title }: { item: PostMedia; title: string }) {
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  // Bumped on every open so PostFullscreenGallery remounts with fresh internal
  // state each time — same pattern as PostManageSheet's manageSheetKey.
  const [fullscreenKey, setFullscreenKey] = useState(0);
  const tapHandlers = usePointerTap(() => {
    setFullscreenKey((key) => key + 1);
    setIsFullscreenOpen(true);
  });

  return (
    <>
      <div {...tapHandlers}>
        <DemoPhoto
          src={item.url}
          alt={title}
          className="w-full"
          style={{ aspectRatio: resolveImageAspectRatio(item.aspectRatio) }}
        />
      </div>
      <PostFullscreenGallery
        key={fullscreenKey}
        media={[item]}
        title={title}
        open={isFullscreenOpen}
        initialIndex={0}
        onClose={() => setIsFullscreenOpen(false)}
      />
    </>
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
function PhotoGallery({ media, title }: { media: PostMedia[]; title: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  // Bumped on every open so PostFullscreenGallery remounts with fresh internal
  // state each time — same pattern as PostManageSheet's manageSheetKey.
  const [fullscreenKey, setFullscreenKey] = useState(0);
  const tapHandlers = usePointerTap(() => {
    setFullscreenKey((key) => key + 1);
    setIsFullscreenOpen(true);
  });

  function handleScroll() {
    const el = scrollRef.current;
    if (!el || el.clientWidth === 0) return;
    const index = Math.round(el.scrollLeft / el.clientWidth);
    const clamped = Math.min(Math.max(index, 0), media.length - 1);
    setCurrentIndex((prev) => (prev === clamped ? prev : clamped));
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
      <PostFullscreenGallery
        key={fullscreenKey}
        media={media}
        title={title}
        open={isFullscreenOpen}
        initialIndex={currentIndex}
        onClose={() => setIsFullscreenOpen(false)}
        onIndexChange={setCurrentIndex}
      />
    </div>
  );
}

export default function PostMediaGallery({ media, title }: PostMediaGalleryProps) {
  if (media.length === 0) return null;
  if (media[0].type === "video") return <VideoMedia item={media[0]} />;
  if (media.length === 1) return <SinglePhotoMedia item={media[0]} title={title} />;
  return <PhotoGallery media={media} title={title} />;
}
