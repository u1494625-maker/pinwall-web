"use client";

/**
 * Ranks the Explore candidate pool using Recommendation V1 — the hook
 * PinWallHome's Explore branch consumes.
 *
 * A ranking generation's displayed order is a FROZEN, ONE-TIME computation:
 * scored, jittered, and diversified exactly once (via rankExplorePosts,
 * completely unchanged — see that file for the actual algorithm, weights,
 * and signals, none of which this module touches), and its resulting
 * post-id sequence is then persisted and simply REPLAYED afterward — never
 * recomputed. Nothing (a remount, auth/personalization resolving, a
 * newly-logged signal, an ordinary rerender, posts reloading) ever
 * re-ranks an already-frozen generation; only a successful pull-to-refresh
 * (refresh(), below) computes and freezes a new one.
 *
 * Two pieces of state, not one, are what make this safe against a
 * mid-computation remount or an in-flight refresh:
 * - `frozen`: the generation actually being displayed. Once it has a
 *   rankedPostIds list, that list never changes again.
 * - `pending`: a generation currently being computed (the very first one
 *   this mount, if nothing could be restored, or a fresh one from
 *   refresh()). While `pending` is in flight, `frozen` (if any) keeps
 *   being shown unchanged — a refresh never blanks the feed while it
 *   computes the replacement.
 */
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { SESSION_SEEN_BATCH_SIZE } from "./config";
import { getViewportSeenPostIds } from "./exploreViewportSeen";
import { readActiveGeneration, writeActiveGeneration, type PersistedGeneration } from "./exploreGeneration";
import { buildInterestProfile, fetchInterestSignals } from "./interestProfile";
import { pickRankingSeed } from "./rng";
import { rankExplorePosts } from "./rankExplorePosts";
import { getSeenPostIds, markPostsSeen } from "./sessionSeen";
import type { InterestProfile } from "./types";
import type { Post } from "@/types/post";

const EMPTY_INTEREST_PROFILE: InterestProfile = { tokenWeights: new Map() };

/** A fully computed, frozen generation — rankedPostIds is final and never
 *  recomputed for this generation's lifetime. */
type Generation = { seed: number; now: number; seenPostIds: Set<number>; rankedPostIds: number[] };

/** A generation whose inputs are fixed but whose order hasn't been computed
 *  yet — everything rankExplorePosts needs except the interest profile,
 *  which is resolved (fetched or defaulted to empty) at computation time. */
type PendingGeneration = {
  seed: number;
  now: number;
  seenPostIds: Set<number>;
  /** The accumulated viewport-seen set (see exploreViewportSeen.ts), read
   *  once at the moment this generation was requested — never a live/
   *  reactive read. Used to rank unseen candidates first; empty for the
   *  very first generation, which naturally just ranks the whole pool with
   *  nothing deprioritized (see the ranking effect below). */
  viewportSeenPostIds: Set<number>;
};

function freshPending(viewportSeenPostIds: Set<number> = new Set()): PendingGeneration {
  return { seed: pickRankingSeed(), now: Date.now(), seenPostIds: getSeenPostIds(), viewportSeenPostIds };
}

function generationFromPersisted(persisted: PersistedGeneration): Generation {
  return {
    seed: persisted.seed,
    now: persisted.now,
    seenPostIds: new Set(persisted.seenPostIds),
    rankedPostIds: persisted.rankedPostIds,
  };
}

/** A persisted generation restores only for the identity it was frozen
 *  under — null (signed-out) or a specific signed-in user id. */
function matchesCurrentUser(persisted: PersistedGeneration | null, currentUserId: string | null): boolean {
  return persisted !== null && persisted.userId === currentUserId;
}

