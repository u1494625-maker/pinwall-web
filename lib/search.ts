import type { Post } from "@/types/post";

function toTimestamp(createdAt: string | undefined): number {
  if (!createdAt) return 0;
  const time = new Date(createdAt).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Client-side keyword search over the fields a post's author actually wrote —
 * title, tags, location, caption, author — weighted by how deliberate/curated
 * each field is. Substring matching, OR-semantics across query words (a post
 * matching only some words still appears, just ranked lower). No embeddings
 * or full-text index yet — this is "useful," not "sophisticated," and is
 * meant to be superseded by server-side full-text search once post volume
 * makes shipping the whole table to the client impractical.
 */
export function searchPosts(posts: Post[], query: string): Post[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const scored = posts.map((post) => {
    const fields: Array<[string, number]> = [
      [(post.title ?? "").toLowerCase(), 5],
      [post.tags.join(" ").toLowerCase(), 4],
      [(post.locationName ?? "").toLowerCase(), 3],
      [post.caption.toLowerCase(), 2],
      [post.author.toLowerCase(), 1],
    ];
    const score = tokens.reduce(
      (sum, token) => sum + fields.reduce((s, [text, weight]) => s + (text.includes(token) ? weight : 0), 0),
      0,
    );
    return { post, score };
  });

  return scored
    .filter(({ score }) => score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return toTimestamp(b.post.createdAt) - toTimestamp(a.post.createdAt);
    })
    .map(({ post }) => post);
}
