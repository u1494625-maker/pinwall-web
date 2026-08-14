"use client";

import { useCallback, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";

type ImageCropModalProps = {
  /** Object URL of the just-selected source file — never uploaded itself;
   *  only the cropped output below ever reaches Storage. */
  imageSrc: string;
  shape: "round" | "rect";
  aspect: number;
  onCancel: () => void;
  onCropped: (blob: Blob) => void;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Couldn't load this image."));
    image.src = src;
  });
}

/** Draws exactly the cropped rectangle (in the source image's own pixel
 *  space, as reported by react-easy-crop) onto a same-size canvas and
 *  exports it — this canvas output IS the final image; nothing about the
 *  crop selection is ever stored, only this pre-cropped result. */
async function getCroppedImageBlob(imageSrc: string, area: Area): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(area.width));
  canvas.height = Math.max(1, Math.round(area.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas isn't supported in this browser.");

  ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't process this image."))), "image/jpeg", 0.9);
  });
}

/**
 * Reusable crop editor for both avatar (circular) and background
 * (rectangular) images — drag to reposition, zoom slider to scale. One
 * shared implementation, differing only in `shape`/`aspect`, per the
 * project's "one crop implementation, not two" requirement.
 */
export default function ImageCropModal({ imageSrc, shape, aspect, onCancel, onCropped }: ImageCropModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCropComplete = useCallback((_croppedArea: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  async function handleSave() {
    if (!croppedAreaPixels) return;
    setIsSaving(true);
    setError(null);
    try {
      const blob = await getCroppedImageBlob(imageSrc, croppedAreaPixels);
      onCropped(blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't process this image.");
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="relative flex-1">
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={aspect}
          cropShape={shape}
          showGrid={shape === "rect"}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={handleCropComplete}
        />
      </div>

      <div className="shrink-0 space-y-3 bg-black/90 px-5 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4">
        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
          aria-label="Zoom"
          className="w-full accent-orange-500"
        />

        {error ? <p className="text-center text-xs text-red-400">{error}</p> : null}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="flex-1 rounded-full bg-white/10 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !croppedAreaPixels}
            className="flex-1 rounded-full bg-orange-500 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {isSaving ? "Saving…" : "Use Photo"}
          </button>
        </div>
      </div>
    </div>
  );
}
