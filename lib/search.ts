import { FRESHNESS_WEIGHT } from "@/lib/recommendation/config";
import { computeFreshnessScore, computeQualityScore } from "@/lib/recommendation/score";
import { tokenize } from "@/lib/textTokens";
import type { Post } from "@/types/post";

function toTimestamp(createdAt: string | undefined): number {
  if (!createdAt) return 0;
  const time = new Date(createdAt).getTime();
  return Number.isNaN(time) ? 0 : time;
}

// Freshness/quality are only a tie-break nudge among posts whose lexical
// relevance is already close — never enough to overpower a real difference
// in how well a post matches the query. searchableFields' smallest weight is
// 1 (author name), so capping the combined nudge well under 1 guarantees
// even a single extra weak field match always outranks the maximum possible
// freshness+quality nudge. Personalization is deliberately never included
// here — explicit query relevance must dominate Search, and search-interest
// signals are for future Explore personalization only (see
// lib/recommendation/events.ts's logSearchQueryEvent).
const SEARCH_FRESHNESS_NUDGE_WEIGHT = 0.25;
const SEARCH_QUALITY_NUDGE_WEIGHT = 0.25;
// A well-engaged post's typical quality ballpark (e.g. ~15 saves ≈ 11) —
// saturates the nudge for outliers rather than letting quality grow unbounded.
const QUALITY_NUDGE_SATURATION = 10;

function tieBreakNudge(post: Post, now: number): number {
  const normalizedFreshness = computeFreshnessScore(post, now) / FRESHNESS_WEIGHT;
  const normalizedQuality = Math.min(computeQualityScore(post).total / QUALITY_NUDGE_SATURATION, 1);
  return SEARCH_FRESHNESS_NUDGE_WEIGHT * normalizedFreshness + SEARCH_QUALITY_NUDGE_WEIGHT * normalizedQuality;
}

/** The fields a post's author actually wrote — title, tags, location,
 *  caption — plus the author's current display name (via profiles, never a
 *  stored snapshot), weighted by how deliberate/curated each field is. The
 *  one shared definition of "matches a keyword," behind both postMatchesQuery
 *  and searchPosts below — never duplicate this list. */
function searchableFields(post: Post): Array<[string, number]> {
  return [
    [(post.title ?? "").toLowerCase(), 5],
    [post.tags.join(" ").toLowerCase(), 4],
    [(post.locationName ?? "").toLowerCase(), 3],
    [post.caption.toLowerCase(), 2],
    [post.authorDisplayName.toLowerCase(), 1],
  ];
}

function scorePost(post: Post, tokens: string[]): number {
  const fields = searchableFields(post);
  return tokens.reduce(
    (sum, token) => sum + fields.reduce((s, [text, weight]) => s + (text.includes(token) ? weight : 0), 0),
    0,
  );
}

/**
 * Whether `post` matches `query` at all — substring, OR-semantics across
 * query words, same fields/weights searchPosts ranks by, just collapsed to a
 * boolean. An empty/whitespace-only query matches every post (a "no filter
 * applied" vacuous match) — exactly what a caller filtering a list by an
 * optional keyword (e.g. Map's search) wants when the query is blank, with
 * no special-casing needed at the call site.
 */
export function postMatchesQuery(post: Post, query: string): boolean {
  const tokens = tokenize(query);
  if (tokens.length === 0) return true;
  return scorePost(post, tokens) > 0;
}

/**
 * Client-side keyword search over the fields a post's author actually wrote —
 * title, tags, location, caption — plus the author's current display name
 * (via profiles, never a stored snapshot — so renaming immediately changes
 * what search matches, same as every other display use of identity).
 * Weighted by how deliberate/curated each field is. Substring matching,
 * OR-semantics across query words (a post matching only some words still
 * appears, just ranked lower). Lexical relevance dominates the ranking;
 * freshness and post-quality only nudge genuine near-ties (see
 * tieBreakNudge above) — they can never overpower a real lexical gap, and
 * personalization never enters this at all. No embeddings or full-text
 * index yet — this is "useful," not "sophisticated," and is meant to be
 * superseded by server-side full-text search once post volume makes
 * shipping the whole table to the client impractical.
 *
 * `now` defaults to Date.now() for every real caller; tests pass an explicit
 * value so freshness-dependent ordering stays deterministic.
 */
export function searchPosts(posts: Post[], query: string, now: number = Date.now()): Post[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  return posts
    .map((post) => ({ post, lexicalScore: scorePost(post, tokens) }))
    .filter(({ lexicalScore }) => lexicalScore > 0)
    .map(({ post, lexicalScore }) => ({ post, rankScore: lexicalScore + tieBreakNudge(post, now) }))
    .sort((a, b) => {
      if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
      return toTimestamp(b.post.createdAt) - toTimestamp(a.post.createdAt);
    })
    .map(({ post }) => post);
}
