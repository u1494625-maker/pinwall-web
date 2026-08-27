import { FRESHNESS_WEIGHT } from "@/lib/recommendation/config";
import { computeFreshnessScore, computeQualityScore } from "@/lib/recommendation/score";
import { matchScore } from "@/lib/textMatch";
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

type FieldWeights = {
  title: number;
  tags: number;
  location: number;
  caption: number;
  author: number;
};

// Search stays broad — every field a post's author actually wrote, plus the
// author's current display name (via profiles, never a stored snapshot).
const SEARCH_WEIGHTS: FieldWeights = { title: 5, tags: 4, location: 3, caption: 2, author: 1 };

// Tag Feed stays topic-focused: tags dominate so strongly (10 vs. everything
// else combined only summing to 7) that an exact/stemmed tag match always
// outranks a post that merely mentions the term elsewhere; author is
// dropped entirely (weight 0 fields are skipped below), and title/caption/
// location are supporting signals only — see rankPostsByTag's qualifying
// check for why a synonym-only hit in one of those can't alone let an
// unrelated post into the feed.
const TAG_WEIGHTS: FieldWeights = { title: 3, tags: 10, location: 2, caption: 2, author: 0 };

type WeightedField = { text: string; weight: number };

/** The fields a post's author actually wrote — title, tags, location,
 *  caption — plus the author's current display name, paired with whichever
 *  weight profile the caller (Search or Tag Feed) is using. A field whose
 *  weight is 0 (author, for Tag Feed) is dropped entirely rather than
 *  scored and multiplied by zero, so it's never even matched against. */
function weightedFields(post: Post, weights: FieldWeights): WeightedField[] {
  return [
    { text: (post.title ?? "").toLowerCase(), weight: weights.title },
    { text: post.tags.join(" ").toLowerCase(), weight: weights.tags },
    { text: (post.locationName ?? "").toLowerCase(), weight: weights.location },
    { text: post.caption.toLowerCase(), weight: weights.caption },
    { text: post.authorDisplayName.toLowerCase(), weight: weights.author },
  ].filter((field) => field.weight > 0);
}

function scoreFields(fields: WeightedField[], tokens: string[]): number {
  return tokens.reduce(
    (sum, token) => sum + fields.reduce((s, { text, weight }) => s + matchScore(text, token) * weight, 0),
    0,
  );
}

/**
 * Whether `post` matches `query` at all — substring/stem/synonym-tolerant,
 * OR-semantics across query words, same fields/weights searchPosts ranks
 * by, just collapsed to a boolean. An empty/whitespace-only query matches
 * every post (a "no filter applied" vacuous match) — exactly what a caller
 * filtering a list by an optional keyword (e.g. Map's search) wants when
 * the query is blank, with no special-casing needed at the call site.
 */
export function postMatchesQuery(post: Post, query: string): boolean {
  const tokens = tokenize(query);
  if (tokens.length === 0) return true;
  return scoreFields(weightedFields(post, SEARCH_WEIGHTS), tokens) > 0;
}

/**
 * Client-side keyword search over the fields a post's author actually wrote —
 * title, tags, location, caption — plus the author's current display name
 * (via profiles, never a stored snapshot — so renaming immediately changes
 * what search matches, same as every other display use of identity).
 * Weighted by how deliberate/curated each field is. Tolerant of plural/
 * singular inflection and a small set of related terms (see
 * lib/textMatch.ts) on top of substring matching, OR-semantics across
 * query words (a post matching only some words still appears, just ranked
 * lower — matching more words, or matching the same word more exactly,
 * both push a post higher). Lexical relevance dominates the ranking;
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
    .map((post) => ({ post, lexicalScore: scoreFields(weightedFields(post, SEARCH_WEIGHTS), tokens) }))
    .filter(({ lexicalScore }) => lexicalScore > 0)
    .map(({ post, lexicalScore }) => ({ post, rankScore: lexicalScore + tieBreakNudge(post, now) }))
    .sort((a, b) => {
      if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
      return toTimestamp(b.post.createdAt) - toTimestamp(a.post.createdAt);
    })
    .map(({ post }) => post);
}

/**
 * Tag Feed's ranking — reuses the exact same tokenize/matchScore pipeline
 * as searchPosts above (so #clubs benefits from the same stemming/synonym
 * tolerance a free-text search would), but with TAG_WEIGHTS instead of
 * SEARCH_WEIGHTS and a stricter qualifying rule than "any score > 0":
 * a post only enters the feed if it has SOME match (exact, stemmed, or
 * synonym) in its own tags, OR an exact/stemmed (never synonym-only) match
 * in title/caption/location. This is what keeps Tag Feed topic-focused —
 * a single related word landing in a caption can boost an already-
 * qualifying post's rank, but can never by itself pull an otherwise-
 * unrelated post into the feed.
 */
export function rankPostsByTag(posts: Post[], tag: string, now: number = Date.now()): Post[] {
  const tokens = tokenize(tag);
  if (tokens.length === 0) return [];

  return posts
    .map((post) => {
      const tagsText = post.tags.join(" ").toLowerCase();
      const titleText = (post.title ?? "").toLowerCase();
      const captionText = post.caption.toLowerCase();
      const locationText = (post.locationName ?? "").toLowerCase();

      const hasTagMatch = tokens.some((token) => matchScore(tagsText, token) > 0);
      const hasExactSupportingMatch = tokens.some(
        (token) =>
          matchScore(titleText, token) === 1 ||
          matchScore(captionText, token) === 1 ||
          matchScore(locationText, token) === 1,
      );
      const qualifies = hasTagMatch || hasExactSupportingMatch;

      const lexicalScore = scoreFields(weightedFields(post, TAG_WEIGHTS), tokens);
      return { post, qualifies, lexicalScore };
    })
    .filter(({ qualifies, lexicalScore }) => qualifies && lexicalScore > 0)
    .map(({ post, lexicalScore }) => ({ post, rankScore: lexicalScore + tieBreakNudge(post, now) }))
    .sort((a, b) => {
      if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
      return toTimestamp(b.post.createdAt) - toTimestamp(a.post.createdAt);
    })
    .map(({ post }) => post);
}
