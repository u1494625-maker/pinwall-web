/**
 * Post-ranking sequencing pass: re-orders the already-scored, already-
 * jittered, already-sorted list so the same author doesn't appear twice in
 * a row and highly similar topics don't run together — never drops a post,
 * never adds a ranking signal, never touches score.ts's weights. If the
 * feed is genuinely all one topic/author, this leaves it as-is rather than
 * inventing an empty gap.
 *
 * Algorithm: walk the ranked list left to right, building an output
 * sequence. At each step, if the best-remaining candidate would violate
 * diversity against the post just placed, look ahead a small bounded
 * window (DIVERSITY_LOOKAHEAD) for the first candidate that doesn't — pull
 * it forward. If none exists in that window, keep the original best-ranked
 * candidate (no forced gap, no dropped post). This only ever swaps within a
 * small local window, so it can't meaningfully undo the actual ranking —
 * it's a local re-sequencing, not a re-scoring.
 */
import { CONTENT_SIMILARITY_THRESHOLD, DIVERSITY_LOOKAHEAD } from "./config";
import { tokenize } from "@/lib/textTokens";
import type { RankedPost } from "./types";
import type { Post } from "@/types/post";

/** Topic tokens for diversity purposes only: title + tags, deliberately
 *  excluding caption — caption is body prose and shares generic words
 *  across unrelated posts far too easily to be a reliable "same topic"
 *  signal; title/tags are the deliberately curated ones. Separate from
 *  score.ts's extractPostTokenWeights (which also includes caption, for
 *  personalization matching — a different concept from sequencing). */
function topicTokens(post: Post): Set<string> {
  const tokens = new Set<string>();
  for (const token of tokenize(post.title ?? "")) tokens.add(token);
  for (const token of tokenize(post.tags.join(" "))) tokens.add(token);
  return tokens;
}

/** Jaccard similarity over topic tokens — simple, deterministic, no NLP. */
function topicSimilarity(a: Post, b: Post): number {
  const tokensA = topicTokens(a);
  const tokensB = topicTokens(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection += 1;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function violatesDiversity(candidate: Post, previous: Post): boolean {
  const sameAuthor = Boolean(candidate.userId) && candidate.userId === previous.userId;
  if (sameAuthor) return true;
  return topicSimilarity(candidate, previous) >= CONTENT_SIMILARITY_THRESHOLD;
}

export function diversifySequence(rankedPosts: RankedPost[]): RankedPost[] {
  const remaining = rankedPosts.slice();
  const output: RankedPost[] = [];

  while (remaining.length > 0) {
    const previous = output[output.length - 1];
    let chosenIndex = 0;

    if (previous) {
      const lookaheadEnd = Math.min(remaining.length, DIVERSITY_LOOKAHEAD);
      for (let i = 0; i < lookaheadEnd; i++) {
        if (!violatesDiversity(remaining[i].post, previous.post)) {
          chosenIndex = i;
          break;
        }
      }
    }

    output.push(remaining[chosenIndex]);
    remaining.splice(chosenIndex, 1);
  }

  return output;
}
