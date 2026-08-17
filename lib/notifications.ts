"use client";

import { useSyncExternalStore } from "react";
import { getCommentsByIds } from "@/lib/comments";
import { getPostsByIds } from "@/lib/posts";
import { FALLBACK_DISPLAY_NAME, getProfilesByUserIds } from "@/lib/profiles";
import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";
import type { Post } from "@/types/post";

export type NotificationType = "like" | "comment" | "follow";

export type UnreadNotificationCounts = {
  likeCount: number;
  followCount: number;
  commentCount: number;
};

const EMPTY_UNREAD_COUNTS: UnreadNotificationCounts = { likeCount: 0, followCount: 0, commentCount: 0 };

/** Current actor identity, resolved via actor_user_id -> profiles — never a
 *  stored snapshot, exactly like post/comment authorship elsewhere. */
type ActorIdentity = {
  actorUserId: string;
  actorDisplayName: string;
  actorAvatarUrl?: string;
};

export type LikeNotification = ActorIdentity & {
  id: number;
  postId: number;
  /** Undefined only if the post preview couldn't be batch-loaded — the row
   *  itself still renders, just without a thumbnail. */
  post?: Post;
  createdAt: string;
  readAt: string | null;
};

export type CommentNotification = ActorIdentity & {
  id: number;
  postId: number;
  post?: Post;
  commentId: number;
  commentBody: string;
  /** True when I am specifically the person being replied to (not merely
   *  "the underlying comment happens to be a reply to someone") — computed
   *  once, server-side, at insert time (see notify_on_comment in
   *  supabase/notifications_updates.sql), so it stays correct even if the
   *  comment is later moderation-removed or its root is removed. Never
   *  re-derived client-side from the comment's own parentCommentId. */
  isReply: boolean;
  createdAt: string;
  readAt: string | null;
};

export type FollowNotification = ActorIdentity & {
  id: number;
  createdAt: string;
  readAt: string | null;
};

/** snake_case shape of a `notifications` row, as returned by Supabase/PostgREST. */
type NotificationRow = {
  id: number;
  actor_user_id: string;
  post_id: number | null;
  comment_id: number | null;
  is_reply: boolean;
  read_at: string | null;
  created_at: string;
};

const NOTIFICATION_COLUMNS = "id, actor_user_id, post_id, comment_id, is_reply, read_at, created_at";

/** One round trip for the three Messages-home badges — also the initial/
 *  recovery value for BottomNav's per-category unread store below. */
export async function getUnreadNotificationCounts(): Promise<UnreadNotificationCounts> {
  if (!isSupabaseConfigured) return EMPTY_UNREAD_COUNTS;

  const { data, error } = await supabase.rpc("get_unread_notification_counts").single();

  if (error || !data) {
    console.error("Failed to load unread notification counts from Supabase:", error?.message);
    return EMPTY_UNREAD_COUNTS;
  }

  const row = data as { like_count: number; follow_count: number; comment_count: number };
  return {
    likeCount: row.like_count ?? 0,
    followCount: row.follow_count ?? 0,
    commentCount: row.comment_count ?? 0,
  };
}

async function fetchNotificationRows(type: NotificationType): Promise<NotificationRow[]> {
  if (!isSupabaseConfigured) return [];

  const { data, error } = await supabase
    .from("notifications")
    .select(NOTIFICATION_COLUMNS)
    .eq("type", type)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`Failed to load ${type} notifications from Supabase:`, error.message);
    return [];
  }

  return data ?? [];
}

/** Real historical Like notifications on the signed-in user's own posts,
 *  newest first. This is event history, not a live mirror of post_likes — a
 *  row persists across unlike. The database itself guarantees at most one
 *  row per actor+post (see supabase/notifications.sql), so no client-side
 *  dedup is attempted here. Actor identity and post previews are both
 *  batch-resolved — never one query per row. */
