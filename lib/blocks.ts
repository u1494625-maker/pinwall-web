"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";

/** Postgres unique_violation — a duplicate block from a double-tap race. */
const UNIQUE_VIOLATION = "23505";

/**
 * Directional in storage (only the blocker's own row) — the mutual
 * visibility/interaction consequence is enforced entirely at the database
 * level via is_blocked_pair (see supabase/blocking.sql), not by anything
 * this function does. Only the blocker can unblockUser this specific
 * relationship — the blocked party has no equivalent row of their own to
 * remove.
 */
export async function blockUser(blockerUserId: string, blockedUserId: string): Promise<void> {
  const { error } = await supabase
    .from("blocked_users")
    .insert({ blocker_user_id: blockerUserId, blocked_user_id: blockedUserId });
  if (error && error.code !== UNIQUE_VIOLATION) {
    throw new Error(error.message);
  }
}

export async function unblockUser(blockerUserId: string, blockedUserId: string): Promise<void> {
  const { error } = await supabase
    .from("blocked_users")
    .delete()
    .eq("blocker_user_id", blockerUserId)
    .eq("blocked_user_id", blockedUserId);
  if (error) {
    throw new Error(error.message);
  }
}

export type BlockState = {
  /** Whether the signed-in viewer themselves has blocked targetUserId —
   *  drives the Block/Unblock button's label, since only the blocker can
   *  undo their own block. */
  blockedByMe: boolean;
  /** Whether targetUserId has blocked the signed-in viewer — the viewer
   *  has no row of their own to remove in this direction. */
  blockedByThem: boolean;
  loading: boolean;
};

/**
 * Both directions of a block between the signed-in viewer and
 * `targetUserId`, fetched together in one query (at most two rows: the
 * pair in either order). blockedByMe / blockedByThem let the profile page
 * distinguish "show Unblock" (I blocked them) from "show neither Block nor
 * Unblock, just a neutral blocked state" (they blocked me, nothing of mine
 * to remove) — `blockedByMe || blockedByThem` is the same mutual signal
 * is_blocked_pair itself checks, for hiding Follow/Message. Always false
 * while signed out, loading, or viewing your own id (matching
 * useIsFollowing's identical shape in lib/interactions.ts). This is a UX
 * convenience only — the real enforcement is the database policies/RPCs
 * themselves, independent of whatever this hook returns.
 */
export function useBlockState(targetUserId: string | undefined): BlockState {
  const { user } = useAuth();
  const [blockedByMe, setBlockedByMe] = useState(false);
  const [blockedByThem, setBlockedByThem] = useState(false);
  const [loading, setLoading] = useState(true);
  const enabled = Boolean(user && targetUserId && user.id !== targetUserId && isSupabaseConfigured);

  useEffect(() => {
    if (!enabled || !user || !targetUserId) return;
    const myId = user.id;

    let cancelled = false;

    async function load() {
      setLoading(true);
      const { data, error } = await supabase
        .from("blocked_users")
        .select("blocker_user_id, blocked_user_id")
        .or(
          `and(blocker_user_id.eq.${myId},blocked_user_id.eq.${targetUserId}),and(blocker_user_id.eq.${targetUserId},blocked_user_id.eq.${myId})`,
        );
      if (cancelled) return;
      if (error) {
        console.error("Failed to load block state from Supabase:", error.message);
        setBlockedByMe(false);
        setBlockedByThem(false);
      } else {
        const rows = (data ?? []) as { blocker_user_id: string; blocked_user_id: string }[];
        setBlockedByMe(rows.some((row) => row.blocker_user_id === myId));
        setBlockedByThem(rows.some((row) => row.blocker_user_id === targetUserId));
      }
      setLoading(false);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [enabled, user, targetUserId]);

  if (!enabled) {
    return { blockedByMe: false, blockedByThem: false, loading: false };
  }

  return { blockedByMe, blockedByThem, loading };
}
