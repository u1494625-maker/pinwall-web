type VideoFirstFramePreviewProps = {
  src: string;
  className?: string;
};

/**
 * The actual "show this video's own first frame as a static cover" trick,
 * shared by every place in the app that wants that — never a real player,
 * never audio, never autoplay. Muted + playsInline + preload="metadata" +
 * the #t=0.001 fragment forces the browser (iOS Safari in particular, whose
 * conservative preload policy otherwise leaves the tile blank) to decode and
 * paint a frame without playback ever starting.
 *
 * Deliberately just the bare <video> — no wrapper, no play-glyph overlay —
 * so each caller keeps its own existing sizing/overlay chrome exactly as it
 * was. Hook-free and prop-only on purpose: this also has to work when
 * rendered via `renderToStaticMarkup` (see PostMapMarker.tsx), not just
 * through normal React mounting — a `<video muted>` behaves identically
 * either way once its markup is attached to the live document, since `muted`
 * is one of the few HTML attributes that reflects straight from parsed
 * markup into the real DOM property.
 */
export default function VideoFirstFramePreview({ src, className = "" }: VideoFirstFramePreviewProps) {
  return <video src={`${src}#t=0.001`} muted playsInline preload="metadata" className={className} />;
}
