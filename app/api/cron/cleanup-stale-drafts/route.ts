import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { findStaleDraftCandidates, runStaleDraftCleanup } from "@/lib/server/draftCleanup";

// Server-only — never NEXT_PUBLIC_, matching app/api/account/delete/route.ts's
// own convention exactly.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
// Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` on every
// request IT generates to trigger a configured cron job, once this env var
// is set — Vercel's own documented convention, the same one the original
// Phase 6 plan specified. This is the entire authorization model: no other
// caller can produce a matching header without knowing this value.
const CRON_SECRET = process.env.CRON_SECRET ?? "";

/**
 * Daily stale-draft garbage collection — see vercel.json (project root) for
 * the schedule and lib/server/draftCleanup.ts for the actual cleanup logic
 * (candidate selection, atomic per-draft claim, Storage-then-DB deletion
 * order, failure isolation). This route is deliberately thin: authenticate,
 * construct the one service-role client, delegate, respond.
 *
 * GET, not POST: Vercel Cron only ever sends GET requests to the configured
 * path — this must be a GET handler for a Vercel Cron trigger to work at
 * all. The same GET handler also serves manual testing, via the SAME
 * CRON_SECRET bearer check — see `?dryRun=1` below, which only ever reads
 * candidates (draft id / post_type / updated_at, never user_id) and deletes
 * nothing, so it's safe to run against production data to sanity-check the
 * candidate query before ever letting a real cleanup pass run.
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !CRON_SECRET) {
    // Deliberately generic — never reveals which var is missing.
    return NextResponse.json({ error: "Stale draft cleanup isn't configured." }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const isDryRun = new URL(request.url).searchParams.get("dryRun") === "1";

  try {
    if (isDryRun) {
      const candidates = await findStaleDraftCandidates(adminClient);
      return NextResponse.json({
        dryRun: true,
        candidates: candidates.map((c) => ({ id: c.id, postType: c.post_type, updatedAt: c.updated_at })),
      });
    }

    const summary = await runStaleDraftCleanup(adminClient);
    return NextResponse.json(summary);
  } catch (err) {
    // Detailed failures go to server logs only — never echoed to the
    // response, which (aside from the CRON_SECRET gate) has no further
    // access control of its own.
    console.error("cleanup-stale-drafts: run failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Cleanup run failed." }, { status: 500 });
  }
}
