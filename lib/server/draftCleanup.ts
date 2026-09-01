import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteStoragePrefix } from "@/lib/server/storagePrefix";
import { POST_IMAGE_BUCKET, POST_VIDEO_BUCKET } from "@/lib/storage";

/** Product rule (Phase 1): a draft with no meaningful activity for 3 days
 *  is abandoned. Based on updated_at — never created_at, never any
 *  client-side/localStorage signal — see post_drafts_cleanup_claim.sql for
 *  why claiming a draft never touches this same column. */
export const STALE_DRAFT_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/** A claim older than this is treated as abandoned by a crashed/killed
 *  worker, not an actively-running one — see the claim column's own doc
 *  comment (post_drafts_cleanup_claim.sql) for why this exists at all.
 *  10 minutes is far longer than sweeping a handful of small objects
 *  across two buckets should ever take. */
const CLAIM_STALE_MS = 10 * 60 * 1000;

/** Bounded so one run never loads the whole table into memory — any
 *  remainder is simply picked up by the next scheduled run; no queue
 *  needed at this scale. */
export const CLEANUP_BATCH_SIZE = 100;

export type StaleDraftCandidate = {
  id: string;
  user_id: string;
  post_type: string;
  updated_at: string;
};

export type DraftCleanupOutcome = "cleaned" | "skipped" | "failed";

function cutoffIso(now: Date): string {
  return new Date(now.getTime() - STALE_DRAFT_TTL_MS).toISOString();
}

function claimStaleIso(now: Date): string {
  return new Date(now.getTime() - CLAIM_STALE_MS).toISOString();
}

/**
 * Read-only candidate query — the exact same query the real cleanup run
 * uses to pick drafts, safe to call for a dry run (nothing is claimed or
 * deleted here). The ONLY selection root: post_drafts itself. This can
 * never discover a published post's media, because a published draft's
 * post_drafts row no longer exists (publish_post_draft deletes it as the
 * last step of its own transaction) — there is deliberately no Storage-
 * age-based or path-shape-based scan anywhere in this module.
 *
 * cleanup_claimed_at is null OR older than the claim-staleness threshold:
 * a draft currently claimed by an in-progress attempt (elsewhere, or a
 * concurrent invocation) is excluded; a draft whose claim is old enough to
 * be a dead worker's leftover is eligible again.
 */
export async function findStaleDraftCandidates(client: SupabaseClient, now: Date = new Date()): Promise<StaleDraftCandidate[]> {
  const { data, error } = await client
    .from("post_drafts")
    .select("id, user_id, post_type, updated_at")
    .lt("updated_at", cutoffIso(now))
    .or(`cleanup_claimed_at.is.null,cleanup_claimed_at.lt.${claimStaleIso(now)}`)
    .order("updated_at", { ascending: true })
    .limit(CLEANUP_BATCH_SIZE);

  if (error) {
    throw new Error(`Couldn't query stale drafts: ${error.message}`);
  }
  return (data ?? []) as StaleDraftCandidate[];
}

/**
 * Cleans up exactly one candidate draft. Never throws — every outcome is
 * reported via the return value, so one broken draft can never abort a
 * batch (see the caller in the API route, which loops over candidates
 * independently).
 *
 * Sequence, matching the required Storage-first-DB-second ordering:
 * 1. Atomically claim the draft — a single conditional UPDATE requiring
 *    updated_at to still equal exactly what was observed when this
 *    candidate was selected, AND still be older than the cutoff, AND the
 *    claim to still be null-or-stale. Zero rows matched means either the
 *    user resumed the draft (updated_at moved) or another invocation
 *    already claimed it — either way, this draft is skipped, and Storage
 *    is never touched for it.
 * 2. Immediately before touching any Storage object, re-read the draft and
 *    verify BOTH updated_at and cleanup_claimed_at still exactly equal
 *    what step 1 just observed/set. The claim alone only proves the draft
 *    was stale AT THE MOMENT OF CLAIMING — sweeping a draft with several
 *    photos across two buckets is not instantaneous, and every meaningful
 *    mutation (a field edit, a new upload, a reorder, a removal — see
 *    supabase/post_drafts_cleanup_claim.sql's redefinition of
 *    touch_draft_updated_at, and updateMediaDraftFields/
 *    updateTextDraftFields in lib/postDrafts.ts) now clears
 *    cleanup_claimed_at back to null the instant it happens, specifically
 *    so this re-read can detect "the user came back" even if it happened
 *    after the claim succeeded. If either value has changed — including
 *    the row having vanished entirely, e.g. published in the meantime —
 *    this draft is skipped and Storage is never touched.
 * 3. Sweep both Storage buckets under the draft's exact
 *    ${userId}/${draftId}/ prefix (deleteStoragePrefix enumerates the
 *    prefix directly — never draft_media.storage_path — so an object
 *    orphaned by a past failed insert, with no draft_media row at all, is
 *    still caught).
 * 4. Only if BOTH bucket sweeps succeed, delete the post_drafts row
 *    (draft_media cascades). If Storage cleanup fails, the claim is
 *    released (reset to null) so a future run retries from scratch — the
 *    draft is left exactly as it was, never partially cleaned.
 * 5. If the DB delete itself fails after Storage already succeeded, the
 *    claim is also released — a retry's Storage sweep will find the
 *    prefix already empty (success, by construction) and just retry the
 *    DB delete.
 */
