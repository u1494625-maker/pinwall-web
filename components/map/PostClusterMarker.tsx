import DemoPhoto from "@/components/DemoPhoto";

type PostClusterMarkerProps = {
  postCount: number;
  representativeImageUrl?: string;
};

/** The real rendered pixel size for a cluster bubble of this postCount — single source of
 * truth for both this component's Tailwind class and MapPage's Leaflet iconSize/iconAnchor. */
export function clusterMarkerSizePx(postCount: number): number {
  if (postCount >= 50) return 64;
  if (postCount >= 10) return 56;
  return 48;
}

function sizeClassFor(postCount: number) {
  const size = clusterMarkerSizePx(postCount);
  if (size === 64) return "size-16 text-base";
  if (size === 56) return "size-14 text-sm";
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
      className={`relative grid place-items-center rounded-full border-2 border-white shadow-lg ${sizeClassFor(postCount)}`}
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
