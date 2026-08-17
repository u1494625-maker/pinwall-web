"use client";

import { FALLBACK_DISPLAY_NAME, getProfile, getProfilesByUserIds } from "@/lib/profiles";
import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";

export type Comment = {
  id: number;
  postId: number;
  userId: string;
  /** Current profile identity for this comment's author, resolved via
   *  userId -> profiles (never a stored snapshot — comments.author was
   *  removed entirely; see supabase/profile_identity_unification.sql).
   *  Always a renderable string; falls back to FALLBACK_DISPLAY_NAME if the
   *  author has no profile row. */
  authorDisplayName: string;
  authorAvatarUrl?: string;
  body: string;
  createdAt: string;
  /** Null for a top-level comment. For a reply, always the id of a genuine
   *  top-level comment — never another reply's id, even when the user
   *  tapped Reply on a reply (add_comment flattens this server-side; see
   *  supabase/comment_replies.sql). This is the sole "is this row a reply"
   *  signal — replyToUserId can independently become null later (see
   *  below), so it must never be used for that check. */
  parentCommentId: number | null;
  /** The user this reply is directed at. Null for a top-level comment. Also
   *  null for an existing reply whose target user's account was later
   *  deleted (on delete set null) — the reply itself still exists and is
   *  still structurally a reply (parentCommentId stays set); it just loses
   *  this attribution. */
  replyToUserId: string | null;
  /** Current display name for replyToUserId, resolved the same way
   *  authorDisplayName is — never a stored snapshot. Null exactly when
   *  parentCommentId is null (not a reply at all); falls back to
   *  FALLBACK_DISPLAY_NAME both when replyToUserId has no profile row and
   *  when replyToUserId itself is null but this is still a reply. */
  replyToDisplayName: string | null;
};

/** snake_case shape of a `comments` row, as returned by Supabase/PostgREST —
 *  also the exact shape of add_comment()'s returned row (same table,
 *  security definer RPC that inserts into and returns from this table). */
type CommentRow = {
  id: number;
  post_id: number;
  user_id: string;
  body: string;
  created_at: string;
  parent_comment_id: number | null;
  reply_to_user_id: string | null;
};

function rowToComment(row: CommentRow): Comment {
  return {
    id: row.id,
    postId: row.post_id,
    userId: row.user_id,
    // Overwritten by attachCommentAuthorProfiles() right after fetch — this
    // default only matters if that call fails or the commenter has no
    // profile row.
    authorDisplayName: FALLBACK_DISPLAY_NAME,
    authorAvatarUrl: undefined,
    body: row.body,
    createdAt: row.created_at,
    parentCommentId: row.parent_comment_id,
    replyToUserId: row.reply_to_user_id,
    // Overwritten by attachCommentAuthorProfiles() for a fetched list — left
    // null here since rowToComment alone can't know yet whether this is a
    // reply. addComment()'s single freshly-inserted row is the one caller
    // that doesn't route through attachCommentAuthorProfiles at all; its own
    // caller (CommentThread) fills this in from state it already has — see
    // addComment() below.
    replyToDisplayName: null,
  };
}

const COMMENT_COLUMNS = "id, post_id, user_id, body, created_at, parent_comment_id, reply_to_user_id";

/** Batched profile resolution for one post's comment list — one query keyed
 *  on every commenter's AND every reply-target's unique user id combined
 *  (deduped), regardless of comment count, never one request per comment
 *  (no N+1) and never a second separate query for reply attribution. */
async function attachCommentAuthorProfiles(comments: Comment[]): Promise<Comment[]> {
  const userIds = new Set<string>();
  comments.forEach((comment) => {
    userIds.add(comment.userId);
    if (comment.replyToUserId) userIds.add(comment.replyToUserId);
  });
  if (userIds.size === 0) return comments;

  const profilesByUserId = await getProfilesByUserIds(Array.from(userIds));

  return comments.map((comment) => {
    const authorProfile = profilesByUserId.get(comment.userId);
    const replyToProfile = comment.replyToUserId ? profilesByUserId.get(comment.replyToUserId) : undefined;

    return {
      ...comment,
      authorDisplayName: authorProfile?.displayName ?? FALLBACK_DISPLAY_NAME,
      authorAvatarUrl: authorProfile?.avatarUrl ?? undefined,
      // parentCommentId, not replyToUserId, decides whether this row is a
      // reply at all — a reply whose target account was deleted still gets
      // a renderable (fallback) name here, never null.
      replyToDisplayName: comment.parentCommentId !== null ? (replyToProfile?.displayName ?? FALLBACK_DISPLAY_NAME) : null,
    };
  });
}

