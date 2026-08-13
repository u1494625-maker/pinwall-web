import DemoPhoto from "@/components/DemoPhoto";

type PostClusterMarkerProps = {
  itemCount: number;
  representativeImageUrl?: string;
};

/** The real rendered pixel size for a NO-image cluster's fallback bubble — single
 * source of truth for both this component's Tailwind class and MapPage's Leaflet
 * iconSize/iconAnchor. Image-bearing clusters instead use the fixed 80x80 box every
 * individual PostMapMarker already uses (see MapPage.tsx), so they read as a real
 * photo thumbnail rather than a shrunken circle. */
export function clusterMarkerSizePx(itemCount: number): number {
  if (itemCount >= 50) return 64;
  if (itemCount >= 10) return 56;
  return 48;
}

function sizeClassFor(itemCount: number) {
  const size = clusterMarkerSizePx(itemCount);
  if (size === 64) return "size-16 text-base";
  if (size === 56) return "size-14 text-sm";
  return "size-12 text-sm";
}

/**
 * Rendered to a static HTML string (via renderToStaticMarkup) and mounted as a
 * Leaflet divIcon, so this must stay presentational only — no hooks, no handlers.
 */
export default function PostClusterMarker({
  itemCount,
  representativeImageUrl,
}: PostClusterMarkerProps) {
  if (representativeImageUrl) {
    // Same box PostMapMarker uses for a single image post (w-20 + aspect-square,
    // rounded-xl, white border) — a cluster with a real photo should look like a
    // full-size photo pin, not a shrunken circle, regardless of itemCount.
    return (
      <div className="relative w-20 overflow-hidden rounded-xl border-2 border-white bg-white shadow-lg">
        <DemoPhoto src={representativeImageUrl} alt="" className="aspect-square w-full" />
        <span className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-xs font-black text-white shadow">
          {itemCount}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`relative grid place-items-center rounded-full border-2 border-white bg-orange-500 shadow-lg ${sizeClassFor(itemCount)}`}
    >
      <span className="relative font-black text-white">{itemCount}</span>
    </div>
  );
}
