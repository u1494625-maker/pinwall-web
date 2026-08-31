import DemoPhoto from "@/components/DemoPhoto";
import TextPostVisual from "@/components/post/TextPostVisual";
import VideoFirstFramePreview from "@/components/VideoFirstFramePreview";
import type { TextTemplateId } from "@/lib/textTemplates";
import type { PostMedia } from "@/types/post";

type PostMapMarkerProps = {
  /** The media to display — usually the post's cover (media[0]), but for a
   *  per-photo-located item this is that specific photo instead. Undefined
   *  for text posts. */
  cover: PostMedia | undefined;
  /** Used only as this image's alt text — the marker never renders a
   *  permanent title label itself (see MapPage's SelectedPostPreview for
   *  where the full title actually shows, once this post is selected). */
  title: string;
  /** True for the single post currently emphasized on the map — either the
   *  "View on Map" deep-link target or whichever marker the user just
   *  tapped (MapPage unifies both into one concept, one visual treatment). */
  selected?: boolean;
  /** Set only for a templated text post (media.length === 0 && textTemplate
   *  exists) — pre-resolved by the caller so this component stays purely
   *  presentational. Left undefined for a media post or a legacy text post
   *  with no template, in which case the generic pencil placeholder renders. */
  textTemplate?: TextTemplateId;
};

/**
 * Rendered to a static HTML string (via renderToStaticMarkup) and mounted as a
 * Leaflet divIcon, so this must stay presentational only — no hooks, no
 * handlers. `selected`'s pulse relies on the plain CSS `animate-ping`
 * utility, which still works in static markup since no JS/React is involved
 * in the animation. TextPostVisual and VideoFirstFramePreview are equally
 * hook-free, so the same mechanism covers them.
 *
 * Deliberately no title label of any kind, selected or not — a compact
 * thumbnail is the whole marker. Tapping a marker selects it (MapPage shows
 * the post's title/location/time/Helpful count in a bottom preview card
 * instead of ever attaching that text to the pin itself), so nothing here
 * needs to reserve space for wrapped text anymore.
 */
export default function PostMapMarker({ cover, title, selected = false, textTemplate }: PostMapMarkerProps) {
  return (
    <div className="w-20">
      <div className="relative w-full">
        {selected ? (
          <span className="absolute -inset-1.5 animate-ping rounded-xl bg-kavanaka-green/50" />
        ) : null}
        <div
          className={`relative overflow-hidden rounded-xl border-2 bg-white shadow-lg transition-transform ${
            selected ? "scale-110 border-kavanaka-green ring-2 ring-kavanaka-green/40" : "border-white"
          }`}
        >
          {cover?.type === "image" ? (
            <DemoPhoto src={cover.url} alt={title} className="aspect-square w-full" />
          ) : cover?.type === "video" ? (
            <div className="relative aspect-square w-full bg-kavanaka-ink">
              <VideoFirstFramePreview src={cover.url} className="size-full object-cover" />
              <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/10">
                <span className="grid size-6 place-items-center rounded-full bg-white/90 text-xs text-stone-900">▶</span>
              </div>
            </div>
          ) : textTemplate ? (
            <TextPostVisual template={textTemplate} text={title} size="map" />
          ) : (
            <div className="grid aspect-square w-full place-items-center bg-kavanaka-aqua/15 text-base text-kavanaka-aqua">
              ✎
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
