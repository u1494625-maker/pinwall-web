import VideoFirstFramePreview from "@/components/VideoFirstFramePreview";

type PostVideoTileProps = {
  src: string;
  className?: string;
};

/**
 * A lightweight, non-interactive video preview for feed/grid contexts: muted,
 * playsInline, no autoplay, with a play indicator. For the real playable
 * player (with controls, unmuted), see Post Detail instead.
 */
export default function PostVideoTile({ src, className = "" }: PostVideoTileProps) {
  return (
    <div className={`relative overflow-hidden bg-kavanaka-ink ${className}`}>
      <VideoFirstFramePreview src={src} className="size-full object-cover" />
      <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/10">
        <span className="grid size-9 place-items-center rounded-full bg-white/90 text-base text-stone-900">▶</span>
      </div>
    </div>
  );
}
