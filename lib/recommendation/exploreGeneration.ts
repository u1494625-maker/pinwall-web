/**
 * Persists the ACTIVE Explore ranking generation across remounts (e.g.
 * navigating to Post Detail or Map and back) as its FINAL DISPLAYED ORDER —
 * a frozen list of post ids — not just the abstract inputs that produced
 * it. Persisting only seed/now/seenPostIds/interestProfile was still
 * insufficient: rankExplorePosts's jitter step consumes randomness in the
 * ORDER its `posts` argument is given, so replaying the SAME seed against
 * a differently-ordered (even if content-identical) `posts` array —
 * which genuinely happens across a remount, since useAllPostsState()
 * always kicks off a fresh fetch that later replaces its own cached
 * snapshot with a brand-new array reference — reassigns jitter to
 * different posts and can visibly reorder the feed. Freezing the OUTPUT
 * order itself, once, and simply replaying it (never recomputing) is what
 * actually guarantees "the same order until an explicit refresh."
 *
 * Only useExploreFeed's refresh() (driven by a successful pull-to-refresh)
 * ever computes and persists a brand-new generation, replacing this one.
 */

const ACTIVE_GENERATION_KEY = "pinwall_explore_active_generation";

export type PersistedGeneration = {
  seed: number;
  now: number;
  seenPostIds: number[];
  /** null for a signed-out generation. A persisted generation is only ever
   *  restored for the exact same identity (or lack of one) it was created
   *  under — a mismatch (a different account signed in since) discards it
   *  and starts a fresh generation rather than showing someone else's
   *  frozen order. */
  userId: string | null;
  /** The FINAL displayed order, frozen once at generation-creation time —
   *  restoring a generation means replaying this list directly against
   *  whichever Post objects are currently available, never re-running
   *  scoring/jitter/diversification. */
  rankedPostIds: number[];
};

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

export function readActiveGeneration(): PersistedGeneration | null {
  try {
    const raw = window.sessionStorage.getItem(ACTIVE_GENERATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.seed !== "number" ||
      typeof parsed?.now !== "number" ||
      !isNumberArray(parsed?.seenPostIds) ||
      !isNumberArray(parsed?.rankedPostIds) ||
      (parsed.userId !== null && typeof parsed.userId !== "string")
    ) {
      return null;
    }
    return {
      seed: parsed.seed,
      now: parsed.now,
      seenPostIds: parsed.seenPostIds,
      userId: parsed.userId,
      rankedPostIds: parsed.rankedPostIds,
    };
  } catch {
    return null;
  }
}

export function writeActiveGeneration(generation: PersistedGeneration): void {
  try {
    window.sessionStorage.setItem(ACTIVE_GENERATION_KEY, JSON.stringify(generation));
  } catch {
    // Ignore storage failures (e.g. private browsing quota) — worst case,
    // the next mount just starts a fresh generation instead of restoring
    // this one, same graceful-degradation precedent as sessionSeen.ts.
  }
}
