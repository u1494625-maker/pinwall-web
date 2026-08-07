"use client";

import LocationPicker from "@/components/map/LocationPicker";

type PostLocationFieldsProps = {
  showOnMap: boolean;
  onToggleShowOnMap: () => void;
  coords: { lat: number; lng: number } | null;
  onCoordsChange: (coords: { lat: number; lng: number }) => void;
  locationName: string;
  onLocationNameChange: (value: string) => void;
};

/** Shared "Show this post on the map" block, used by both MediaPostEditor and TextPostEditor. */
export default function PostLocationFields({
  showOnMap,
  onToggleShowOnMap,
  coords,
  onCoordsChange,
  locationName,
  onLocationNameChange,
}: PostLocationFieldsProps) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-stone-900">Show this post on the map</p>
          <p className="mt-0.5 text-xs text-stone-500">Optional — off by default.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={showOnMap}
          onClick={onToggleShowOnMap}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
            showOnMap ? "bg-orange-500" : "bg-stone-200"
          }`}
        >
          <span
            className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-transform ${
              showOnMap ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {showOnMap ? (
        <div className="mt-4 space-y-3">
          <LocationPicker value={coords} onChange={onCoordsChange} />
          <div>
            <label className="text-xs font-bold text-stone-700" htmlFor="locationName">
              Place name or address
            </label>
            <input
              id="locationName"
              value={locationName}
              onChange={(event) => onLocationNameChange(event.target.value)}
              placeholder="e.g. Mint Plaza, San Francisco"
              className="mt-1.5 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-400"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
