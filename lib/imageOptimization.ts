/**
 * Unified client-side photo optimization pipeline. Every selected photo —
 * whether it came from HEIC conversion or not — passes through
 * prepareImageForUpload() before upload. This module owns all resize/
 * re-encode/quality-target policy for photos; video never touches it.
 */

/** Pure safety guard against absurd files / excessive decode memory — not a quality target. */
export const MAX_IMAGE_SOURCE_BYTES = 25 * 1024 * 1024; // 25MB

/**
 * Soft optimization goal for the JPEG quality ladder — never a hard ceiling.
 * A successfully-processed photo is never rejected just because its output
 * lands above this; image quality wins over forcing an arbitrary byte number.
 */
export const TARGET_IMAGE_UPLOAD_BYTES = 1.5 * 1024 * 1024; // 1.5MB

/** Longest-side cap. Comfortably larger than any on-screen rendering size in
 *  this app; keeps worst-case decode/canvas memory bounded on mobile Safari. */
export const MAX_IMAGE_DIMENSION = 2560;

// Bounded — at most 4 encode attempts, never an unbounded loop.
const JPEG_QUALITY_LADDER = [0.9, 0.8, 0.7, 0.6];

const TRANSPARENCY_CAPABLE_TYPES = new Set(["image/png", "image/webp"]);
const ALPHA_SAMPLE_SIZE = 64;

export type ImageDiagnostics = {
  originalMimeType: string;
  originalSizeBytes: number;
  originalWidth: number;
  originalHeight: number;
  optimizedWidth: number;
  optimizedHeight: number;
  wasHeicConverted: boolean;
  wasResized: boolean;
  compressionApplied: boolean;
};

export type PreparedImage = {
  file: File;
  diagnostics: ImageDiagnostics;
};

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Canvas encoding failed."))), type, quality);
  });
}

/**
 * Cheap yes/no alpha check — samples a small downscaled copy of the image,
 * never the full-resolution buffer, since only presence/absence matters.
 */
function hasVisibleAlpha(bitmap: ImageBitmap): boolean {
  const canvas = document.createElement("canvas");
  canvas.width = ALPHA_SAMPLE_SIZE;
  canvas.height = ALPHA_SAMPLE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;

  ctx.drawImage(bitmap, 0, 0, ALPHA_SAMPLE_SIZE, ALPHA_SAMPLE_SIZE);
  const { data } = ctx.getImageData(0, 0, ALPHA_SAMPLE_SIZE, ALPHA_SAMPLE_SIZE);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

function baseNameWithoutExtension(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

/**
 * Decodes, measures, and — only when actually needed — resizes/re-encodes a
 * photo before upload. `wasHeicSource` is recorded as a diagnostic fact only;
 * it does not force a transform by itself — a HEIC file that already
 * converted down to something small and well-sized skips re-encoding too,
 * exactly like any other already-suitable photo (avoiding a second,
 * unnecessary generation-loss pass on top of the HEIC→JPEG conversion).
 *
 * Throws a single, uniform "couldn't process" error for any failure from
 * decode onward (corrupt/undecodable file, canvas unavailable, encode
 * failure) — the caller is responsible for treating this as one distinct
 * "image processing" category, separate from source validation.
 */
export async function prepareImageForUpload(file: File, wasHeicSource: boolean): Promise<PreparedImage> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const { width, height } = bitmap;

    const alreadySuitable = file.size <= TARGET_IMAGE_UPLOAD_BYTES && Math.max(width, height) <= MAX_IMAGE_DIMENSION;

    if (alreadySuitable) {
      bitmap.close();
      return {
        file,
        diagnostics: {
          originalMimeType: file.type,
          originalSizeBytes: file.size,
          originalWidth: width,
          originalHeight: height,
          optimizedWidth: width,
          optimizedHeight: height,
          wasHeicConverted: wasHeicSource,
          wasResized: false,
          compressionApplied: false,
        },
      };
    }

    const hasAlpha = TRANSPARENCY_CAPABLE_TYPES.has(file.type) && hasVisibleAlpha(bitmap);

    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context unavailable.");

    // Canvas pixels default to transparent black; without this fill, a JPEG
    // export (no alpha channel) bakes untouched transparent regions in as
    // black. Only fill when there's no real alpha to preserve instead.
    if (!hasAlpha) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, targetWidth, targetHeight);
    }
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    bitmap.close();

    const outputType = hasAlpha ? "image/png" : "image/jpeg";
    let blob: Blob;

    if (outputType === "image/png") {
      blob = await canvasToBlob(canvas, outputType);
    } else {
      blob = await canvasToBlob(canvas, outputType, JPEG_QUALITY_LADDER[0]);
      for (let i = 1; i < JPEG_QUALITY_LADDER.length && blob.size > TARGET_IMAGE_UPLOAD_BYTES; i += 1) {
        blob = await canvasToBlob(canvas, outputType, JPEG_QUALITY_LADDER[i]);
      }
      // Ladder exhausted and still above target: accept the floor-quality
      // result as-is. Never rejected — this is a soft target, not a cap.
    }

    const extension = outputType === "image/png" ? "png" : "jpg";
    const outputFile = new File([blob], `${baseNameWithoutExtension(file.name)}.${extension}`, { type: outputType });

    return {
      file: outputFile,
      diagnostics: {
        originalMimeType: file.type,
        originalSizeBytes: file.size,
        originalWidth: width,
        originalHeight: height,
        optimizedWidth: targetWidth,
        optimizedHeight: targetHeight,
        wasHeicConverted: wasHeicSource,
        wasResized: targetWidth !== width || targetHeight !== height,
        compressionApplied: true,
      },
    };
  } catch {
    throw new Error("We couldn't process this photo.");
  }
}
