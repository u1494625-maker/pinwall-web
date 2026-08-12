import DemoPhoto from "@/components/DemoPhoto";
import type { PostMedia } from "@/types/post";

type PostMapMarkerProps = {
  /** The post's cover media (media[0]) — undefined for text posts. */
  cover: PostMedia | undefined;
  /** Already resolved (e.g. via getDisplayTitle) — this component doesn't handle a missing title. */
  title: string;
  /** True for the post targeted via "View on Map" — a lightweight visual cue only, not a redesign. */
  highlighted?: boolean;
};

/**
 * Rendered to a static HTML string (via renderToStaticMarkup) and mounted as a
 * Leaflet divIcon, so this must stay presentational only — no hooks, no handlers,
 * and no live <video> (a map pin can't sensibly host a playing video element).
 * `highlighted`'s pulse relies on the plain CSS `animate-ping` utility, which
 * still works in static markup since no JS/React is involved in the animation.
 */
export default function PostMapMarker({
  cover,
  title,
  highlighted = false,
}: PostMapMarkerProps) {
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
          ) : cover?.type === "video" ? (
            <div className="grid aspect-square w-full place-items-center bg-stone-800 text-base text-white">▶</div>
          ) : (
            <div className="grid aspect-square w-full place-items-center bg-orange-100 text-base text-orange-600">
              ✎
            </div>
          )}
        </div>
      </div>
      <span className="mt-1 line-clamp-1 max-w-[5.5rem] rounded-full bg-white/95 px-2 py-0.5 text-center text-[10px] font-bold leading-tight text-stone-900 shadow">
        {title}
      </span>
    </div>
  );
}
