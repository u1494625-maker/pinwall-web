"use client";

import { useRef, useState } from "react";
import DemoPhoto from "@/components/DemoPhoto";
import { resolveImageAspectRatio } from "@/lib/postDisplay";
import type { PostMedia } from "@/types/post";

type PostMediaGalleryProps = {
  /** Ordered by position; media[0] is the cover. Never reordered here. */
  media: PostMedia[];
  /** Used for alt text — pass getDisplayTitle(post) from the caller. */
  title: string;
};

/**
 * A video post is always exactly one item (the composer's mode rules already
 * guarantee photos and video are never mixed), so this only ever needs a
 * single, non-paged <video> — no gallery wrapper, no indicator.
 */
function VideoMedia({ item }: { item: PostMedia }) {
  return (
    // Do not autoplay with sound — playback starts only via the native controls.
    <video
      src={item.url}
      controls
      playsInline
      preload="metadata"
      className="aspect-[4/3] w-full bg-black object-contain"
    />
  );
}

/** Identical markup to a plain single-photo post — no scroll container, no indicator. */
function SinglePhotoMedia({ item, title }: { item: PostMedia; title: string }) {
  return (
    <DemoPhoto
      src={item.url}
      alt={title}
      className="w-full"
      style={{ aspectRatio: resolveImageAspectRatio(item.aspectRatio) }}
    />
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
 */
function PhotoGallery({ media, title }: { media: PostMedia[]; title: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

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
        className="no-scrollbar flex h-[min(70svh,560px)] snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
      >
        {media.map((item, index) => (
          <div key={item.id} className="w-full shrink-0 snap-start snap-always">
            <DemoPhoto
              src={item.url}
              alt={`${title} — photo ${index + 1} of ${media.length}`}
              fit="contain"
              className="size-full"
            />
          </div>
        ))}
      </div>
      <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-bold text-white">
        {currentIndex + 1} / {media.length}
      </span>
    </div>
  );
}

export default function PostMediaGallery({ media, title }: PostMediaGalleryProps) {
  if (media.length === 0) return null;
  if (media[0].type === "video") return <VideoMedia item={media[0]} />;
  if (media.length === 1) return <SinglePhotoMedia item={media[0]} title={title} />;
  return <PhotoGallery media={media} title={title} />;
}
