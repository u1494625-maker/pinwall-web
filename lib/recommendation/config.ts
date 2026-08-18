/**
 * Every tunable weight/decay/cap for Recommendation V1 + Smart Search V1
 * personalization, centralized here so tuning one dimension never means
 * hunting through component code. See the Recommendation V1 plan for the
 * rationale behind each starting value — these are deliberately simple,
 * explainable starting points, not the product of any offline optimization.
 */

// --- Freshness: continuous exponential decay on a post's age. ---
// At 24h ≈ 66% strength, 72h ≈ 29%, 168h (7 days) ≈ 5% — "strong when new,
// gradually declining, meaningfully reduced by ~1 week, small after."
export const FRESHNESS_WEIGHT = 6;
export const FRESHNESS_HALF_LIFE_HOURS = 40;

// --- Quality: post-level community validation, log1p-damped so raw counts
// don't dominate linearly (100 saves != 100x a 1-save post). ---
export const QUALITY_SAVE_WEIGHT = 4;
export const QUALITY_HELPFUL_WEIGHT = 2.5;
export const QUALITY_COMMENT_WEIGHT = 1.5;

// --- Exploration: a small, decaying boost for under-tested posts so a
// zero-engagement new post can still get a fair look. Half-life is wider
// than freshness's so a post gets more than one day to prove itself before
// this fades; it also shrinks as the post accumulates real engagement. ---
export const EXPLORATION_WEIGHT = 2.5;
export const EXPLORATION_HALF_LIFE_HOURS = 96;

// --- Personalization: capped contribution from a token-weight interest
// profile built from the user's own recent behavior. ---
export const PERSONALIZATION_MAX_CONTRIBUTION = 3.5;
// ~7-day effective horizon: 0.5^(7/2.5) ≈ 10% strength at day 7.
export const INTEREST_HALF_LIFE_DAYS = 2.5;
// Query bound for fetching raw signal rows — well past where continuous
// decay already makes a contribution negligible; not a second, competing
// cutoff, just a bound on how much history is worth reading at all.
export const INTEREST_LOOKBACK_DAYS = 14;
// Per-token cap so one repeated obsession can't dominate the whole profile.
export const MAX_TOKEN_INTEREST_WEIGHT = 8;

// Personalization signal weights. Strict ordering, not tiers:
// Save > Helpful > Search > Comment > Detail click > Map interaction.
export const SIGNAL_WEIGHT_SAVE = 5;
export const SIGNAL_WEIGHT_HELPFUL = 4;
export const SIGNAL_WEIGHT_SEARCH = 3;
export const SIGNAL_WEIGHT_COMMENT = 2;
export const SIGNAL_WEIGHT_DETAIL_CLICK = 1.5;
export const SIGNAL_WEIGHT_MAP_INTERACTION = 0.75;

// Which fields contribute tokens to a post's own topic profile — used both
// to build the interest map (from posts the user engaged with) and to match
// a candidate post against it. Deliberately content-only: no locationName,
// no authorDisplayName — recommendation personalization stays
// location-neutral and identity-neutral in V1 (Search is unaffected; it's a
// separate scoring system that already uses locationName).
export const TOKEN_SOURCE_WEIGHT_TITLE = 3;
export const TOKEN_SOURCE_WEIGHT_TAGS = 3;
export const TOKEN_SOURCE_WEIGHT_CAPTION = 1;

// --- Penalties: noticeable, never exclusionary. ---
export const OWN_POST_PENALTY = 5;
export const SESSION_SEEN_PENALTY = 3;

// --- Session-seen: anti-repetition only, bounded to the top of each
// ranking generation — NOT the whole rendered candidate list, since Explore
// has no pagination and would otherwise mark nearly the entire pool seen
// after one render, making the penalty meaningless. ---
export const SESSION_SEEN_BATCH_SIZE = 20;

// --- Refresh jitter (Phase C/D): bounded, multiplicative, seeded. ---
export const JITTER_FRACTION = 0.12;

// --- Sequencing diversification (Phase D). ---
export const DIVERSITY_LOOKAHEAD = 6;
export const CONTENT_SIMILARITY_THRESHOLD = 0.6;
