"use client";

import LocationPicker from "@/components/map/LocationPicker";

type PostLocationFieldsProps = {
  showOnMap: boolean;
  onToggleShowOnMap: () => void;
  coords: { lat: number; lng: number } | null;
  onCoordsChange: (coords: { lat: number; lng: number }) => void;
};

/** Shared "Show this post on the map" settings rows, used by both MediaPostEditor and TextPostEditor. */
export default function PostLocationFields({
  showOnMap,
  onToggleShowOnMap,
  coords,
  onCoordsChange,
}: PostLocationFieldsProps) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white">
      <div className="flex items-center justify-between gap-3 px-4 py-3.5">
        <p className="text-sm font-semibold text-stone-900">Show this post on the map</p>
        <button
          type="button"
          role="switch"
          aria-checked={showOnMap}
          onClick={onToggleShowOnMap}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            showOnMap ? "bg-orange-500" : "bg-stone-200"
          }`}
        >
          <span
            className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
              showOnMap ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {showOnMap ? (
        <div className="border-t border-stone-100 px-4 py-3.5">
          <LocationPicker value={coords} onChange={onCoordsChange} />
        </div>
      ) : null}
    </div>
  );
}
