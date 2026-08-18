/**
 * Bounded, multiplicative, seeded jitter applied once per ranking
 * generation — the only place a ranking's exact order can differ between
 * refreshes, and it can only reorder near-ties, never overpower a real
 * quality/freshness/personalization gap.
 */
import { JITTER_FRACTION } from "./config";
import type { ScoreBreakdown } from "./types";

export type Jittered<T> = {
  item: T;
  breakdown: ScoreBreakdown;
  jitteredScore: number;
};

/**
 * Multiplicative jitter is applied to the score's POSITIVE dimensions
 * (quality + freshness + personalization + exploration) only, with
 * penalties re-subtracted afterward, unjittered. This is deliberate: the
 * positive sum is always >= 0, so a multiplier in [1 - JITTER_FRACTION/2, 1
 * + JITTER_FRACTION/2] always behaves intuitively (a bigger multiplier
 * always means a higher jittered score). Applying the same multiplier
 * directly to `breakdown.total` instead would misbehave for a heavily
 * penalized post whose total is negative — multiplying a negative number by
 * >1 makes it MORE negative, inverting jitter's intended direction — and
 * would let a random roll randomly weaken or strengthen the penalty itself,
 * which should stay a precise, reliable suppression regardless of the seed.
 *
 * `random` is an injected seeded source (see rng.ts) — never Math.random()
 * directly — so a whole ranking generation is fully reproducible.
 */
export function applyJitter<T>(
  scored: Array<{ item: T; breakdown: ScoreBreakdown }>,
  random: () => number,
): Jittered<T>[] {
  return scored.map(({ item, breakdown }) => {
    const positiveTotal = breakdown.total + breakdown.penalties.total;
    const multiplier = 1 + (random() - 0.5) * JITTER_FRACTION;
    const jitteredScore = positiveTotal * multiplier - breakdown.penalties.total;
    return { item, breakdown, jitteredScore };
  });
}
