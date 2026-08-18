/**
 * Orchestrates Recommendation V1 for the Explore feed: scores every
 * candidate post independently across quality/freshness/personalization/
 * exploration/penalties (score.ts), applies bounded seeded jitter
 * (jitter.ts), sorts, then re-sequences for author/topic diversity
 * (diversify.ts) — a re-ordering pass only, never dropping a post.
 *
 * This is the one function Explore's UI calls — the seam meant to let
 * candidate generation/ranking move server-side later without a UI
 * rewrite. Pure given its inputs, including diversification: same posts +
 * same signals + same seed always produces the same output. Deliberately
 * has no side effects (no sessionStorage writes) — marking which posts were
 * shown is the caller's job (see useExploreFeed), done only after this
 * function's full output — jitter and diversification included — is final.
 */
import { diversifySequence } from "./diversify";
import { applyJitter } from "./jitter";
import { createSeededRandom } from "./rng";
import { computeRecommendationScore } from "./score";
import type { InterestProfile, RankedPost } from "./types";
import type { Post } from "@/types/post";

export type RankExploreOptions = {
  posts: Post[];
  /** Injected, not read internally — see score.ts's RecommendationContext. */
  now: number;
  currentUserId?: string;
  interestProfile: InterestProfile;
  /** Anti-repetition only — see config.ts's SESSION_SEEN_BATCH_SIZE and the
   *  plan's Adjustment 1. This is always the PREVIOUS generation's seen-set
   *  (read once when this generation started — see useExploreFeed) never a
   *  live/reactive read, and this function never writes to it itself. */
  seenPostIds: Set<number>;
  /** One ranking generation = one seed. A fresh seed (see rng.ts's
   *  pickRankingSeed) is what a refresh uses to get new bounded jitter. */
  seed: number;
};

export function rankExplorePosts(options: RankExploreOptions): RankedPost[] {
  const { posts, now, currentUserId, interestProfile, seenPostIds, seed } = options;

  const scored = posts.map((post) => ({
    item: post,
    breakdown: computeRecommendationScore(post, { now, currentUserId, interestProfile, seenPostIds }),
  }));

  const random = createSeededRandom(seed);
  const jittered = applyJitter(scored, random);

  const sorted = jittered
    .slice()
    .sort((a, b) => b.jitteredScore - a.jitteredScore)
    .map(({ item, breakdown }) => ({ post: item, breakdown }));

  return diversifySequence(sorted);
}
