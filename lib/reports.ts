"use client";

import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";

/** Mirrors the check constraint in supabase/reports.sql. */
export const MAX_REPORT_REASON_LENGTH = 500;

function normalizeReason(reason: string | undefined): string | null {
  const trimmed = reason?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Reports a post via the report_post RPC. The database derives the reporter
 * entirely from auth.uid() — no identity is ever sent from here, only the
 * target id and an optional reason. Self-report prevention and duplicate-
 * pending dedup are enforced server-side (see supabase/reports.sql); this is
 * a thin wrapper, not the source of truth for either. Throws a plain,
 * user-facing message on failure, never a raw Supabase error.
 */
export async function reportPost(postId: number, reason?: string): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error("Reporting isn't available right now.");
  }

  const { error } = await supabase.rpc("report_post", {
    p_target_post_id: postId,
    p_reason: normalizeReason(reason),
  });

  if (error) {
    throw new Error("Couldn't submit this report. Try again.");
  }
}

/** Reports a comment via the report_comment RPC — same shape/guarantees as reportPost. */
export async function reportComment(commentId: number, reason?: string): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error("Reporting isn't available right now.");
  }

  const { error } = await supabase.rpc("report_comment", {
    p_target_comment_id: commentId,
    p_reason: normalizeReason(reason),
  });

  if (error) {
    throw new Error("Couldn't submit this report. Try again.");
  }
}
