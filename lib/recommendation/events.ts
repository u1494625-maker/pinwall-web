/**
 * Fire-and-forget writers for user_interest_events — the search-query/
 * detail-click/map-interaction signals with no existing home. Every caller
 * gates on a signed-in userId (never logs for anonymous visitors, matching
 * "no long-term personalization data from anonymous users") and never
 * awaits/blocks on these — a failed or slow insert must never delay
 * navigation or search results.
 *
 * Not wired into any UI yet — SearchScreen/PostCard/MapPage wiring is Phase
 * B/C. This module is the write-side foundation those phases call into.
 */
import { supabase } from "@/lib/supabase/client";

type InterestEventInsert = {
  user_id: string;
  event_type: "search_query" | "detail_click" | "map_interaction";
  post_id?: number;
  query?: string;
};

async function insertInterestEvent(row: InterestEventInsert): Promise<void> {
  const { error } = await supabase.from("user_interest_events").insert(row);
  if (error) {
    console.error(`Failed to log ${row.event_type} interest event:`, error.message);
  }
}

/** Trim/lowercase/collapse-whitespace — the one normalization applied before
 *  a search query is ever stored, so "  Coffee  " and "coffee" accumulate as
 *  the same interest-profile signal rather than two distinct tokens' worth
 *  of bookkeeping (tokenize() already lowercases for matching, but the
 *  *stored* query text itself should also be canonical). */
function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Logs one committed (not per-keystroke) search query for a signed-in user.
 *  No-ops silently for a blank/whitespace-only query — never stores an empty
 *  signal. Callers (Phase B's SearchScreen) are responsible for only calling
 *  this on an explicit submit, not on every keystroke. */
export function logSearchQueryEvent(userId: string, query: string): void {
  const normalized = normalizeQuery(query);
  if (!normalized) return;
  void insertInterestEvent({ user_id: userId, event_type: "search_query", query: normalized });
}

/** Logs a deliberate PostCard -> PostDetail open. Callers (Phase C) must
 *  wire this to a real click handler, never to a mount/refresh/deep-link
 *  effect, so a page reload or `?postId=` navigation never double-counts. */
export function logDetailClickEvent(userId: string, postId: number): void {
  void insertInterestEvent({ user_id: userId, event_type: "detail_click", post_id: postId });
}

/** Logs a direct single-marker Map -> PostDetail open. Callers (Phase C)
 *  wire this alongside MapPage's existing marker-click router.push, not to
 *  panning/zooming or a marker merely being visible. */
export function logMapInteractionEvent(userId: string, postId: number): void {
  void insertInterestEvent({ user_id: userId, event_type: "map_interaction", post_id: postId });
}