export async function getLikeNotifications(): Promise<LikeNotification[]> {
  const rows = await fetchNotificationRows("like");
  if (rows.length === 0) return [];

  const actorIds = rows.map((row) => row.actor_user_id);
  const postIds = rows.map((row) => row.post_id).filter((id): id is number => id != null);

  const [profilesByActorId, posts] = await Promise.all([getProfilesByUserIds(actorIds), getPostsByIds(postIds)]);
  const postsById = new Map(posts.map((post) => [post.id, post]));

  return rows.map((row) => {
    const profile = profilesByActorId.get(row.actor_user_id);
    return {
      id: row.id,
      actorUserId: row.actor_user_id,
      actorDisplayName: profile?.displayName ?? FALLBACK_DISPLAY_NAME,
      actorAvatarUrl: profile?.avatarUrl ?? undefined,
      postId: row.post_id as number,
      post: row.post_id != null ? postsById.get(row.post_id) : undefined,
      createdAt: row.created_at,
      readAt: row.read_at,
    };
  });
}

/** Real historical Comment notifications on the signed-in user's own posts —
 *  and, since Phase 5D, on the signed-in user's own comments/replies too,
 *  newest first. Each real comment/reply is its own independent event — the
 *  database never dedups these, so the same actor commenting twice on the
 *  same post correctly produces two rows here. Actor identity, post
 *  previews, and comment bodies are all batch-resolved. isReply comes
 *  straight off the row (see the type's own doc comment) — never inferred
 *  from the batch-loaded comment. */
export async function getCommentNotifications(): Promise<CommentNotification[]> {
  const rows = await fetchNotificationRows("comment");
  if (rows.length === 0) return [];

  const actorIds = rows.map((row) => row.actor_user_id);
  const postIds = rows.map((row) => row.post_id).filter((id): id is number => id != null);
  const commentIds = rows.map((row) => row.comment_id).filter((id): id is number => id != null);

  const [profilesByActorId, posts, commentsById] = await Promise.all([
    getProfilesByUserIds(actorIds),
    getPostsByIds(postIds),
    getCommentsByIds(commentIds),
  ]);
  const postsById = new Map(posts.map((post) => [post.id, post]));

  return rows.map((row) => {
    const profile = profilesByActorId.get(row.actor_user_id);
    const comment = row.comment_id != null ? commentsById.get(row.comment_id) : undefined;
    return {
      id: row.id,
      actorUserId: row.actor_user_id,
      actorDisplayName: profile?.displayName ?? FALLBACK_DISPLAY_NAME,
      actorAvatarUrl: profile?.avatarUrl ?? undefined,
      postId: row.post_id as number,
      post: row.post_id != null ? postsById.get(row.post_id) : undefined,
      commentId: row.comment_id as number,
      commentBody: comment?.body ?? "",
      isReply: row.is_reply,
      createdAt: row.created_at,
      readAt: row.read_at,
    };
  });
}

/** Real historical Follow ("New follower") notifications, newest first —
 *  event history that persists across unfollow. The database guarantees at
 *  most one row per actor+recipient (see supabase/notifications.sql), so no
 *  client-side dedup is attempted here. */
export async function getFollowNotifications(): Promise<FollowNotification[]> {
  const rows = await fetchNotificationRows("follow");
  if (rows.length === 0) return [];

  const actorIds = rows.map((row) => row.actor_user_id);
  const profilesByActorId = await getProfilesByUserIds(actorIds);

  return rows.map((row) => {
    const profile = profilesByActorId.get(row.actor_user_id);
    return {
      id: row.id,
      actorUserId: row.actor_user_id,
      actorDisplayName: profile?.displayName ?? FALLBACK_DISPLAY_NAME,
      actorAvatarUrl: profile?.avatarUrl ?? undefined,
      createdAt: row.created_at,
      readAt: row.read_at,
    };
  });
}

