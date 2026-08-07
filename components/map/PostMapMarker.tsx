import DemoPhoto from "@/components/DemoPhoto";
import type { PostType } from "@/types/post";

type PostMapMarkerProps = {
  postType: PostType;
  image: string | null;
  imageAlt: string | null;
  /** Already resolved (e.g. via getDisplayTitle) — this component doesn't handle a missing title. */
  title: string;
};

/**
 * Rendered to a static HTML string (via renderToStaticMarkup) and mounted as a
 * Leaflet divIcon, so this must stay presentational only — no hooks, no handlers,
 * and no live <video> (a map pin can't sensibly host a playing video element).
 */
export default function PostMapMarker({ postType, image, imageAlt, title }: PostMapMarkerProps) {
  return (
    <div className="flex w-20 -translate-x-1/2 -translate-y-full flex-col items-center pb-1.5">
      <div className="overflow-hidden rounded-xl border-2 border-white bg-white shadow-lg">
        {postType === "image" && image ? (
          <DemoPhoto src={image} alt={imageAlt ?? ""} className="aspect-square w-full" />
        ) : postType === "video" ? (
          <div className="grid aspect-square w-full place-items-center bg-stone-800 text-base text-white">▶</div>
        ) : (
          <div className="grid aspect-square w-full place-items-center bg-orange-100 text-base text-orange-600">
            ✎
          </div>
        )}
      </div>
      <span className="mt-1 line-clamp-1 max-w-[5.5rem] rounded-full bg-white/95 px-2 py-0.5 text-center text-[10px] font-bold leading-tight text-stone-900 shadow">
        {title}
      </span>
    </div>
  );
}
