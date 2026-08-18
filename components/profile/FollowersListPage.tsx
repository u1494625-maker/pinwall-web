"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import NotificationRow from "@/components/messages/NotificationRow";
import NotificationsPageShell from "@/components/messages/NotificationsPageShell";
import FollowActionButton from "@/components/profile/FollowActionButton";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useFollowedUserIds, useFollowerUserIds } from "@/lib/interactions";
import { FALLBACK_DISPLAY_NAME, getProfilesByUserIds, type Profile } from "@/lib/profiles";

function FollowerRowSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b border-stone-100 px-4 py-3.5">
      <div className="size-11 shrink-0 animate-pulse rounded-full bg-stone-200" />
      <div className="h-3.5 flex-1 animate-pulse rounded bg-stone-200" />
    </div>
  );
}

/**
 * Real current followers — who follows *me* right now — not notification
 * history (see components/messages/FollowersPage.tsx for that). A row's
 * presence here reflects the follower's own relationship to me and never
 * changes just because I follow/unfollow them back; only that row's own
 * button state changes (FollowActionButton's own optimistic override
 * already gives us exactly that, with no extra plumbing needed here).
 */
export default function FollowersListPage() {
  const { user } = useAuth();
  const { ids: followerIds, loading: followersLoading } = useFollowerUserIds();
  const { ids: followedIds, loading: followedLoading } = useFollowedUserIds();
  const followedIdSet = useMemo(() => new Set(followedIds), [followedIds]);
  const [profilesById, setProfilesById] = useState<Map<string, Profile>>(new Map());
  const [profilesLoading, setProfilesLoading] = useState(true);

  useEffect(() => {
    if (followersLoading) return;
    let cancelled = false;

    getProfilesByUserIds(followerIds).then((result) => {
      if (!cancelled) {
        setProfilesById(result);
        setProfilesLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
    // followerIds is a fresh array each hook call; only its content (the ids
    // themselves) should re-trigger this, not identity — join() keys it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followerIds.join(","), followersLoading]);

  const loading = followersLoading || followedLoading || profilesLoading;

  return (
    <NotificationsPageShell title="Followers">
      {loading ? (
        <div>
          {[0, 1, 2].map((key) => (
            <FollowerRowSkeleton key={key} />
          ))}
        </div>
      ) : followerIds.length === 0 ? (
        <p className="px-4 py-16 text-center text-sm text-stone-400">No followers yet.</p>
      ) : (
        <div>
          {followerIds.map((followerId) => {
            const profile = profilesById.get(followerId);
            const displayName = profile?.displayName ?? FALLBACK_DISPLAY_NAME;
            return (
              <NotificationRow
                key={followerId}
                actorUserId={followerId}
                actorDisplayName={displayName}
                actorAvatarUrl={profile?.avatarUrl ?? undefined}
                rightSlot={
                  user ? (
                    <FollowActionButton
                      currentUserId={user.id}
                      targetUserId={followerId}
                      isFollowing={followedIdSet.has(followerId)}
                    />
                  ) : undefined
                }
              >
                <Link href={`/profile/${followerId}`} className="text-sm font-bold text-stone-900">
                  {displayName}
                </Link>
              </NotificationRow>
            );
          })}
        </div>
      )}
    </NotificationsPageShell>
  );
}
