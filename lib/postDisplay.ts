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
