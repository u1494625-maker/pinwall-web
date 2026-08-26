/**
 * Viewport-confirmed "seen" tracking for Explore — deliberately separate
 * from sessionSeen.ts. That mechanism marks the top N of whatever a
 * generation froze (a rough approximation, feeding score.ts's soft
 * SESSION_SEEN_PENALTY on every ranking, including the very first one).
 * This one marks only posts an IntersectionObserver actually confirmed
 * entered the viewport (see PostCard.tsx's trackViewportSeen), and is
 * consumed only by useExploreFeed.ts's refresh() to hard-partition
 * candidates into unseen-first / seen-fallback. Different signal, different
 * consumer, different key — sessionSeen.ts and score.ts are untouched.
 *
 * sessionStorage-backed like sessionSeen.ts: survives navigating away and
 * back (Explore -> Post Detail -> Back, tab switching, etc.), but never
 * persisted to Supabase and cleared once the tab/app session ends — this is
 * refresh-cycle diversity, not permanent suppression.
 */

const VIEWPORT_SEEN_KEY = "pinwall_explore_viewport_seen_post_ids";

export function getViewportSeenPostIds(): Set<number> {
  try {
    const raw = window.sessionStorage.getItem(VIEWPORT_SEEN_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is number => typeof id === "number"));
  } catch {
    return new Set();
  }
}

/** Adds a single post id to the accumulated viewport-seen set — never
 *  replaces it, so everything scrolled into view earlier this session stays
 *  recorded, not just the most recent batch. */
export function markPostViewportSeen(postId: number): void {
  try {
    const current = getViewportSeenPostIds();
    if (current.has(postId)) return;
    current.add(postId);
    window.sessionStorage.setItem(VIEWPORT_SEEN_KEY, JSON.stringify(Array.from(current)));
  } catch {
    // Ignore storage failures (e.g. private browsing quota) — same
    // graceful-degradation precedent as sessionSeen.ts.
  }
}
