import DemoPhoto from "@/components/DemoPhoto";
import TextPostVisual from "@/components/post/TextPostVisual";
import type { TextTemplateId } from "@/lib/textTemplates";
import type { PostMedia } from "@/types/post";

type PostMapMarkerProps = {
  /** The media to display — usually the post's cover (media[0]), but for a
   *  per-photo-located item this is that specific photo instead. Undefined
   *  for text posts. */
  cover: PostMedia | undefined;
  /** Already resolved (e.g. via getDisplayTitle) — this component doesn't
   *  handle a missing title. Shown as the label below the marker for every
   *  case except a templated text post, whose visual cover already shows it. */
  title: string;
  /** True for the post targeted via "View on Map" — a lightweight visual cue only, not a redesign. */
  highlighted?: boolean;
  /** Set only for a templated text post (media.length === 0 && textTemplate
   *  exists) — pre-resolved by the caller (MapPage.tsx passes getDisplayTitle(post),
   *  the same value as `title`) so this component stays purely presentational.
   *  Left undefined for a media post or a legacy text post with no template,
   *  in which case the generic pencil placeholder still renders. */
  textTemplate?: TextTemplateId;
};

/**
 * Rendered to a static HTML string (via renderToStaticMarkup) and mounted as a
 * Leaflet divIcon, so this must stay presentational only — no hooks, no handlers,
 * and no live <video> (a map pin can't sensibly host a playing video element).
 * `highlighted`'s pulse relies on the plain CSS `animate-ping` utility, which
 * still works in static markup since no JS/React is involved in the animation.
 * TextPostVisual is equally hook-free, so the same mechanism covers it.
 */
export default function PostMapMarker({ cover, title, highlighted = false, textTemplate }: PostMapMarkerProps) {
  const isTemplatedText = Boolean(textTemplate);

  return (
    <div className="flex w-20 flex-col items-center pb-1.5">
      <div className="relative w-full">
        {highlighted ? (
          <span className="absolute -inset-1.5 animate-ping rounded-xl bg-orange-400/50" />
        ) : null}
        <div
          className={`relative overflow-hidden rounded-xl border-2 bg-white shadow-lg ${
            highlighted ? "border-orange-500 ring-2 ring-orange-300" : "border-white"
          }`}
        >
          {cover?.type === "image" ? (
            <DemoPhoto src={cover.url} alt={title} className="aspect-square w-full" />
          ) : cover?.type === "video" && cover.thumbnailUrl ? (
            <div className="relative aspect-square w-full">
              <DemoPhoto src={cover.thumbnailUrl} alt={title} className="size-full" />
              <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/10">
                <span className="grid size-6 place-items-center rounded-full bg-white/90 text-xs text-stone-900">▶</span>
              </div>
            </div>
          ) : cover?.type === "video" ? (
            <div className="grid aspect-square w-full place-items-center bg-stone-800 text-base text-white">▶</div>
          ) : textTemplate ? (
            <TextPostVisual template={textTemplate} text={title} size="map" />
          ) : (
            <div className="grid aspect-square w-full place-items-center bg-orange-100 text-base text-orange-600">
              ✎
            </div>
          )}
        </div>
      </div>
      {/* A templated text post's cover already shows the title — a second
          label below would be a literal duplicate, so it's the only case
          this is skipped. No line-clamp elsewhere: a title never gets
          silently cut off here — bounded instead by TitleField's own
          40-char input cap plus a deliberately moderate max-width, so a
          long title wraps to a few short lines rather than either hiding
          text or growing without limit. */}
      {!isTemplatedText ? (
        <span className="mt-1 max-w-[6.5rem] rounded-lg bg-white/95 px-2 py-0.5 text-center text-[10px] font-bold leading-tight text-stone-900 shadow">
          {title}
        </span>
      ) : null}
    </div>
  );
}
