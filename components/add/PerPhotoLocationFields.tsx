"use client";

import DemoPhoto from "@/components/DemoPhoto";
import LocationPicker from "@/components/map/LocationPicker";

type Photo = {
  key: string;
  previewUrl: string;
  location?: { lat: number; lng: number };
};

type PerPhotoLocationFieldsProps = {
  photos: Photo[];
  selectedKeys: Set<string>;
  onTogglePhoto: (key: string) => void;
  onSetLocationForSelected: (coords: { lat: number; lng: number }) => void;
  onClearLocationForSelected: () => void;
};

/**
 * Per-photo location assignment: multi-select any number of photos, then
 * place ONE pin below to assign that same location to every selected photo
 * at once — reuses LocationPicker as-is. It remounts (via `key`, since it
 * only reflects its `value` prop at mount) whenever the selected set
 * changes, and disappears entirely once a location is assigned and the
 * selection clears, ready for the next batch.
 */
export default function PerPhotoLocationFields({
  photos,
  selectedKeys,
  onTogglePhoto,
  onSetLocationForSelected,
  onClearLocationForSelected,
}: PerPhotoLocationFieldsProps) {
  const selectedPhotos = photos.filter((photo) => selectedKeys.has(photo.key));
  // A reasonable starting pin when the batch includes an already-located
  // photo — not an attempt to reconcile differing locations across a mixed
  // batch, just what the first selected photo (in strip order) already has.
  const initialValue = selectedPhotos[0]?.location ?? null;
  const hasExistingLocation = selectedPhotos.some((photo) => photo.location);
  const batchKey = selectedPhotos.map((photo) => photo.key).join(",");

  return (
    <div className="overflow-hidden rounded-2xl bg-white">
      <div className="flex gap-2 overflow-x-auto px-4 py-3.5">
        {photos.map((photo, index) => {
          const isSelected = selectedKeys.has(photo.key);
          return (
            <button
              key={photo.key}
              type="button"
              onClick={() => onTogglePhoto(photo.key)}
              aria-label={`${isSelected ? "Deselect" : "Select"} photo ${index + 1} for location assignment`}
              aria-pressed={isSelected}
              className={`relative size-16 shrink-0 overflow-hidden rounded-xl border-2 ${
                isSelected ? "border-orange-500" : "border-transparent"
              }`}
            >
              <DemoPhoto src={photo.previewUrl} alt={`Photo ${index + 1}`} className="size-full" />
              {isSelected ? (
                <span
                  aria-hidden="true"
                  className="absolute right-0.5 top-0.5 grid size-4 place-items-center rounded-full bg-orange-500 text-[9px] font-black leading-none text-white"
                >
                  ✓
                </span>
              ) : null}
              {photo.location ? (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0.5 right-0.5 grid size-4 place-items-center rounded-full bg-orange-500 text-[9px] leading-none text-white"
                >
                  📍
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {selectedPhotos.length > 0 ? (
        <div className="border-t border-stone-100 px-4 py-3.5">
          <p className="mb-2 text-[11px] font-bold text-stone-500">
            Location for {selectedPhotos.length} selected photo{selectedPhotos.length === 1 ? "" : "s"}
          </p>
          <LocationPicker key={batchKey} value={initialValue} onChange={onSetLocationForSelected} />
          {hasExistingLocation ? (
            <button
              type="button"
              onClick={onClearLocationForSelected}
              className="mt-2 text-[11px] font-bold text-stone-500 underline"
            >
              Remove location from selected photo{selectedPhotos.length === 1 ? "" : "s"}
            </button>
          ) : null}
        </div>
      ) : (
        <p className="border-t border-stone-100 px-4 py-3.5 text-[11px] text-stone-400">
          Tap one or more photos above to assign them a location.
        </p>
      )}
    </div>
  );
}