/** Every comment on one post — top-level and replies both, since a reply is
 *  just another row in this same table — oldest first, with current author
 *  (and, for replies, current reply-target) identity attached. A dedicated
 *  per-post query, not folded into the batched get_post_engagement RPC: a
 *  feed of 20 posts must never fetch 20 full comment lists, but a single
 *  Post Detail page fetching its own one list is exactly the case a plain
 *  one-post query is correct and cheap for. Grouping top-level comments and
 *  their replies is done client-side (see CommentThread.tsx) — this flat,
 *  already-oldest-first list is everything that needs. */
export async function getCommentsForPost(postId: number): Promise<Comment[]> {
  if (!isSupabaseConfigured) return [];

  const { data, error } = await supabase
    .from("comments")
    .select(COMMENT_COLUMNS)
    .eq("post_id", postId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to load comments from Supabase:", error.message);
    return [];
  }

  return attachCommentAuthorProfiles((data ?? []).map(rowToComment));
}

/** Comments matching any of the given ids, keyed by id — used to batch-load
 *  comment bodies for a list of items that each reference one comment (e.g.
 *  comment notification rows, the admin moderation queue), never one query
 *  per item. Returns an empty Map immediately, with no query at all, for an
 *  empty input. */
export async function getCommentsByIds(commentIds: number[]): Promise<Map<number, Comment>> {
  const uniqueIds = Array.from(new Set(commentIds));
  if (uniqueIds.length === 0 || !isSupabaseConfigured) return new Map();

  const { data, error } = await supabase.from("comments").select(COMMENT_COLUMNS).in("id", uniqueIds);

  if (error) {
    console.error("Failed to batch-load comments from Supabase:", error.message);
    return new Map();
  }

  const comments = await attachCommentAuthorProfiles((data ?? []).map(rowToComment));
  return new Map(comments.map((comment) => [comment.id, comment]));
}

/**
 * Creates a comment — top-level when replyToCommentId is omitted, a reply
 * when it's the id of an existing (top-level or reply) comment — via the
 * add_comment RPC, the only way any comment can be created (see
 * supabase/comment_replies.sql: there is no INSERT grant on comments at
 * all). Identity is derived entirely from auth.uid() inside the RPC — there
 * is no userId parameter here to forge, and none is sent. The RPC itself
 * flattens replyToCommentId to its true root and derives the reply-target
 * user server-side from whichever row was actually tapped; this function
 * never computes, assumes, or trusts either value.
 *
 * The returned Comment's replyToDisplayName is always null (see
 * rowToComment) — this function only resolves the author's own current
 * profile, exactly like it always has. The caller (CommentThread) already
 * knows the reply target's current display name synchronously from its own
 * "Replying to X" state and attaches it before rendering, avoiding a second
 * profile round trip for the common optimistic-append case.
 */
export async function addComment(postId: number, body: string, replyToCommentId?: number): Promise<Comment> {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase isn't configured — add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local.",
    );
  }

  const { data, error } = await supabase.rpc("add_comment", {
    p_post_id: postId,
    p_body: body,
    p_reply_to_comment_id: replyToCommentId ?? null,
  });

  if (error || !data) {
    throw new Error(error?.message ?? "Couldn't post that comment. Try again.");
  }

  const comment = rowToComment(data as CommentRow);
  const profile = await getProfile(comment.userId);
  if (!profile) return comment;

  return {
    ...comment,
    authorDisplayName: profile.displayName ?? FALLBACK_DISPLAY_NAME,
    authorAvatarUrl: profile.avatarUrl ?? undefined,
  };
}

/** Owner-only at the database level (RLS: `auth.uid() = user_id`). Deleting
 *  a top-level comment cascades every reply under it at the database level
 *  (parent_comment_id ... on delete cascade) — callers are responsible for
 *  reflecting that same cascade in any locally-held comment list (see
 *  PostDetail.tsx's handleDeleteComment). Mirrors deletePost's own
 *  affected-row-count check in lib/posts.ts. */
export async function deleteComment(commentId: number): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase isn't configured — add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local.",
    );
  }

  const { data, error } = await supabase.from("comments").delete().eq("id", commentId).select("id");

  if (error) {
    throw new Error(error.message);
  }

  if (!data || data.length === 0) {
    throw new Error("Comment could not be deleted — it may not exist, or you may not own it.");
  }
}
