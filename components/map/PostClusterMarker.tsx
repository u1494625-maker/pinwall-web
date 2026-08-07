import DemoPhoto from "@/components/DemoPhoto";

type PostClusterMarkerProps = {
  postCount: number;
  representativeImageUrl?: string;
};

function sizeClassFor(postCount: number) {
  if (postCount >= 50) return "size-16 text-base";
  if (postCount >= 10) return "size-14 text-sm";
  return "size-12 text-sm";
}

/**
 * Rendered to a static HTML string (via renderToStaticMarkup) and mounted as a
 * Leaflet divIcon, so this must stay presentational only — no hooks, no handlers.
 */
export default function PostClusterMarker({
  postCount,
  representativeImageUrl,
}: PostClusterMarkerProps) {
  return (
    <div
      className={`relative grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white shadow-lg ${sizeClassFor(postCount)}`}
    >
      {representativeImageUrl ? (
        <DemoPhoto
          src={representativeImageUrl}
          alt=""
          className="absolute inset-0 rounded-full"
        />
      ) : null}
      <div
        className={`absolute inset-0 rounded-full ${representativeImageUrl ? "bg-orange-500/70" : "bg-orange-500"}`}
      />
      <span className="relative font-black text-white">{postCount}</span>
    </div>
  );
}
