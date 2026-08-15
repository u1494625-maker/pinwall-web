import type { Post } from "@/types/post";

const EXCERPT_LENGTH = 60;

/**
 * A post's title if it has one, otherwise a short excerpt of its caption.
 * Text posts may be published without a title — every place that renders a
 * post heading should go through this instead of reading `post.title` directly.
 */
export function getDisplayTitle(post: Post): string {
  const trimmedTitle = post.title?.trim();
  if (trimmedTitle) return trimmedTitle;

  const excerpt = post.caption.trim();
  if (excerpt.length <= EXCERPT_LENGTH) return excerpt;
  return `${excerpt.slice(0, EXCERPT_LENGTH).trimEnd()}…`;
}

/** Shared short relative-timestamp format ("3m ago", "2d ago", falling back
 *  to a bare date past a week) — used anywhere a post/comment/notification
 *  shows "when", so every timestamp in the app reads the same way. */
export function formatRelativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return "Just now";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(then);
}

/** Fallback used only when a post's stored image_aspect is missing or unparseable. */
export const DEFAULT_IMAGE_ASPECT_RATIO = "4/5";

const IMAGE_ASPECT_RATIO_PATTERN = /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/;

/**
 * Reads image_aspect into a CSS aspect-ratio value. Handles both the new bare
 * "W/H" format (new image uploads) and the legacy Tailwind-class-shaped format
 * ("aspect-[4/5]", still present on rows created before this format changed) —
 * the regex just extracts the W/H pair wherever it appears, ignoring any
 * wrapping syntax. Falls back to DEFAULT_IMAGE_ASPECT_RATIO for anything else
 * (null, undefined, or unrecognized values).
 */
export function resolveImageAspectRatio(imageAspect: string | null | undefined): string {
  const match = imageAspect?.match(IMAGE_ASPECT_RATIO_PATTERN);
  if (!match) return DEFAULT_IMAGE_ASPECT_RATIO;
  return `${match[1]}/${match[2]}`;
}

/**
 * Measures a media file's natural aspect ratio client-side, from an already-
 * created object URL. Used at publish time so an image post's stored
 * image_aspect always reflects its real dimensions — never a guessed default.
 */
export function measureImageAspectRatio(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(`${img.naturalWidth}/${img.naturalHeight}`);
    img.onerror = () => reject(new Error("Couldn't read that image. Try choosing it again."));
    img.src = url;
  });
}
