"use client";

import { useRef, useState } from "react";
import TextPostVisual from "@/components/post/TextPostVisual";
import { paginateText } from "@/lib/textPagination";
import type { TextTemplateId } from "@/lib/textTemplates";

type TextPostPagesProps = {
  template: TextTemplateId;
  /** The complete original caption — pagination happens here, not in the
   *  caller. The caption itself is untouched; only this rendering is split. */
  caption: string;
};

/**
 * PostDetail's text-post equivalent of PostMediaGallery's PhotoGallery: a
 * horizontal scroll-snap strip with a "current / total" pill, same
 * interaction language as the photo carousel. A dedicated component rather
 * than reusing PhotoGallery directly — that component's props and its
 * PostFullscreenGallery tap target are shaped around real PostMedia/Storage
 * URLs, and forcing paginated text through that shape would mean inventing
 * fake PostMedia rows just to satisfy it, which is exactly what this feature
 * must not do (the caption stays the only source of truth; pages are never
 * stored — see lib/textPagination.ts).
 */
export default function TextPostPages({ template, caption }: TextPostPagesProps) {
  const pages = paginateText(caption, template);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el || el.clientWidth === 0) return;
    const index = Math.round(el.scrollLeft / el.clientWidth);
    const clamped = Math.min(Math.max(index, 0), pages.length - 1);
    if (clamped !== currentIndex) setCurrentIndex(clamped);
  }

  if (pages.length <= 1) {
    return <TextPostVisual template={template} text={pages[0] ?? ""} size="detail" />;
  }

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
      >
        {pages.map((page, index) => (
          <div key={index} className="w-full shrink-0 snap-start snap-always">
            <TextPostVisual template={template} text={page} size="detail" />
          </div>
        ))}
      </div>
      <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-bold text-white">
        {currentIndex + 1} / {pages.length}
      </span>
    </div>
  );
}
