"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import NotificationRow from "@/components/messages/NotificationRow";
import NotificationsPageShell from "@/components/messages/NotificationsPageShell";
import FollowActionButton from "@/components/profile/FollowActionButton";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useFollowedUserIds } from "@/lib/interactions";
import { FALLBACK_DISPLAY_NAME, getProfilesByUserIds, type Profile } from "@/lib/profiles";

function FollowingRowSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b border-stone-100 px-4 py-3.5">
      <div className="size-11 shrink-0 animate-pulse rounded-full bg-stone-200" />
      <div className="h-3.5 flex-1 animate-pulse rounded bg-stone-200" />
    </div>
  );
}

/**
 * Real current following — who *I* follow right now. Unlike the Followers
 * list, a row's very presence here IS the relationship the button controls,
 * so unfollowing must remove the row immediately rather than just flipping
 * the button — this list owns that dataset-specific behavior via
 * FollowActionButton's onToggled callback; the button itself stays the exact
 * same shared component used everywhere else.
 */
export default function FollowingListPage() {
  const { user } = useAuth();
  const { ids: followedIds, loading: followedLoading } = useFollowedUserIds();
  const [visibleIds, setVisibleIds] = useState<string[]>([]);
  const [profilesById, setProfilesById] = useState<Map<string, Profile>>(new Map());
  const [profilesLoading, setProfilesLoading] = useState(true);

  useEffect(() => {
    if (followedLoading) return;
    let cancelled = false;

    getProfilesByUserIds(followedIds).then((result) => {
      if (!cancelled) {
        setProfilesById(result);
        setVisibleIds(followedIds);
        setProfilesLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
    // followedIds is a fresh array each hook call; only its content (the ids
    // themselves) should re-trigger this, not identity — join() keys it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followedIds.join(","), followedLoading]);

  function handleToggled(targetUserId: string, isFollowing: boolean) {
    if (!isFollowing) {
      setVisibleIds((prev) => prev.filter((id) => id !== targetUserId));
    }
  }

  const loading = followedLoading || profilesLoading;

  return (
    <NotificationsPageShell title="Following">
      {loading ? (
        <div>
          {[0, 1, 2].map((key) => (
            <FollowingRowSkeleton key={key} />
          ))}
        </div>
      ) : visibleIds.length === 0 ? (
        <p className="px-4 py-16 text-center text-sm text-stone-400">Not following anyone yet.</p>
      ) : (
        <div>
          {visibleIds.map((followedId) => {
            const profile = profilesById.get(followedId);
            const displayName = profile?.displayName ?? FALLBACK_DISPLAY_NAME;
            return (
              <NotificationRow
                key={followedId}
                actorUserId={followedId}
                actorDisplayName={displayName}
                actorAvatarUrl={profile?.avatarUrl ?? undefined}
                rightSlot={
                  user ? (
                    <FollowActionButton
                      currentUserId={user.id}
                      targetUserId={followedId}
                      isFollowing
                      onToggled={(isFollowing) => handleToggled(followedId, isFollowing)}
                    />
                  ) : undefined
                }
              >
                <Link href={`/profile/${followedId}`} className="text-sm font-bold text-stone-900">
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
