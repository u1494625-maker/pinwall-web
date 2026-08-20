"use client";

import type { ReactNode } from "react";
import LocationPicker from "@/components/map/LocationPicker";

type PostLocationFieldsProps = {
  showOnMap: boolean;
  onToggleShowOnMap: () => void;
  coords: { lat: number; lng: number } | null;
  onCoordsChange: (coords: { lat: number; lng: number }) => void;
  /** Suppresses the built-in LocationPicker (but keeps the master toggle row
   *  above) — used by MediaPostEditor when per-photo mode is supplying its
   *  own location UI for this post instead. Defaults to false, so every
   *  other caller (TextPostEditor) is completely unaffected. */
  hidePicker?: boolean;
  /** Extra content rendered inside the "showOnMap" section, below the
   *  built-in picker (or in its place when hidePicker is true) — used by
   *  MediaPostEditor to nest the per-photo location option here so it only
   *  ever appears while this master switch is on. */
  children?: ReactNode;
};

/** Shared "Show this post on the map" settings rows, used by both MediaPostEditor and TextPostEditor. */
export default function PostLocationFields({
  showOnMap,
  onToggleShowOnMap,
  coords,
  onCoordsChange,
  hidePicker = false,
  children,
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
            showOnMap ? "bg-kavanaka-aqua" : "bg-stone-200"
          }`}
        >
          <span
            className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
              showOnMap ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {showOnMap ? (
        <div className="space-y-3 border-t border-stone-100 px-4 py-3.5">
          {!hidePicker ? <LocationPicker value={coords} onChange={onCoordsChange} /> : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}
