import { MAX_IMAGE_BYTES } from "@/lib/storage";

const HEIC_MIME_TYPES = ["image/heic", "image/heif"];
const HEIC_EXTENSIONS = [".heic", ".heif"];

/**
 * HEIC source files get their own, more generous ceiling before conversion is
 * even attempted — HEIC's compression means a real iPhone photo can
 * legitimately exceed the 5MB *final upload* limit while still converting
 * down to a compliant JPEG. This only gates the original file; the output is
 * always separately guaranteed to fit MAX_IMAGE_BYTES by convertHeicToJpeg.
 */
export const MAX_HEIC_SOURCE_BYTES = 15 * 1024 * 1024;

// Descending, bounded retry ladder — never more than 3 encode attempts total,
// never an unbounded/open-ended compression loop.
const CONVERSION_QUALITIES = [0.9, 0.7, 0.5];

/**
 * iOS/macOS often report HEIC files with an empty or inconsistent MIME type,
 * so this also checks the filename extension as a fallback signal. Cheap and
 * synchronous, so it never forces the heic-to WASM bundle to load for
 * non-HEIC files — only files that pass this check trigger the dynamic
 * import in convertHeicToJpeg below.
 */
export function isHeicFile(file: File): boolean {
  if (HEIC_MIME_TYPES.includes(file.type.toLowerCase())) return true;
  const name = file.name.toLowerCase();
  return HEIC_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/**
 * Converts a HEIC/HEIF file to JPEG client-side — most browsers (Chrome,
 * Firefox, Edge, many Safari versions) can't reliably decode/display HEIC, so
 * storing it directly would break previews for most future viewers.
 * Dynamically imported so the WASM decoder is only fetched when a HEIC file
 * is actually selected — matching this codebase's existing pattern for other
 * heavy client-only libraries (see lib/map/clustering.ts, LocationPicker.tsx).
 *
 * Tries decreasing JPEG quality until the output fits under MAX_IMAGE_BYTES,
 * so a high-resolution photo doesn't get rejected just because the first,
 * highest-quality attempt happened to come out too large. Throws a clear,
 * specific error if even the lowest quality still doesn't fit — this is a
 * bounded compression retry, not a general image-processing pipeline.
 */
export async function convertHeicToJpeg(file: File): Promise<File> {
  const { heicTo } = await import("heic-to");

  for (const quality of CONVERSION_QUALITIES) {
    const blob = await heicTo({ blob: file, type: "image/jpeg", quality });
    if (blob.size <= MAX_IMAGE_BYTES) {
      const name = file.name.replace(/\.(heic|heif)$/i, "") + ".jpg";
      return new File([blob], name, { type: "image/jpeg" });
    }
  }

  throw new Error(
    `This photo is too large even after compression. Choose a smaller photo (under ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB).`,
  );
}