export function useExploreFeed(
  posts: Post[],
  postsLoading: boolean,
): {
  /** The frozen order, mapped onto currently-available Post objects — a
   *  post no longer present (deleted) is simply skipped; a post created
   *  since the generation was frozen doesn't appear until the next
   *  refresh(), by design. Empty while `loading` is true. */
  posts: Post[];
  /** True until there is a frozen generation to display at all — waiting
   *  on auth, on posts, or (only for the very first generation this
   *  session, or after a user-identity mismatch) on personalization.
   *  Never true again once a generation has been frozen, even while a
   *  refresh's replacement is being computed — see `refreshing` for that. */
  loading: boolean;
  /** True only in the window between a refresh() call and the new
   *  generation's order being frozen. The OLD frozen order keeps being
   *  returned via `posts` during this window — refresh never blanks the
   *  feed while computing its replacement. */
  refreshing: boolean;
  /** The ONLY way V1 creates a new generation: a fresh seed, a fresh
   *  `now`, the latest accumulated seen-set, and personalization rebuilt
   *  from the latest signals — scored, jittered, and diversified exactly
   *  once via the unchanged rankExplorePosts, then frozen. Called
   *  exclusively from a successful pull-to-refresh release. */
  refresh: () => void;
} {
  const { user, loading: authLoading } = useAuth();

  // Restored synchronously wherever possible, so the common case this bug
  // is about — navigating away from Explore and back within an
  // already-loaded app, where AuthProvider (root layout, never unmounts)
  // already has authLoading === false and `user` resolved — shows the
  // correct frozen order on this component's very first render, with zero
  // intermediate frame. A genuine cold start (authLoading still true here)
  // can't yet tell "signed out" from "signed in but not resolved" and
  // defers the decision to the settle effect below instead of guessing.
  const [frozen, setFrozen] = useState<Generation | null>(() => {
    if (authLoading) return null;
    const persisted = readActiveGeneration();
    return matchesCurrentUser(persisted, user?.id ?? null) ? generationFromPersisted(persisted!) : null;
  });
  const [pending, setPending] = useState<PendingGeneration | null>(() => {
    if (authLoading) return null;
    const persisted = readActiveGeneration();
    return matchesCurrentUser(persisted, user?.id ?? null) ? null : freshPending();
  });

  // Cold-start settle: resolves `frozen`/`pending` once auth actually
  // finishes resolving, for the case the lazy initializers above deferred.
  // A no-op on every later render (guarded by both already being null,
  // which is only ever simultaneously true before this has run once).
  // Deferred through a microtask (matching the async-callback shape the
  // effect below already uses) rather than calling setState synchronously
  // in the effect body.
  useEffect(() => {
    if (authLoading || frozen !== null || pending !== null) return;
    let cancelled = false;

    Promise.resolve().then(() => {
      if (cancelled) return;
      const persisted = readActiveGeneration();
      const currentUserId = user?.id ?? null;
      if (matchesCurrentUser(persisted, currentUserId)) {
        setFrozen(generationFromPersisted(persisted!));
      } else {
        setPending(freshPending());
      }
    });

    return () => {
      cancelled = true;
    };
  }, [authLoading, user, frozen, pending]);

  // Computes `pending` exactly once, then freezes it into `frozen`,
  // replacing whatever was there. Guarded on postsLoading so the frozen
  // order is always computed from real post data. Once `pending` is
  // cleared (set back to null) below, this effect's own guard
  // (`if (!pending) return`) makes any later rerun for unrelated reasons
  // (posts/user changing) an immediate no-op — a generation is computed
  // once, full stop, until the next refresh() sets a new `pending`.
  useEffect(() => {
    if (!pending || authLoading || postsLoading) return;
    let cancelled = false;

    (async () => {
      let interestProfile = EMPTY_INTEREST_PROFILE;
      if (user) {
        const events = await fetchInterestSignals(user.id);
        if (cancelled) return;
        const postsById = new Map(posts.map((post) => [post.id, post]));
        interestProfile = buildInterestProfile(events, postsById, Date.now());
      }
      if (cancelled) return;

      const rankingContext = {
        now: pending.now,
        currentUserId: user?.id,
        interestProfile,
        seenPostIds: pending.seenPostIds,
        seed: pending.seed,
      };

      // Explore has no pagination — every generation renders the entire
      // pool, just reordered (confirmed empirically: 30/30 posts render on
      // load). So there's never a "not enough candidates to fill the feed"
      // problem to solve by truncating — unseenCandidates and
      // seenCandidates always partition `posts` completely, and simply
      // concatenating them (unseen first) already both prioritizes unseen
      // posts AND uses exactly as many seen ones as necessary to fill the
      // rest, with nothing dropped. An empty viewportSeenPostIds (the very
      // first generation, or a viewport nobody has scrolled through yet)
      // naturally makes seenCandidates empty too — same result as ranking
      // the whole pool, no special-casing needed.
      const unseenCandidates = posts.filter((post) => !pending.viewportSeenPostIds.has(post.id));
      const seenCandidates = posts.filter((post) => pending.viewportSeenPostIds.has(post.id));
      const unseenRanked = rankExplorePosts({ posts: unseenCandidates, ...rankingContext }).map((r) => r.post.id);
      const seenRanked = rankExplorePosts({ posts: seenCandidates, ...rankingContext }).map((r) => r.post.id);
      const rankedPostIds = [...unseenRanked, ...seenRanked];
      if (cancelled) return;

      setFrozen({ seed: pending.seed, now: pending.now, seenPostIds: pending.seenPostIds, rankedPostIds });
      setPending(null);

      markPostsSeen(rankedPostIds.slice(0, SESSION_SEEN_BATCH_SIZE));
      writeActiveGeneration({
        seed: pending.seed,
        now: pending.now,
        seenPostIds: Array.from(pending.seenPostIds),
        userId: user?.id ?? null,
        rankedPostIds,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [pending, authLoading, postsLoading, posts, user]);

  // Pure ID-to-object replay — never re-ranks. A frozen id with no
  // matching current post (deleted since) is skipped; a post that didn't
  // exist when this generation was frozen simply isn't in the list yet.
  const rankedPosts = useMemo(() => {
    if (!frozen) return [];
    const postsById = new Map(posts.map((post) => [post.id, post]));
    return frozen.rankedPostIds.map((id) => postsById.get(id)).filter((post): post is Post => post !== undefined);
  }, [frozen, posts]);

  function refresh() {
    // First, always -- both the web floating button and native pull-to-
    // refresh call this same function, so this is the one place that needs
    // to do it for either entry point to land back at the top.
    window.scrollTo(0, 0);
    setPending(freshPending(getViewportSeenPostIds()));
  }

  return {
    posts: rankedPosts,
    loading: frozen === null || postsLoading,
    refreshing: pending !== null,
    refresh,
  };
}
