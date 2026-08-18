/**
 * The one shared definition of "what is a token" — Search, Map's keyword
 * filter (via postMatchesQuery), and recommendation personalization all
 * import this instead of maintaining separate ideas of what a keyword is.
 *
 * Smart Search V1: lowercase, strip punctuation (replaced with whitespace so
 * "well-known"/"coffee, tea" split into separate real words instead of
 * merging into one nonsense token), collapse whitespace, and drop a small,
 * conservative stopword list — low-information function words unlikely to
 * ever be someone's actual search intent on their own. Deliberately no
 * stemming, no fuzzy matching, no embeddings — broad recall comes from
 * OR-semantics substring matching in lib/search.ts, not from guessing word
 * forms here.
 */

const STOPWORDS = new Set([
  "a", "an", "the", "of", "and", "or", "for", "to", "in", "on", "at", "is", "with", "by",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0 && !STOPWORDS.has(token));
}
