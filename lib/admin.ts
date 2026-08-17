"use client";

import { FALLBACK_DISPLAY_NAME, getProfilesByUserIds, type Profile } from "@/lib/profiles";
import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";

/** Fields common to a pending report and a reviewed (dismissed/actioned)
 *  report — everything sourced directly from the admin-checked RPCs
 *  (get_pending_reports_for_admin / get_reviewed_reports_for_admin), never
 *  from a live posts/comments read. The moderation tool has zero dependency
 *  on ordinary posts/comments RLS as of Phase 5E — every field below,
 *  including contentPreview/contentAuthorUserId/parentPostId, comes straight
 *  off the RPC row. */
type ModerationReportBase = {
  id: number;
  targetType: "post" | "comment";
  /** Raw target identifiers — kept (not just parentPostId below) so the
   *  caller can tell whether two reports share the same target, needed
   *  after Remove: remove_reported_content actions every pending report
   *  against that same target, so the queue must drop every matching row
   *  locally, not just the one that was clicked. */
  targetPostId: number | null;
  targetCommentId: number | null;
  reporterUserId: string;
  reporterDisplayName: string;
  reporterAvatarUrl?: string;
  reason: string | null;
  createdAt: string;
  /** Undefined when the content's author is unknown — an ownerless legacy
   *  post/comment, or (for a reviewed report) an author whose account has
   *  since been deleted (target_author_user_id goes null via `on delete set
   *  null`; see supabase/moderation_history.sql). */
  contentAuthorUserId?: string;
  contentAuthorDisplayName: string;
  contentAuthorAvatarUrl?: string;
  /** Short text preview, computed once server-side by
   *  compute_moderation_content_preview — never derived client-side, and
   *  durable even if the target is later removed or hard-deleted. */
  contentPreview: string;
  /** The post to link to for "View" — the report's own target_post_id for a
   *  post report, or the reported comment's parent post id for a comment
   *  report (comments have no standalone page). Server-computed
   *  (content_post_id) at the moment the report was created/reviewed, so it
   *  keeps working even if the specific comment is later hard-deleted, as
   *  long as its parent post survives. */
  parentPostId: number;
};

export type PendingReport = ModerationReportBase;

export type ReviewedReport = ModerationReportBase & {
  status: "dismissed" | "actioned";
  reviewedAt: string;
  /** Null only if the reviewing admin's account was later deleted
   *  (reviewed_by_user_id `on delete set null`) — the row itself survives. */
  reviewedByUserId: string | null;
  reviewedByDisplayName: string;
  reviewedByAvatarUrl?: string;
};

/** snake_case shape shared by both admin RPCs' common columns. */
type ModerationReportRow = {
  report_id: number;
  target_type: "post" | "comment";
  target_post_id: number | null;
  target_comment_id: number | null;
  reporter_user_id: string;
  reason: string | null;
  created_at: string;
  content_preview: string;
  target_author_user_id: string | null;
  content_post_id: number;
};

/** snake_case shape of a get_reviewed_reports_for_admin() row. */
type ReviewedReportRow = ModerationReportRow & {
  status: "dismissed" | "actioned";
  reviewed_at: string;
  reviewed_by_user_id: string | null;
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

/** Shared reporter/author hydration for both report kinds — reads only from
 *  the already-batch-loaded profiles map, never issues its own query. */
function toModerationReportBase(row: ModerationReportRow, profilesByUserId: Map<string, Profile>): ModerationReportBase {
  const reporterProfile = profilesByUserId.get(row.reporter_user_id);
  const authorProfile = row.target_author_user_id ? profilesByUserId.get(row.target_author_user_id) : undefined;

  return {
    id: row.report_id,
    targetType: row.target_type,
    targetPostId: row.target_post_id,
    targetCommentId: row.target_comment_id,
    reporterUserId: row.reporter_user_id,
    reporterDisplayName: reporterProfile?.displayName ?? FALLBACK_DISPLAY_NAME,
    reporterAvatarUrl: reporterProfile?.avatarUrl ?? undefined,
    reason: row.reason,
    createdAt: row.created_at,
    contentAuthorUserId: row.target_author_user_id ?? undefined,
    contentAuthorDisplayName: authorProfile?.displayName ?? FALLBACK_DISPLAY_NAME,
    contentAuthorAvatarUrl: authorProfile?.avatarUrl ?? undefined,
    contentPreview: row.content_preview,
    parentPostId: row.content_post_id,
  };
}

/**
 * Every pending report, newest first, fully hydrated with current reporter
 * and content-author identity — via get_pending_reports_for_admin (itself
 * rejecting a non-admin caller server-side), which as of Phase 5E already
 * returns content_preview/target_author_user_id/content_post_id directly,
 * computed server-side by the same admin-checked, security-definer helper
 * reviewed reports use. The only follow-up call is one deduplicated
 * getProfilesByUserIds — no getPostsByIds/getCommentsByIds, no dependency on
 * ordinary posts/comments RLS anywhere in this function.
 */
export async function getPendingReportsForAdmin(): Promise<PendingReport[]> {
  if (!isSupabaseConfigured) return [];

  const { data, error } = await supabase.rpc("get_pending_reports_for_admin");

  if (error) {
    console.error("Failed to load pending reports from Supabase:", error.message);
    return [];
  }

  const rows = (data ?? []) as ModerationReportRow[];
  if (rows.length === 0) return [];

  const userIds = new Set<string>();
  rows.forEach((row) => {
    userIds.add(row.reporter_user_id);
    if (row.target_author_user_id) userIds.add(row.target_author_user_id);
  });

  const profilesByUserId = await getProfilesByUserIds(Array.from(userIds));

  return rows.map((row) => toModerationReportBase(row, profilesByUserId));
}

/**
 * Every reviewed report (dismissed or actioned), newest reviewed_at first —
 * via get_reviewed_reports_for_admin, which the database already orders
 * this way. One row per report, never grouped — a single Remove bulk-actions
 * every pending report against the same target, so History correctly shows
 * one row per reporter, all sharing the same reviewed_at/status/preview.
 * Sources reviewing-admin identity from the same batched profiles call as
 * reporter/content-author — one deduplicated getProfilesByUserIds for the
 * whole page, no posts/comments read at all.
 */
export async function getReviewedReportsForAdmin(): Promise<ReviewedReport[]> {
  if (!isSupabaseConfigured) return [];

  const { data, error } = await supabase.rpc("get_reviewed_reports_for_admin");

  if (error) {
    console.error("Failed to load reviewed reports from Supabase:", error.message);
    return [];
  }

  const rows = (data ?? []) as ReviewedReportRow[];
  if (rows.length === 0) return [];

  const userIds = new Set<string>();
  rows.forEach((row) => {
    userIds.add(row.reporter_user_id);
    if (row.target_author_user_id) userIds.add(row.target_author_user_id);
    if (row.reviewed_by_user_id) userIds.add(row.reviewed_by_user_id);
  });

  const profilesByUserId = await getProfilesByUserIds(Array.from(userIds));

  return rows.map((row) => {
    const reviewerProfile = row.reviewed_by_user_id ? profilesByUserId.get(row.reviewed_by_user_id) : undefined;
    return {
      ...toModerationReportBase(row, profilesByUserId),
      status: row.status,
      reviewedAt: row.reviewed_at,
      reviewedByUserId: row.reviewed_by_user_id,
      reviewedByDisplayName: reviewerProfile?.displayName ?? FALLBACK_DISPLAY_NAME,
      reviewedByAvatarUrl: reviewerProfile?.avatarUrl ?? undefined,
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
