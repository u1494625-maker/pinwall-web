"use client";

import { getCommentsByIds } from "@/lib/comments";
import { getPostsByIds } from "@/lib/posts";
import { getDisplayTitle } from "@/lib/postDisplay";
import { FALLBACK_DISPLAY_NAME, getProfilesByUserIds } from "@/lib/profiles";
import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";

export type PendingReport = {
  id: number;
  targetType: "post" | "comment";
  /** Raw target identifiers — kept (not just parentPostId below) so the
   *  caller can tell whether two reports share the same target, needed
   *  after Remove: remove_reported_content actions every pending report
   *  against that same target, so the queue must drop every matching row
   *  locally, not just the one that was clicked. */
  targetPostId: number | null;
  targetCommentId: number | null;
  reason: string | null;
  createdAt: string;
  reporterUserId: string;
  reporterDisplayName: string;
  reporterAvatarUrl?: string;
  /** Undefined only for a pre-auth ownerless post — never a real user with
   *  no identity, since a comment always has a real author. */
  contentAuthorUserId?: string;
  contentAuthorDisplayName: string;
  contentAuthorAvatarUrl?: string;
  /** Short text preview — a post's display title, or a comment's body. */
  contentPreview: string;
  /** The post to link to for full context — the report's own target_post_id
   *  for a post report, or the comment's parent post for a comment report
   *  (comments have no standalone page). */
  parentPostId: number;
};

/** snake_case shape of a get_pending_reports_for_admin() row. */
type PendingReportRow = {
  report_id: number;
  target_type: "post" | "comment";
  target_post_id: number | null;
  target_comment_id: number | null;
  reporter_user_id: string;
  reason: string | null;
  created_at: string;
};

/** Real, one-time check of whether the signed-in user is an admin — a UX
 *  convenience only (e.g. deciding whether to show an admin entry point
 *  somewhere later). The actual security boundary is server-side: every
 *  admin RPC re-checks this independently and rejects a non-admin caller
 *  regardless of what the client believes. */
export async function isCurrentUserAdmin(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  const { data, error } = await supabase.rpc("is_current_user_admin");

  if (error) {
    console.error("Failed to check admin status:", error.message);
    return false;
  }

  return Boolean(data);
}

/**
 * Every pending report, newest first, fully hydrated with current reporter
 * and content-author identity plus a short content preview — via
 * get_pending_reports_for_admin() (which itself rejects a non-admin caller
 * server-side) followed by the exact same batched helpers every other list
 * in this app uses (getPostsByIds, getCommentsByIds, getProfilesByUserIds).
 * These work correctly here for removed/reporter-hidden content specifically
 * because of the admin-bypass posts/comments RLS policies added alongside
 * this RPC — no separate admin-only fetching path was built.
 */
export async function getPendingReportsForAdmin(): Promise<PendingReport[]> {
  if (!isSupabaseConfigured) return [];

  const { data, error } = await supabase.rpc("get_pending_reports_for_admin");

  if (error) {
    console.error("Failed to load pending reports from Supabase:", error.message);
    return [];
  }

  const rows = (data ?? []) as PendingReportRow[];
  if (rows.length === 0) return [];

  const postIds = rows
    .filter((row) => row.target_type === "post")
    .map((row) => row.target_post_id)
    .filter((id): id is number => id != null);
  const commentIds = rows
    .filter((row) => row.target_type === "comment")
    .map((row) => row.target_comment_id)
    .filter((id): id is number => id != null);

  const [posts, commentsById] = await Promise.all([getPostsByIds(postIds), getCommentsByIds(commentIds)]);
  const postsById = new Map(posts.map((post) => [post.id, post]));

  // A comment report's parent post might not already be in postsById (no
  // post report happened to reference it) — batch-fetch whichever parent
  // posts are still missing, still one extra call regardless of how many
  // comment reports there are, never one per report.
  const missingParentPostIds = Array.from(
    new Set(Array.from(commentsById.values()).map((comment) => comment.postId)),
  ).filter((id) => !postsById.has(id));
  if (missingParentPostIds.length > 0) {
    const parentPosts = await getPostsByIds(missingParentPostIds);
    parentPosts.forEach((post) => postsById.set(post.id, post));
  }

  const userIds = new Set<string>();
  for (const row of rows) {
    userIds.add(row.reporter_user_id);
    if (row.target_type === "post" && row.target_post_id != null) {
      const post = postsById.get(row.target_post_id);
      if (post?.userId) userIds.add(post.userId);
    } else if (row.target_type === "comment" && row.target_comment_id != null) {
      const comment = commentsById.get(row.target_comment_id);
      if (comment) userIds.add(comment.userId);
    }
  }

  const profilesByUserId = await getProfilesByUserIds(Array.from(userIds));

  return rows.map((row) => {
    const reporterProfile = profilesByUserId.get(row.reporter_user_id);

    let contentAuthorUserId: string | undefined;
    let contentPreview: string;
    let parentPostId: number;

    if (row.target_type === "post" && row.target_post_id != null) {
      const post = postsById.get(row.target_post_id);
      contentAuthorUserId = post?.userId;
      contentPreview = post ? getDisplayTitle(post) : "This post is no longer available.";
      parentPostId = row.target_post_id;
    } else {
      const comment = row.target_comment_id != null ? commentsById.get(row.target_comment_id) : undefined;
      contentAuthorUserId = comment?.userId;
      contentPreview = comment?.body ?? "This comment is no longer available.";
      parentPostId = comment?.postId ?? 0;
    }

    const contentAuthorProfile = contentAuthorUserId ? profilesByUserId.get(contentAuthorUserId) : undefined;

    return {
      id: row.report_id,
      targetType: row.target_type,
      targetPostId: row.target_post_id,
      targetCommentId: row.target_comment_id,
      reason: row.reason,
      createdAt: row.created_at,
      reporterUserId: row.reporter_user_id,
      reporterDisplayName: reporterProfile?.displayName ?? FALLBACK_DISPLAY_NAME,
      reporterAvatarUrl: reporterProfile?.avatarUrl ?? undefined,
      contentAuthorUserId,
      contentAuthorDisplayName: contentAuthorProfile?.displayName ?? FALLBACK_DISPLAY_NAME,
      contentAuthorAvatarUrl: contentAuthorProfile?.avatarUrl ?? undefined,
      contentPreview,
      parentPostId,
    };
  });
}

/** Resolves this one report only — target content is untouched, sibling
 *  reports against the same target are untouched. Throws a plain message on
 *  failure (not authorized, already reviewed by someone else, etc.). */
export async function dismissReport(reportId: number): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error("Moderation isn't available right now.");
  }

  const { error } = await supabase.rpc("dismiss_report", { p_report_id: reportId });

  if (error) {
    throw new Error("Couldn't dismiss this report. Try again.");
  }
}

/** Soft-removes the reported target (moderation_status = 'removed') and
 *  actions every pending report against that same target, atomically —
 *  never a hard delete. Throws a plain message on failure. */
export async function removeReportedContent(reportId: number): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error("Moderation isn't available right now.");
  }

  const { error } = await supabase.rpc("remove_reported_content", { p_report_id: reportId });

  if (error) {
    throw new Error("Couldn't remove this content. Try again.");
  }
}
