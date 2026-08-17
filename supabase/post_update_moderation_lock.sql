-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: moderation visibility bug fix. RLS's SELECT policies (moderation.sql)
-- already correctly hide a moderation_status = 'removed' post/comment from
-- every ordinary user, including its own author — verified live against the
-- production database before writing this file. The gap this closes is
-- narrower and separate: the existing UPDATE policy on posts
-- ("Users can update their own posts", auth_and_ownership.sql) never checked
-- moderation_status at all, so an owner could still successfully UPDATE a
-- post's fields via a direct API request even after an admin removed it (it
-- just wouldn't become visible to anyone but admins as a result — this is a
-- write-permission gap, not the visibility bug itself, but closing it now
-- means removed content truly can't be touched by its author at all).
--
-- comments has no UPDATE policy and no UPDATE grant at all today (confirmed:
-- comments.sql only grants select/insert/delete to authenticated) — there is
-- no edit-comment feature, so there is nothing to harden here. This file
-- intentionally does not add one.
--
-- Recreates the policy via drop + create, in a new file, rather than editing
-- auth_and_ownership.sql in place — the same convention already used twice
-- for "Public can read posts" (reports.sql, then moderation.sql): once a
-- migration has been applied, it's left as a historical record, and later
-- requirements recreate the policy in a new file instead.
--
-- Safely re-runnable in full.

-- ============================================================================
-- 1. posts UPDATE: ownership AND moderation_status = 'active', on both sides
-- ============================================================================
-- `using` governs which EXISTING rows may be targeted at all — evaluated
-- against the row as it currently stands, before any new values are applied.
-- Requiring moderation_status = 'active' here means a removed post can never
-- be matched by an UPDATE statement in the first place, regardless of what
-- the request body contains (including a request that tries to set
-- moderation_status back to 'active' itself — using is checked against the
-- OLD row, so that can't smuggle a removed post back into eligibility).
--
-- `with check` governs the resulting NEW row. Mirroring the same condition
-- there closes the one edge `using` alone wouldn't: an owner updating their
-- own currently-active post can't use that same request to set its own
-- moderation_status away from 'active' either. Ordinary post edits (title,
-- caption, tags, etc. via lib/posts.ts's updatePost) never touch
-- moderation_status at all, so this is invisible to every legitimate edit —
-- it only ever rejects a request that either targets a removed row or tries
-- to change moderation_status itself.
--
-- Admins are unaffected: they have no separate UPDATE bypass policy today
-- (this project's moderation writes all go through the security-definer
-- remove_reported_content/dismiss_report RPCs, not a direct table update),
-- and this change doesn't add or need one for that reason.

drop policy if exists "Users can update their own posts" on public.posts;
create policy "Users can update their own posts"
  on public.posts
  for update
  to authenticated
  using (auth.uid() = user_id and moderation_status = 'active')
  with check (auth.uid() = user_id and moderation_status = 'active');
