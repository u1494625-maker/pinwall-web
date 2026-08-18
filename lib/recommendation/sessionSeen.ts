/**
 * Session-scoped anti-repetition tracking for Explore — NOT personalization.
 * A post being in this set means only "already shown near the top this
 * browser session," never "the user is interested/uninterested in it."
 * Never persisted to Supabase; cleared automatically when the tab/session
 * ends (sessionStorage). Mirrors lib/map/viewport.ts's try/catch pattern;
 * no cross-component reactivity is needed here (only useExploreFeed reads/
 * writes this), so no useSyncExternalStore machinery.
 */

const SESSION_SEEN_KEY = "pinwall_explore_seen_post_ids";

export function getSeenPostIds(): Set<number> {
  try {
    const raw = window.sessionStorage.getItem(SESSION_SEEN_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is number => typeof id === "number"));
  } catch {
    return new Set();
  }
}

/** Adds `postIds` to the accumulated seen-set for the rest of this browser
 *  session — never replaces it, so a post surfaced a few refreshes ago stays
 *  (mildly) penalized too, not just the immediately previous batch. */
export function markPostsSeen(postIds: number[]): void {
  if (postIds.length === 0) return;
  try {
    const current = getSeenPostIds();
    for (const id of postIds) current.add(id);
    window.sessionStorage.setItem(SESSION_SEEN_KEY, JSON.stringify(Array.from(current)));
  } catch {
    // Ignore storage failures (e.g. private browsing quota) — anti-repetition
    // degrading to "no penalty" is a fine fallback; it must never throw.
  }
}
