/**
 * Builds a signed-in user's current interest profile from their own recent
 * behavior — never from raw impressions, never from dwell time, never
 * persisted beyond the source event rows themselves. Two halves, kept
 * separate on purpose: buildInterestProfile is pure token math (fully
 * unit-testable without a network), fetchInterestSignals is the actual
 * Supabase reads.
 */
import { supabase } from "@/lib/supabase/client";
import { tokenize } from "@/lib/textTokens";
import {
  INTEREST_HALF_LIFE_DAYS,
  INTEREST_LOOKBACK_DAYS,
  MAX_TOKEN_INTEREST_WEIGHT,
  SIGNAL_WEIGHT_COMMENT,
  SIGNAL_WEIGHT_DETAIL_CLICK,
  SIGNAL_WEIGHT_HELPFUL,
  SIGNAL_WEIGHT_MAP_INTERACTION,
  SIGNAL_WEIGHT_SAVE,
  SIGNAL_WEIGHT_SEARCH,
} from "./config";
import { extractPostTokenWeights } from "./score";
import type { InterestProfile, InterestSignalEvent, InterestSignalType } from "./types";
import type { Post } from "@/types/post";

const SIGNAL_WEIGHTS: Record<InterestSignalType, number> = {
  save: SIGNAL_WEIGHT_SAVE,
  helpful: SIGNAL_WEIGHT_HELPFUL,
  search: SIGNAL_WEIGHT_SEARCH,
  comment: SIGNAL_WEIGHT_COMMENT,
  detail_click: SIGNAL_WEIGHT_DETAIL_CLICK,
  map_interaction: SIGNAL_WEIGHT_MAP_INTERACTION,
};

/**
 * Turns a list of behavioral events into a token -> weight interest map.
 * Each event's contribution is signalWeight * continuous recency decay
 * (~2.5-day half-life, so an unreinforced signal is strongly faded by day
 * 7). For a post-linked event, that contribution is split proportionally
 * across the post's own title/tag/caption tokens (via extractPostTokenWeights,
 * which already excludes locationName/authorDisplayName) — normalized so a
 * verbose post with many tokens doesn't out-weight a concise one purely by
 * word count. A search event contributes directly to its own query tokens.
 * Every token is finally capped so one repeated obsession can't dominate the
 * whole profile. `now` is injected for determinism/testability.
 */
export function buildInterestProfile(
  events: InterestSignalEvent[],
  postsById: Map<number, Post>,
  now: number,
): InterestProfile {
  const tokenWeights = new Map<string, number>();

  function addContribution(token: string, amount: number) {
    tokenWeights.set(token, (tokenWeights.get(token) ?? 0) + amount);
  }

  for (const event of events) {
    const ageMs = now - new Date(event.createdAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs < 0) continue;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const decay = Math.pow(0.5, ageDays / INTEREST_HALF_LIFE_DAYS);
    const contribution = SIGNAL_WEIGHTS[event.type] * decay;
    if (contribution <= 0) continue;

    if (event.type === "search") {
      for (const token of tokenize(event.query)) {
        addContribution(token, contribution);
      }
      continue;
    }

    const post = postsById.get(event.postId);
    if (!post) continue;

    const postTokenWeights = extractPostTokenWeights(post);
    const totalSourceWeight = Array.from(postTokenWeights.values()).reduce((sum, w) => sum + w, 0);
    if (totalSourceWeight <= 0) continue;

    for (const [token, sourceWeight] of postTokenWeights) {
      addContribution(token, contribution * (sourceWeight / totalSourceWeight));
    }
  }

  for (const [token, weight] of tokenWeights) {
    tokenWeights.set(token, Math.min(weight, MAX_TOKEN_INTEREST_WEIGHT));
  }

  return { tokenWeights };
}

type SignalRow = { post_id: number; created_at: string };
type InterestEventRow = { event_type: string; post_id: number | null; query: string | null; created_at: string };

/**
 * Reads a signed-in user's own recent signals — their post_saves/post_likes/
 * comments rows (existing tables, no duplication) plus their rows in the new
 * user_interest_events table (search/detail-click/map-interaction, the three
 * signal types with no existing home) — bounded to the last
 * INTEREST_LOOKBACK_DAYS, well past where continuous decay already makes a
 * contribution negligible. Four scoped queries total, none per-post, none
 * per-signal — safe to call once per Explore load.
 */
export async function fetchInterestSignals(userId: string): Promise<InterestSignalEvent[]> {
  const since = new Date(Date.now() - INTEREST_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [savesRes, likesRes, commentsRes, eventsRes] = await Promise.all([
    supabase.from("post_saves").select("post_id, created_at").eq("user_id", userId).gte("created_at", since),
    supabase.from("post_likes").select("post_id, created_at").eq("user_id", userId).gte("created_at", since),
    supabase.from("comments").select("post_id, created_at").eq("user_id", userId).gte("created_at", since),
    supabase
      .from("user_interest_events")
      .select("event_type, post_id, query, created_at")
      .eq("user_id", userId)
      .gte("created_at", since),
  ]);

  const events: InterestSignalEvent[] = [];

  if (savesRes.error) {
    console.error("Failed to load save signals from Supabase:", savesRes.error.message);
  } else {
    for (const row of (savesRes.data as SignalRow[] | null) ?? []) {
      events.push({ type: "save", postId: row.post_id, createdAt: row.created_at });
    }
  }

  if (likesRes.error) {
    console.error("Failed to load helpful signals from Supabase:", likesRes.error.message);
  } else {
    for (const row of (likesRes.data as SignalRow[] | null) ?? []) {
      events.push({ type: "helpful", postId: row.post_id, createdAt: row.created_at });
    }
  }

  if (commentsRes.error) {
    console.error("Failed to load comment signals from Supabase:", commentsRes.error.message);
  } else {
    for (const row of (commentsRes.data as SignalRow[] | null) ?? []) {
      events.push({ type: "comment", postId: row.post_id, createdAt: row.created_at });
    }
  }

  if (eventsRes.error) {
    console.error("Failed to load interest events from Supabase:", eventsRes.error.message);
  } else {
    for (const row of (eventsRes.data as InterestEventRow[] | null) ?? []) {
      if (row.event_type === "search_query" && row.query) {
        events.push({ type: "search", query: row.query, createdAt: row.created_at });
      } else if (row.event_type === "detail_click" && row.post_id != null) {
        events.push({ type: "detail_click", postId: row.post_id, createdAt: row.created_at });
      } else if (row.event_type === "map_interaction" && row.post_id != null) {
        events.push({ type: "map_interaction", postId: row.post_id, createdAt: row.created_at });
      }
    }
  }

  return events;
}