export async function cleanupStaleDraft(client: SupabaseClient, candidate: StaleDraftCandidate, now: Date = new Date()): Promise<DraftCleanupOutcome> {
  const claimedAtIso = now.toISOString();
  const { data: claimed, error: claimError } = await client
    .from("post_drafts")
    .update({ cleanup_claimed_at: claimedAtIso })
    .eq("id", candidate.id)
    .eq("updated_at", candidate.updated_at)
    .lt("updated_at", cutoffIso(now))
    .or(`cleanup_claimed_at.is.null,cleanup_claimed_at.lt.${claimStaleIso(now)}`)
    .select("id")
    .maybeSingle();

  if (claimError) {
    console.error(`cleanupStaleDraft: claim failed for draft ${candidate.id}:`, claimError.message);
    return "failed";
  }
  if (!claimed) {
    return "skipped";
  }

  const { data: recheck, error: recheckError } = await client
    .from("post_drafts")
    .select("updated_at, cleanup_claimed_at")
    .eq("id", candidate.id)
    .maybeSingle();

  if (recheckError) {
    console.error(`cleanupStaleDraft: pre-delete re-check failed for draft ${candidate.id}:`, recheckError.message);
    await client.from("post_drafts").update({ cleanup_claimed_at: null }).eq("id", candidate.id);
    return "failed";
  }
  if (!recheck || recheck.updated_at !== candidate.updated_at || recheck.cleanup_claimed_at !== claimedAtIso) {
    // Either the row is gone (e.g. published between the claim and now —
    // nothing left to release) or a meaningful mutation landed in that
    // same window (release our claim; harmless no-op if it's already null).
    if (recheck) {
      await client.from("post_drafts").update({ cleanup_claimed_at: null }).eq("id", candidate.id);
    }
    return "skipped";
  }

  const prefix = `${candidate.user_id}/${candidate.id}/`;
  try {
    await deleteStoragePrefix(client, POST_IMAGE_BUCKET, prefix);
    await deleteStoragePrefix(client, POST_VIDEO_BUCKET, prefix);
  } catch (err) {
    console.error(`cleanupStaleDraft: storage cleanup failed for draft ${candidate.id}:`, err instanceof Error ? err.message : err);
    await client.from("post_drafts").update({ cleanup_claimed_at: null }).eq("id", candidate.id);
    return "failed";
  }

  const { error: deleteError } = await client.from("post_drafts").delete().eq("id", candidate.id);
  if (deleteError) {
    console.error(
      `cleanupStaleDraft: DB delete failed for draft ${candidate.id} after storage cleanup succeeded:`,
      deleteError.message,
    );
    await client.from("post_drafts").update({ cleanup_claimed_at: null }).eq("id", candidate.id);
    return "failed";
  }

  return "cleaned";
}

export type CleanupSummary = {
  scanned: number;
  cleaned: number;
  skipped: number;
  failed: number;
};

/** Processes a batch of candidates independently — one failure never
 *  aborts the rest. */
export async function runStaleDraftCleanup(client: SupabaseClient, now: Date = new Date()): Promise<CleanupSummary> {
  const candidates = await findStaleDraftCandidates(client, now);

  let cleaned = 0;
  let skipped = 0;
  let failed = 0;

  for (const candidate of candidates) {
    const outcome = await cleanupStaleDraft(client, candidate, now);
    if (outcome === "cleaned") cleaned += 1;
    else if (outcome === "skipped") skipped += 1;
    else failed += 1;
  }

  return { scanned: candidates.length, cleaned, skipped, failed };
}
