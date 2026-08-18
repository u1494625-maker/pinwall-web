/**
 * Pure scoring primitives for Recommendation V1. No network, no DOM, no
 * randomness — every function here is a deterministic function of its
 * arguments, which is what makes them independently unit-testable and safe
 * to reuse from Smart Search's freshness/quality tie-breaking (Phase B)
 * without dragging personalization along with them.
 *
 * Kept deliberately separate: qualityScore, freshnessScore,
 * personalizationScore, explorationScore, and penalties are distinct
 * dimensions, summed only at the very end in computeRecommendationScore —
 * never folded into one "interaction hierarchy" formula.
 */
import { tokenize } from "@/lib/textTokens";
import type { Post } from "@/types/post";
import {
  EXPLORATION_HALF_LIFE_HOURS,
  EXPLORATION_WEIGHT,
  FRESHNESS_HALF_LIFE_HOURS,
  FRESHNESS_WEIGHT,
  OWN_POST_PENALTY,
  PERSONALIZATION_MAX_CONTRIBUTION,
  QUALITY_COMMENT_WEIGHT,
  QUALITY_HELPFUL_WEIGHT,
  QUALITY_SAVE_WEIGHT,
  SESSION_SEEN_PENALTY,
  TOKEN_SOURCE_WEIGHT_CAPTION,
  TOKEN_SOURCE_WEIGHT_TAGS,
  TOKEN_SOURCE_WEIGHT_TITLE,
} from "./config";
import type { InterestProfile, PenaltyBreakdown, QualityBreakdown, RecommendationContext, ScoreBreakdown } from "./types";

/** Continuous half-life decay — 1.0 at age 0, 0.5 at one half-life, etc. */
function halfLifeDecayHours(ageMs: number, halfLifeHours: number): number {
  const ageHours = ageMs / (1000 * 60 * 60);
  return Math.pow(0.5, ageHours / halfLifeHours);
}

/** Age in ms since a post's createdAt, treated as "brand new" (0) rather
 *  than NaN/negative for a missing timestamp or clock skew — never lets a
 *  malformed date silently zero out or blow up freshness/exploration. */
function ageMsSinceCreated(post: Post, now: number): number {
  if (!post.createdAt) return 0;
  const ageMs = now - new Date(post.createdAt).getTime();
  return Number.isFinite(ageMs) && ageMs > 0 ? ageMs : 0;
}

/**
 * Community-quality signal from a post's own aggregate engagement (already
 * batched via get_post_engagement — no new query). log1p-damped so a post
 * with 100 saves doesn't score literally 100x a post with 1 save. Save
 * weighted above Helpful above Comment, per the product's stated hierarchy.
 */
export function computeQualityScore(post: Post): QualityBreakdown {
  const saves = QUALITY_SAVE_WEIGHT * Math.log1p(post.saveCount);
  const helpfuls = QUALITY_HELPFUL_WEIGHT * Math.log1p(post.likeCount);
  const comments = QUALITY_COMMENT_WEIGHT * Math.log1p(post.commentCount);
  return { total: saves + helpfuls + comments, saves, helpfuls, comments };
}

/** Continuous exponential decay on post age — see config.ts for the curve's
 *  documented shape at 24h/72h/168h. */
export function computeFreshnessScore(post: Post, now: number): number {
  return FRESHNESS_WEIGHT * halfLifeDecayHours(ageMsSinceCreated(post, now), FRESHNESS_HALF_LIFE_HOURS);
}

/**
 * A post's own topic tokens, weighted by how deliberate/curated each source
 * field is (title/tags highest, caption lower) — deliberately excludes
 * locationName and authorDisplayName, so recommendation personalization
 * never becomes a location or identity signal (Search is a separate scoring
 * system and is unaffected by this). Reused both to attribute interest FROM
 * a post the user engaged with, and to match a candidate post's tokens
 * AGAINST the resulting interest profile.
 */
export function extractPostTokenWeights(post: Post): Map<string, number> {
  const weights = new Map<string, number>();

  function add(text: string, sourceWeight: number) {
    for (const token of tokenize(text)) {
      weights.set(token, (weights.get(token) ?? 0) + sourceWeight);
    }
  }

  add(post.title ?? "", TOKEN_SOURCE_WEIGHT_TITLE);
  add(post.tags.join(" "), TOKEN_SOURCE_WEIGHT_TAGS);
  add(post.caption, TOKEN_SOURCE_WEIGHT_CAPTION);

  return weights;
}

/**
 * How well a candidate post's own topic tokens match the user's current
 * interest profile — capped so personalization is always a moderate boost,
 * never enough on its own to dominate quality+freshness+exploration (a new
 * or signed-out user, whose interestProfile is always empty, gets exactly 0
 * here, falling back cleanly to the other three dimensions).
 */
export function computePersonalizationScore(post: Post, interestProfile: InterestProfile): number {
  const tokens = extractPostTokenWeights(post);
  let raw = 0;
  for (const token of tokens.keys()) {
    raw += interestProfile.tokenWeights.get(token) ?? 0;
  }
  return Math.min(raw, PERSONALIZATION_MAX_CONTRIBUTION);
}

/**
 * A small, self-vanishing boost for under-tested content: strongest for a
 * brand-new post with zero engagement, fading both as the post ages (wider
 * half-life than freshness, so this outlives raw freshness's own decay a
 * little, giving a fair trial window) and as it accumulates real
 * save/helpful/comment engagement (1/(1+engagement) — once a post has real
 * traction, quality should carry it, not exploration).
 */
export function computeExplorationScore(post: Post, now: number): number {
  const ageFactor = halfLifeDecayHours(ageMsSinceCreated(post, now), EXPLORATION_HALF_LIFE_HOURS);
  const totalEngagement = post.saveCount + post.likeCount + post.commentCount;
  return EXPLORATION_WEIGHT * ageFactor * (1 / (1 + totalEngagement));
}

/** Own-post and session-seen penalties — noticeable relative to typical
 *  total scores, but never exclusionary (a post can still appear, just
 *  ranked lower). seenPostIds/currentUserId are supplied by the caller;
 *  this stays pure and has no sessionStorage/auth access of its own. */
export function computePenalties(post: Post, ctx: RecommendationContext): PenaltyBreakdown {
  const ownPostPenalty = ctx.currentUserId && post.userId === ctx.currentUserId ? OWN_POST_PENALTY : 0;
  const sessionSeenPenalty = ctx.seenPostIds.has(post.id) ? SESSION_SEEN_PENALTY : 0;
  return { total: ownPostPenalty + sessionSeenPenalty, ownPostPenalty, sessionSeenPenalty };
}

/** The full explainable breakdown for one post — sums the four independent
 *  dimensions and subtracts penalties. This is the one function that
 *  combines them; every dimension above stays independently callable and
 *  independently testable. */
export function computeRecommendationScore(post: Post, ctx: RecommendationContext): ScoreBreakdown {
  const quality = computeQualityScore(post);
  const freshness = computeFreshnessScore(post, ctx.now);
  const personalization = computePersonalizationScore(post, ctx.interestProfile);
  const exploration = computeExplorationScore(post, ctx.now);
  const penalties = computePenalties(post, ctx);

  const total = quality.total + freshness + personalization + exploration - penalties.total;

  return { total, quality, freshness, personalization, exploration, penalties };
}
