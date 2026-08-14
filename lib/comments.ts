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
};

/** snake_case shape of a `comments` row, as returned by Supabase/PostgREST. */
type CommentRow = {
  id: number;
  post_id: number;
  user_id: string;
  body: string;
  created_at: string;
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
  };
}

const COMMENT_COLUMNS = "id, post_id, user_id, body, created_at";

/** Batched profile resolution for one post's comment list — one query keyed
 *  on the comments' unique commenter ids, regardless of comment count, never
 *  one request per comment (no N+1). */
async function attachCommentAuthorProfiles(comments: Comment[]): Promise<Comment[]> {
  const userIds = comments.map((comment) => comment.userId);
  if (userIds.length === 0) return comments;

  const profilesByUserId = await getProfilesByUserIds(userIds);

  return comments.map((comment) => {
    const profile = profilesByUserId.get(comment.userId);
    if (!profile) return comment;
    return {
      ...comment,
      authorDisplayName: profile.displayName ?? FALLBACK_DISPLAY_NAME,
      authorAvatarUrl: profile.avatarUrl ?? undefined,
    };
  });
}

/** Every comment on one post, oldest first, with current author identity
 *  attached — a dedicated per-post query, not folded into the batched
 *  get_post_engagement RPC: a feed of 20 posts must never fetch 20 full
 *  comment lists, but a single Post Detail page fetching its own one list is
 *  exactly the case a plain one-post query is correct and cheap for. */
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

/** Inserts a comment as `userId`, then resolves its author's current profile
 *  for the returned Comment — identity is never supplied by the caller, only
 *  resolved from `userId` (via profiles). RLS verifies `userId` against
 *  `auth.uid()` independently of anything else in the request. */
export async function addComment(postId: number, userId: string, body: string): Promise<Comment> {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase isn't configured — add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local.",
    );
  }

  const { data, error } = await supabase
    .from("comments")
    .insert({ post_id: postId, user_id: userId, body })
    .select(COMMENT_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to post comment.");
  }

  const comment = rowToComment(data);
  const profile = await getProfile(userId);
  if (!profile) return comment;

  return {
    ...comment,
    authorDisplayName: profile.displayName ?? FALLBACK_DISPLAY_NAME,
    authorAvatarUrl: profile.avatarUrl ?? undefined,
  };
}

/** Owner-only at the database level (RLS: `auth.uid() = user_id`). Mirrors
 *  deletePost's own affected-row-count check in lib/posts.ts. */
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
