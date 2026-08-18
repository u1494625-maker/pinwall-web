"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import DemoPhoto from "@/components/DemoPhoto";
import NotificationRow from "@/components/messages/NotificationRow";
import NotificationsPageShell from "@/components/messages/NotificationsPageShell";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  getLikeNotifications,
  markNotificationsRead,
  setUnseenNotificationCategory,
  type LikeNotification,
} from "@/lib/notifications";
import { formatRelativeDate, getDisplayTitle } from "@/lib/postDisplay";

function LikeRowSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b border-stone-100 px-4 py-3.5">
      <div className="size-11 shrink-0 animate-pulse rounded-full bg-stone-200" />
      <div className="h-3.5 flex-1 animate-pulse rounded bg-stone-200" />
    </div>
  );
}

export default function LikesPage() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<LikeNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    getLikeNotifications().then((result) => {
      if (!cancelled) {
        setNotifications(result);
        setLoading(false);
      }
    });

    // Fire-and-forget: opening this page marks Likes (and only Likes) read.
    markNotificationsRead(user.id, "like");
    setUnseenNotificationCategory("like", false);

    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <NotificationsPageShell title="Helpful">
      {loading ? (
        <div>
          {[0, 1, 2].map((key) => (
            <LikeRowSkeleton key={key} />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <p className="px-4 py-16 text-center text-sm text-stone-400">Nothing marked helpful yet.</p>
      ) : (
        <div>
          {notifications.map((notification) => (
            <NotificationRow
              key={notification.id}
              actorUserId={notification.actorUserId}
              actorDisplayName={notification.actorDisplayName}
              actorAvatarUrl={notification.actorAvatarUrl}
              rightSlot={
                notification.post ? (
                  <Link href={`/post/${notification.postId}`} className="block">
                    {notification.post.media[0] ? (
                      <DemoPhoto
                        src={notification.post.media[0].url}
                        alt={getDisplayTitle(notification.post)}
                        className="size-12 rounded-lg"
                      />
                    ) : (
                      <span className="grid size-12 place-items-center rounded-lg bg-stone-100 text-center text-[10px] font-semibold text-stone-500">
                        {getDisplayTitle(notification.post)}
                      </span>
                    )}
                  </Link>
                ) : undefined
              }
            >
              <p className="text-sm text-stone-900">
                <Link href={`/profile/${notification.actorUserId}`} className="font-bold">
                  {notification.actorDisplayName}
                </Link>{" "}
                found your post helpful
              </p>
              <p className="mt-0.5 text-[11px] text-stone-400">{formatRelativeDate(notification.createdAt)}</p>
            </NotificationRow>
          ))}
        </div>
      )}
    </NotificationsPageShell>
  );
}
