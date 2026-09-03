"use client";

import { useEffect, type PointerEvent } from "react";
import DemoPhoto from "@/components/DemoPhoto";
import { useZoomPan } from "@/lib/useZoomPan";

type MessageImageFullscreenProps = {
  /** null closes the viewer — same "value or null" pattern as every other
   *  conditionally-rendered overlay in ConversationScreen. */
  imageUrl: string | null;
  onClose: () => void;
};

/**
 * Minimal single-image fullscreen viewer for a tapped chat-bubble image —
 * deliberately not PostFullscreenGallery, whose PostMedia[]/index/swipe API
 * has nothing to offer a single image with no siblings to swipe between.
 * Reuses useZoomPan (lib/useZoomPan.ts) for pinch-zoom/pan/tap-to-close, and
 * the same position:fixed body-scroll-lock technique PostFullscreenGallery
 * uses — a plain fixed overlay alone does not reliably stop the page
 * scrolling underneath on iOS Safari/WKWebView.
 */
export default function MessageImageFullscreen({ imageUrl, onClose }: MessageImageFullscreenProps) {
  const isOpen = imageUrl !== null;
  const zoomRef = useZoomPan({ active: isOpen, onTap: onClose });

  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen]);

  // Mouse-input path, same reasoning as PostFullscreenGallery's ZoomableSlide:
  // useZoomPan is touch-events-only, so a real mouse click never reaches
  // onTap on its own.
  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse") onClose();
  }

  if (!imageUrl) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black" role="dialog" aria-label="Photo viewer — tap to close">
      <div ref={zoomRef} onPointerUp={handlePointerUp} className="size-full">
        <DemoPhoto src={imageUrl} alt="" fit="contain" placeholderClassName="bg-black" className="size-full" />
      </div>
    </div>
  );
}
