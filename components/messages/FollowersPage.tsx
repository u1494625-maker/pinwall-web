"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import NotificationRow from "@/components/messages/NotificationRow";
import NotificationsPageShell from "@/components/messages/NotificationsPageShell";
import FollowActionButton from "@/components/profile/FollowActionButton";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useFollowedUserIds } from "@/lib/interactions";
import {
  getFollowNotifications,
  markNotificationsRead,
  setUnseenNotificationCategory,
  type FollowNotification,
} from "@/lib/notifications";
import { formatRelativeDate } from "@/lib/postDisplay";

function FollowerRowSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b border-stone-100 px-4 py-3.5">
      <div className="size-11 shrink-0 animate-pulse rounded-full bg-stone-200" />
      <div className="h-3.5 flex-1 animate-pulse rounded bg-stone-200" />
    </div>
  );
}

export default function FollowersPage() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<FollowNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const { ids: followedIds, loading: followedLoading } = useFollowedUserIds();
  const followedIdSet = useMemo(() => new Set(followedIds), [followedIds]);
  const loading = notificationsLoading || followedLoading;

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    getFollowNotifications().then((result) => {
      if (!cancelled) {
        setNotifications(result);
        setNotificationsLoading(false);
      }
    });

    // Fire-and-forget: opening this page marks New followers (and only
    // New followers) read.
    markNotificationsRead(user.id, "follow");
    setUnseenNotificationCategory("follow", false);

    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <NotificationsPageShell title="New followers">
      {loading ? (
        <div>
          {[0, 1, 2].map((key) => (
            <FollowerRowSkeleton key={key} />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <p className="px-4 py-16 text-center text-sm text-stone-400">No new followers yet.</p>
      ) : (
        <div>
          {notifications.map((notification) => (
            <NotificationRow
              key={notification.id}
              actorUserId={notification.actorUserId}
              actorDisplayName={notification.actorDisplayName}
              actorAvatarUrl={notification.actorAvatarUrl}
              rightSlot={
                user ? (
                  <FollowActionButton
                    currentUserId={user.id}
                    targetUserId={notification.actorUserId}
                    isFollowing={followedIdSet.has(notification.actorUserId)}
                  />
                ) : undefined
              }
            >
              <Link href={`/profile/${notification.actorUserId}`} className="text-sm font-bold text-stone-900">
                {notification.actorDisplayName}
              </Link>
              <p className="mt-0.5 text-[11px] text-stone-400">{formatRelativeDate(notification.createdAt)}</p>
            </NotificationRow>
          ))}
        </div>
      )}
    </NotificationsPageShell>
  );
}
