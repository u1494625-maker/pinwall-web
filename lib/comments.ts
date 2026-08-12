"use client";

import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";

export type Comment = {
  id: number;
  postId: number;
  userId: string;
  /** Denormalized display-name snapshot, written by the client at insert
   *  time (same convention posts.author already uses — no profiles table
   *  exists). Display text only — NEVER used for authorization. `userId`,
   *  verified server-side via RLS's `auth.uid() = user_id` check, is the
   *  only source of truth for ownership/permissions. */
  author: string;
  body: string;
  createdAt: string;
};

/** snake_case shape of a `comments` row, as returned by Supabase/PostgREST. */
type CommentRow = {
  id: number;
  post_id: number;
  user_id: string;
  author: string;
  body: string;
  created_at: string;
};

function rowToComment(row: CommentRow): Comment {
  return {
    id: row.id,
    postId: row.post_id,
    userId: row.user_id,
    author: row.author,
    body: row.body,
    createdAt: row.created_at,
  };
}

const COMMENT_COLUMNS = "id, post_id, user_id, author, body, created_at";

/** Every comment on one post, oldest first — a dedicated per-post query, not
 *  folded into the batched get_post_engagement RPC: a feed of 20 posts must
 *  never fetch 20 full comment lists, but a single Post Detail page fetching
 *  its own one list is exactly the case a plain one-post query is correct
 *  and cheap for. */
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

  return (data ?? []).map(rowToComment);
}

/** `author` is a display-name snapshot only (see the Comment type's own
 *  comment) — it plays no role in authorization. RLS verifies `userId`
 *  against `auth.uid()` independently of whatever `author` text is sent. */
export async function addComment(
  postId: number,
  userId: string,
  author: string,
  body: string,
): Promise<Comment> {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase isn't configured — add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local.",
    );
  }

  const { data, error } = await supabase
    .from("comments")
    .insert({ post_id: postId, user_id: userId, author, body })
    .select(COMMENT_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to post comment.");
  }

  return rowToComment(data);
}

/** Owner-only at the database level (RLS: `auth.uid() = user_id`) — never
 *  based on the `author` text field. Mirrors deletePost's own
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
