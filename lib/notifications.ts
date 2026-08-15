"use client";

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
  read_at: string | null;
  created_at: string;
};

const NOTIFICATION_COLUMNS = "id, actor_user_id, post_id, comment_id, read_at, created_at";

/** One round trip for the three Messages-home badges. */
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

/** Real historical Comment notifications on the signed-in user's own posts,
 *  newest first. Each real comment is its own independent event — the
 *  database never dedups these, so the same actor commenting twice on the
 *  same post correctly produces two rows here. Actor identity, post
 *  previews, and comment bodies are all batch-resolved. */
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