/** Marks every currently-unread notification of one category as read for
 *  `userId`. Never deletes anything — `read_at` is the only column this ever
 *  touches (also enforced server-side via a column-level grant). Best-effort:
 *  logs rather than throws, since this is a background side effect of
 *  opening a category page, not a user-initiated action with its own
 *  saving/error UI. */
export async function markNotificationsRead(userId: string, type: NotificationType): Promise<void> {
  if (!isSupabaseConfigured) return;

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_user_id", userId)
    .eq("type", type)
    .is("read_at", null);

  if (error) {
    console.error(`Failed to mark ${type} notifications read:`, error.message);
  }
}

// ============================================================================
// Shared, same-tab reactive state for the BottomNav dot's notification portion
// ============================================================================
// A separate store from lib/messages.ts's hasUnseenMessages — deliberately
// not merged into it. Each of the three categories clears independently
// (its own page marking only its own type read), so a single shared boolean
// would mean clearing any one of them could incorrectly clear the others'
// contribution to the dot. BottomNav simply ORs both stores' hooks together
// at render time; neither store ever writes to the other.

type NotificationCategory = "like" | "follow" | "comment";

let unseenNotificationCategories: Record<NotificationCategory, boolean> = {
  like: false,
  follow: false,
  comment: false,
};
const unseenNotificationListeners = new Set<() => void>();

function notifyUnseenNotificationListeners() {
  unseenNotificationListeners.forEach((listener) => listener());
}

/** Flips one category's unseen flag and notifies subscribers — a no-op if
 *  the value isn't actually changing, so this is safe to call from a
 *  Realtime handler on every qualifying event without spamming re-renders. */
export function setUnseenNotificationCategory(category: NotificationCategory, value: boolean) {
  if (unseenNotificationCategories[category] === value) return;
  unseenNotificationCategories = { ...unseenNotificationCategories, [category]: value };
  notifyUnseenNotificationListeners();
}

/** Seeds all three categories at once from a real getUnreadNotificationCounts()
 *  result — the initial/recovery value on BottomNav mount, before Realtime
 *  has had a chance to report anything live. */
export function setUnseenNotificationCategoriesFromCounts(counts: UnreadNotificationCounts) {
  setUnseenNotificationCategory("like", counts.likeCount > 0);
  setUnseenNotificationCategory("follow", counts.followCount > 0);
  setUnseenNotificationCategory("comment", counts.commentCount > 0);
}

/** Reactive read of "is any of Likes/Followers/Comments currently unseen" —
 *  false on both the server and the first client render, only ever changing
 *  after a real client-side check or Realtime event. */
export function useHasUnseenNotifications(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      unseenNotificationListeners.add(onChange);
      return () => unseenNotificationListeners.delete(onChange);
    },
    () => unseenNotificationCategories.like || unseenNotificationCategories.follow || unseenNotificationCategories.comment,
    () => false,
  );
}

/** snake_case shape of the one field this subscription actually needs. */
type IncomingNotificationRow = { type: NotificationType };

/**
 * One Realtime subscription for the current recipient's own notifications —
 * not three. Filtered server-side by recipient_user_id, though RLS remains
 * the actual security backstop regardless of what filter a caller requests
 * (same principle as subscribeToConversationMessages's conversation_id
 * filter in lib/messages.ts). No self-exclusion check is needed here, unlike
 * the DM case: the database never creates a notification where the actor is
 * also the recipient (every trigger in notifications_updates.sql/
 * comment_replies.sql/notifications.sql already guards this), so every row
 * this delivers is genuinely new activity from someone else.
 */
export function subscribeToIncomingNotifications(
  userId: string,
  onInsert: (notification: { type: NotificationType }) => void,
): () => void {
  if (!isSupabaseConfigured) return () => {};

  const channel = supabase
    .channel(`notifications-${userId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_user_id=eq.${userId}` },
      (payload) => onInsert(payload.new as IncomingNotificationRow),
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
