const HEIC_MIME_TYPES = ["image/heic", "image/heif"];
const HEIC_EXTENSIONS = [".heic", ".heif"];

// A single, fixed-quality conversion — no size-fitting ladder here anymore.
// HEIC's job is purely "produce a broadly-displayable JPEG"; final sizing is
// the unified prepareImageForUpload() pipeline's job (lib/imageOptimization.ts),
// which runs on this output next. Doing size-targeting in both places would
// mean compressing twice in sequence for no benefit.
const CONVERSION_QUALITY = 0.92;

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
 */
export async function convertHeicToJpeg(file: File): Promise<File> {
  const { heicTo } = await import("heic-to");
  const blob = await heicTo({ blob: file, type: "image/jpeg", quality: CONVERSION_QUALITY });
  const name = file.name.replace(/\.(heic|heif)$/i, "") + ".jpg";
  return new File([blob], name, { type: "image/jpeg" });
}
