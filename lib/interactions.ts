"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";

/** Postgres unique_violation — a duplicate like/save/follow from a double-tap race. */
const UNIQUE_VIOLATION = "23505";

/**
 * Like/save/follow are all built from the same shape (a composite-PK junction
 * table + own-write RLS), but are kept fully independent here on purpose —
 * separate tables, separate policies, separate functions, no shared toggle
 * path. Only the *pattern* is reused, never runtime state.
 */

export async function likePost(postId: number, userId: string): Promise<void> {
  const { error } = await supabase.from("post_likes").insert({ post_id: postId, user_id: userId });
  if (error && error.code !== UNIQUE_VIOLATION) {
    throw new Error(error.message);
  }
}

export async function unlikePost(postId: number, userId: string): Promise<void> {
  const { error } = await supabase.from("post_likes").delete().eq("post_id", postId).eq("user_id", userId);
  if (error) {
    throw new Error(error.message);
  }
}

export async function savePost(postId: number, userId: string): Promise<void> {
  const { error } = await supabase.from("post_saves").insert({ post_id: postId, user_id: userId });
  if (error && error.code !== UNIQUE_VIOLATION) {
    throw new Error(error.message);
  }
}

export async function unsavePost(postId: number, userId: string): Promise<void> {
  const { error } = await supabase.from("post_saves").delete().eq("post_id", postId).eq("user_id", userId);
  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Bumps a post's persistent view_count by exactly one via an atomic SQL
 * increment (see supabase/post_views_owner_exclusion.sql's
 * increment_post_view). The only caller is PostDetail's load effect, once
 * per genuine open — PostCard never calls this; merely scrolling a post
 * into view is not a View. Fire-and-forget: never awaited, so a slow/failed
 * write can never delay anything the caller already did. Deliberately never
 * deduplicated by user/session — the same non-owner opening the same post
 * repeatedly counts again every time. Works for a signed-out caller too
 * (the RPC is security definer, granted to anon). The post's own author
 * never increments their own post's count: enforced inside the RPC itself
 * (the real, database-level guarantee), not by this function or its caller.
 */
export async function incrementPostView(postId: number): Promise<boolean> {
  const { error } = await supabase.rpc("increment_post_view", { target_post_id: postId });
  if (error) {
    console.error("Failed to increment post view count:", error.message);
    return false;
  }
  return true;
}

export async function followUser(followerUserId: string, followingUserId: string): Promise<void> {
  const { error } = await supabase
    .from("follows")
    .insert({ follower_user_id: followerUserId, following_user_id: followingUserId });
  if (error && error.code !== UNIQUE_VIOLATION) {
    throw new Error(error.message);
  }
}

export async function unfollowUser(followerUserId: string, followingUserId: string): Promise<void> {
  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_user_id", followerUserId)
    .eq("following_user_id", followingUserId);
  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Shared shape for both Saved and Liked post-ID lists — exposes `loading`
 * explicitly so callers can distinguish "still loading" from "genuinely
 * empty," the same loading-flash bug class already fixed once in this
 * codebase for posts (see useAllPostsState). Unlike the old localStorage
 * version, this is a real async query and needs a signed-in user.
 */
function useUserPostIds(table: "post_saves" | "post_likes"): { ids: number[]; loading: boolean } {
  const { user } = useAuth();
  const [ids, setIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const enabled = Boolean(user && isSupabaseConfigured);

  useEffect(() => {
    if (!enabled || !user) return;
    const userId = user.id;

    let cancelled = false;

    async function load() {
      setLoading(true);
      const { data, error } = await supabase.from(table).select("post_id").eq("user_id", userId);
      if (cancelled) return;
      if (error) {
        console.error(`Failed to load ${table} from Supabase:`, error.message);
        setIds([]);
      } else {
        setIds((data ?? []).map((row) => row.post_id as number));
      }
      setLoading(false);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [enabled, user, table]);

  if (!enabled) {
    return { ids: [], loading: false };
  }

  return { ids, loading };
}

export function useSavedPostIds(): { ids: number[]; loading: boolean } {
  return useUserPostIds("post_saves");
}

export function useLikedPostIds(): { ids: number[]; loading: boolean } {
  return useUserPostIds("post_likes");
}

/** Whether the signed-in viewer already follows `targetUserId`. Always false
 *  while signed out, loading, or viewing your own id (self-follow is never a
 *  real state). */
export function useIsFollowing(targetUserId: string | undefined): { isFollowing: boolean; loading: boolean } {
  const { user } = useAuth();
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const enabled = Boolean(user && targetUserId && user.id !== targetUserId && isSupabaseConfigured);

  useEffect(() => {
    if (!enabled || !user || !targetUserId) return;
    const followerId = user.id;

    let cancelled = false;

    async function load() {
      setLoading(true);
      const { data, error } = await supabase
        .from("follows")
        .select("follower_user_id")
        .eq("follower_user_id", followerId)
        .eq("following_user_id", targetUserId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error("Failed to load follow state from Supabase:", error.message);
      }
      setIsFollowing(Boolean(data));
      setLoading(false);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [enabled, user, targetUserId]);

  if (!enabled) {
    return { isFollowing: false, loading: false };
  }

  return { isFollowing, loading };
}

/** The user IDs the signed-in viewer follows — used to build the Home
 *  "Following" feed (posts by these users). Empty (not an error) while
 *  signed out or following nobody. */
export function useFollowedUserIds(): { ids: string[]; loading: boolean } {
  const { user } = useAuth();
  const [ids, setIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const enabled = Boolean(user && isSupabaseConfigured);

  useEffect(() => {
    if (!enabled || !user) return;
    const followerId = user.id;

    let cancelled = false;

    async function load() {
      setLoading(true);
      const { data, error } = await supabase.from("follows").select("following_user_id").eq("follower_user_id", followerId);
      if (cancelled) return;
      if (error) {
        console.error("Failed to load followed users from Supabase:", error.message);
        setIds([]);
      } else {
        setIds((data ?? []).map((row) => row.following_user_id as string));
      }
      setLoading(false);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [enabled, user]);

  if (!enabled) {
    return { ids: [], loading: false };
  }

  return { ids, loading };
}

/** The user IDs of everyone currently following the signed-in viewer — the
 *  mirror of useFollowedUserIds, used by the real Followers list (not
 *  notification history). Empty (not an error) while signed out. */
export function useFollowerUserIds(): { ids: string[]; loading: boolean } {
  const { user } = useAuth();
  const [ids, setIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const enabled = Boolean(user && isSupabaseConfigured);

  useEffect(() => {
    if (!enabled || !user) return;
    const followingId = user.id;

    let cancelled = false;

    async function load() {
      setLoading(true);
      const { data, error } = await supabase.from("follows").select("follower_user_id").eq("following_user_id", followingId);
      if (cancelled) return;
      if (error) {
        console.error("Failed to load followers from Supabase:", error.message);
        setIds([]);
      } else {
        setIds((data ?? []).map((row) => row.follower_user_id as string));
      }
      setLoading(false);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [enabled, user]);

  if (!enabled) {
    return { ids: [], loading: false };
  }

  return { ids, loading };
}

export type ProfileStats = {
  followingCount: number;
  followersCount: number;
  likesAndSavesCount: number;
};

const EMPTY_PROFILE_STATS: ProfileStats = { followingCount: 0, followersCount: 0, likesAndSavesCount: 0 };

/** snake_case shape of a get_profile_stats row. */
type ProfileStatsRow = {
  following_count: number;
  followers_count: number;
  likes_and_saves_count: number;
};

/** Following/Followers/Likes & Saves for the Me page — one RPC round trip. */
export async function getProfileStats(userId: string): Promise<ProfileStats> {
  if (!isSupabaseConfigured) return EMPTY_PROFILE_STATS;

  const { data, error } = await supabase.rpc("get_profile_stats", { target_user_id: userId }).single();

  if (error || !data) {
    console.error("Failed to load profile stats from Supabase:", error?.message);
    return EMPTY_PROFILE_STATS;
  }

  const row = data as ProfileStatsRow;

  return {
    followingCount: row.following_count ?? 0,
    followersCount: row.followers_count ?? 0,
    likesAndSavesCount: row.likes_and_saves_count ?? 0,
  };
}

const LOCAL_SAVED_KEY = "pinwall_saved";
const SAVES_MIGRATED_KEY = "pinwall_saves_migrated";

/**
 * One-time, best-effort copy of the old localStorage-only saves into the
 * real post_saves table, run once per device the first time its owner signs
 * in after this shipped. Each ID is attempted individually (not one batched
 * multi-row insert) specifically so a single deleted/stale post ID can't
 * fail the whole batch — Postgres would otherwise run a multi-row insert as
 * one all-or-nothing statement. The migrated flag is set once every ID has
 * been *attempted*, not once every ID has *succeeded* — a permanently-stale
 * ID must never permanently re-block migration on every future sign-in.
 * Nothing is ever deleted from localStorage or the server.
 */
export async function migrateLocalSavesToSupabase(userId: string): Promise<void> {
  if (typeof window === "undefined" || !isSupabaseConfigured) return;
  if (localStorage.getItem(SAVES_MIGRATED_KEY)) return;

  let localIds: number[] = [];
  try {
    localIds = JSON.parse(localStorage.getItem(LOCAL_SAVED_KEY) ?? "[]");
  } catch {
    localIds = [];
  }

  for (const postId of localIds) {
    try {
      await savePost(postId, userId);
    } catch {
      // Stale/deleted post ID or a transient error for this one row — skip
      // it, never let it block the rest of the batch or the flag below.
    }
  }

  localStorage.setItem(SAVES_MIGRATED_KEY, "true");
}
