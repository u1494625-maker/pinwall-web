-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready — AFTER supabase/post_drafts.sql. Written to be
-- safely re-runnable.
--
-- Phase 6: stale-draft garbage collection. This adds exactly one column and
-- redefines one existing trigger function — no new table, no RPC, no
-- redesign of the draft schema.
--
-- Why a claim column, not just a plain re-check: the cleanup worker (see
-- app/api/cron/cleanup-stale-drafts) runs once daily and must, for one
-- candidate draft: (1) observe it's stale, (2) sweep its Storage prefix in
-- both buckets, (3) delete the post_drafts row. A plain "SELECT, then later
-- check updated_at hasn't changed before deleting" is NOT enough on its
-- own: the check-then-act gap between observing "still stale" and actually
-- finishing the Storage sweep is not atomic, so a user resuming a
-- 3-day-abandoned draft at the exact moment a daily run reaches it could
-- have a brand-new upload swept away before any re-check ever runs.
--
-- cleanup_claimed_at closes this the same way any claim/lease pattern does:
-- claiming a draft is one atomic `update ... where updated_at = <the
-- observed value> ... returning id` — if the row's updated_at has moved
-- (the user touched it since it was read as a candidate), zero rows match
-- and the claim fails, and Storage is never touched for that draft at all.
-- Only a successful, atomic claim may proceed to Storage/DB deletion. This
-- is also what makes two overlapping invocations (a manual test run
-- overlapping the scheduled one) safe: only one can ever win the claim for
-- a given draft.
--
-- Nullable, no default: null means "not currently claimed by any cleanup
-- attempt." A worker that crashes mid-cleanup (with no chance to reset this
-- back to null) would otherwise leave a draft permanently unrecoverable —
-- the cleanup worker's own candidate query treats a claim older than 10
-- minutes as dead and eligible for a fresh attempt (10 minutes is far
-- longer than sweeping a handful of small objects should ever take).
--
-- Deliberately does NOT interact with the 3-day TTL's own meaning:
-- claiming/unclaiming a draft never touches updated_at, so it can never
-- rescue a stale draft from eligibility or influence when it next becomes
-- eligible again after a failed attempt.
--
-- A second race, closed below: a successful claim only proves the draft was
-- stale AT THE MOMENT OF CLAIMING — it says nothing about the window
-- between claiming and the Storage sweep actually finishing, which for a
-- draft with several photos is not instantaneous. Closing this requires
-- meaningful draft activity to be OBSERVABLE from the claim's own point of
-- view, not just from updated_at's: every meaningful mutation must also
-- clear cleanup_claimed_at back to null the instant it happens, so the
-- cleanup worker's own pre-Storage-deletion re-read (see
-- lib/server/draftCleanup.ts's cleanupStaleDraft) can tell "my claim is
-- still valid" apart from "the user just came back" by checking BOTH
-- updated_at and cleanup_claimed_at still equal exactly what it observed/
-- set — not by inventing a second, separate token column. cleanup_claimed_at
-- itself (a timestamptz set via now(), microsecond precision, always
-- moving forward, claimed at most ~100 times a day by a single daily cron)
-- is not ambiguous as that identity check: two distinct claim events on
-- this table cannot realistically produce the same stored value, so a
-- dedicated random token would add state without closing a real gap.
--
-- draft_media's own insert/update/delete already routes through
-- touch_draft_updated_at (below) for every meaningful media mutation
-- (upload, location change, reorder, removal) — redefining it here to also
-- clear the claim covers all of those in one place. The two direct
-- post_drafts field-update paths (lib/postDrafts.ts's
-- updateMediaDraftFields/updateTextDraftFields) do the same thing
-- explicitly in their own UPDATE payload, since they never touch
-- draft_media at all.

alter table public.post_drafts
  add column if not exists cleanup_claimed_at timestamptz;

-- Keeps the daily candidate query (filters + sorts by updated_at) cheap as
-- this table grows — not required for correctness at today's scale, but
-- there is no reason not to have it.
create index if not exists post_drafts_updated_at_idx on public.post_drafts (updated_at);

-- No RLS/grant change: only ever written by the service-role cleanup
-- worker, which bypasses RLS entirely — this column is never read or
-- written by any client-facing code path.

-- Same signature/return type as post_drafts.sql's version — safe
-- create-or-replace. Only change: also clears cleanup_claimed_at, so any
-- draft_media mutation counts as "the user came back" from the cleanup
-- worker's point of view, exactly like a direct post_drafts field edit
-- already does via updateMediaDraftFields/updateTextDraftFields.
create or replace function public.touch_draft_updated_at()
returns trigger
language plpgsql
as $$
begin
  update public.post_drafts
     set updated_at = now(), cleanup_claimed_at = null
   where id = coalesce(new.draft_id, old.draft_id);
  return coalesce(new, old);
end;
$$;
