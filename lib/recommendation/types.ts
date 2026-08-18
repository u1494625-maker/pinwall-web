/**
 * Shared types for Recommendation V1 personalization/scoring. Kept in one
 * place so score.ts, interestProfile.ts, and later rankExplorePosts.ts all
 * agree on the same shapes.
 */
import type { Post } from "@/types/post";

/** One behavioral signal, already normalized out of whichever source table
 *  it came from (post_saves/post_likes/comments/user_interest_events) — see
 *  interestProfile.ts's fetchInterestSignals. `search` carries a query
 *  string instead of a postId; every other type is tied to a post. */
export type InterestSignalEvent =
  | { type: "save" | "helpful" | "comment" | "detail_click" | "map_interaction"; postId: number; createdAt: string }
  | { type: "search"; query: string; createdAt: string };

export type InterestSignalType = InterestSignalEvent["type"];

/** A user's current interest, as a token -> weight map — built by
 *  buildInterestProfile with recency decay already applied and each token
 *  already capped. Never derived from raw impressions/dwell time. */
export type InterestProfile = {
  tokenWeights: Map<string, number>;
};

export type QualityBreakdown = {
  total: number;
  saves: number;
  helpfuls: number;
  comments: number;
};

export type PenaltyBreakdown = {
  total: number;
  ownPostPenalty: number;
  sessionSeenPenalty: number;
};

/** Full explainable score for one post — see the Recommendation V1 plan's
 *  explainability requirement. Every dimension is independently inspectable
 *  and independently tunable via lib/recommendation/config.ts. */
export type ScoreBreakdown = {
  total: number;
  quality: QualityBreakdown;
  freshness: number;
  personalization: number;
  exploration: number;
  penalties: PenaltyBreakdown;
};

/** Everything computeRecommendationScore needs beyond the post itself. `now`
 *  is injected (never read from Date.now() inside score.ts) so freshness/
 *  exploration/decay math stays deterministic and testable. */
export type RecommendationContext = {
  now: number;
  currentUserId?: string;
  interestProfile: InterestProfile;
  seenPostIds: Set<number>;
};

/** One post plus its full explainable score, in ranked order — what
 *  rankExplorePosts returns and what Explore's UI consumes. Kept as the
 *  post + breakdown pair (not just a sorted Post[]) so a future debug view
 *  can show the breakdown without the UI needing to recompute it. */
export type RankedPost = {
  post: Post;
  breakdown: ScoreBreakdown;
};
