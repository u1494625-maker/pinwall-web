"use client";

import { useState } from "react";
import { followUser, unfollowUser } from "@/lib/interactions";

type FollowActionButtonProps = {
  currentUserId: string;
  targetUserId: string;
  isFollowing: boolean;
  /** "Follow back" in a Followers-list context, plain "Follow" elsewhere —
   *  only used for the not-following label; "Following" never changes. */
  notFollowingLabel?: string;
  /** Called after a follow/unfollow actually succeeds, with the new state —
   *  never called on failure/rollback. Lets the caller decide whether this
   *  should also change the list it's rendering (e.g. a Following list
   *  removes the row once unfollowed, since that row's whole membership is
   *  "do I follow them") or do nothing extra (e.g. a Followers list, where a
   *  row's presence reflects the *other* relationship — do they follow me —
   *  and shouldn't disappear just because I unfollowed them back). */
  onToggled?: (isFollowing: boolean) => void;
};

/** Shared follow/unfollow toggle — same optimistic-override pattern used
 *  throughout this app (PostDetail's Follow button, PublicProfile's Follow
 *  button): flips immediately, rolls back only on failure. One implementation
 *  reused by the "New followers" notification history and the real
 *  Followers/Following relationship lists — never duplicated. */
export default function FollowActionButton({
  currentUserId,
  targetUserId,
  isFollowing: isFollowingFromQuery,
  notFollowingLabel = "Follow back",
  onToggled,
}: FollowActionButtonProps) {
  const [override, setOverride] = useState<boolean | null>(null);
  const isFollowing = override ?? isFollowingFromQuery;

  async function handleClick() {
    const wasFollowing = isFollowing;
    setOverride(!wasFollowing);
    try {
      if (wasFollowing) await unfollowUser(currentUserId, targetUserId);
      else await followUser(currentUserId, targetUserId);
      onToggled?.(!wasFollowing);
    } catch {
      setOverride(wasFollowing);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={isFollowing}
      aria-label={isFollowing ? "Unfollow" : notFollowingLabel}
      className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${
        isFollowing ? "bg-stone-100 text-stone-500" : "bg-stone-900 text-white"
      }`}
    >
      {isFollowing ? "Following" : notFollowingLabel}
    </button>
  );
}
