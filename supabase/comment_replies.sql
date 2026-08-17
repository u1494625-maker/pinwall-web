-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: Phase 5D — one-level comment replies. Adds two nullable columns to
-- the existing comments table (no new table — a reply is just a comments row
-- with parent_comment_id set), closes the direct-insert surface in favor of
-- a single add_comment RPC that is now the only way ANY comment (top-level
-- or reply) is ever created, extends the comments SELECT policy so a reply
-- disappears whenever its root does (for everyone on moderation removal, and
-- per-viewer on that viewer's own report of the root), and extends the
-- existing comment-notification trigger to also notify whoever is being
-- replied to, with duplicate-prevention when that's the same person the
-- post-owner notification already reached.
--
-- Does not touch: reports.sql, moderation.sql's RPCs (remove_reported_content,
-- dismiss_report, get_pending_reports_for_admin, has_pending_comment_report,
-- is_current_user_admin), system_messages.sql, get_post_engagement. All of
-- those already work correctly for replies with zero changes — see the
-- approved plan for why.
--
-- Safely re-runnable in full.

-- ============================================================================
-- 1. comments: parent_comment_id / reply_to_user_id
-- ============================================================================
-- parent_comment_id is the sole "is this row a reply" signal — never
-- reply_to_user_id, which can legitimately become NULL later (see below)
-- while the row is still structurally a reply.
--
-- on delete cascade: deleting a top-level comment (parent_comment_id is null
-- for the row being deleted) removes every reply under it in the same
-- transaction — nothing else references a reply's own id as a parent (see
-- add_comment's flattening logic in section 5), so deleting a reply only
-- ever removes that one row.
--
-- reply_to_user_id on delete set null (not cascade): a reply is content its
-- own author owns. If the person they replied to later deletes their
-- account, the reply itself must survive — it just loses the "-> Name"
-- attribution. This mirrors posts.user_id's existing on delete set null
-- reasoning (content survives, attribution degrades), not comments.user_id's
-- on delete cascade (that FK is about the row's OWN author, a different
-- relationship entirely).

alter table public.comments
  add column if not exists parent_comment_id bigint references public.comments(id) on delete cascade;

alter table public.comments
  add column if not exists reply_to_user_id uuid references auth.users(id) on delete set null;

-- One-directional on purpose: reply_to_user_id is null on EVERY existing row
-- today (satisfies this trivially) AND must remain allowed to go null later
-- via the FK's own on delete set null action above. A "both null or both
-- set" constraint would reject that exact cascade update and make deleting a
-- user's account fail the moment anyone had ever replied to them. This only
-- forbids the nonsensical opposite case: a reply_to_user_id on a row that
-- isn't structurally a reply at all.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'comments_reply_to_requires_parent'
      and conrelid = 'public.comments'::regclass
  ) then
    alter table public.comments
      add constraint comments_reply_to_requires_parent
      check (reply_to_user_id is null or parent_comment_id is not null);
  end if;
end;
$$;

create index if not exists comments_parent_comment_id_idx on public.comments (parent_comment_id);

-- ============================================================================
-- 2. Close the direct-insert surface
-- ============================================================================
-- add_comment (section 5) becomes the only way any comment — top-level or
-- reply — is ever created. Matches reports.sql's report_post/report_comment
-- pattern exactly: no INSERT policy, no INSERT grant, RPC-only.

drop policy if exists "Users can comment as themselves" on public.comments;
revoke insert on table public.comments from authenticated;

-- select/delete grants (comments.sql) are untouched — this only removes the
-- insert privilege.

-- ============================================================================
-- 3. is_comment_reply_root_visible — the only new thing the SELECT policy
--    is allowed to touch for reply visibility
-- ============================================================================
-- Mirrors has_pending_post_report/has_pending_comment_report exactly:
-- security definer (so its internal read of comments bypasses RLS the same
-- way those functions already bypass RLS to read reports — this is a direct
-- privileged lookup, not a recursive re-entry into the policy being
-- evaluated), narrow, returns a single boolean, stable. No explicit
-- auth.uid() guard is needed here: has_pending_comment_report already
-- returns false for an anon caller internally, so an anon viewer's result
-- correctly depends on root_status alone.
--
-- Doing double duty on purpose: checking the root's moderation_status here
-- covers "hide every reply once an admin removes the root, even though the
-- replies' own moderation_status stays 'active'" (nothing about a reply's
-- own row is ever touched on root removal — this is the entire mechanism).
-- Checking has_pending_comment_report(root) here also covers "if I
-- personally reported the root, its replies disappear for me too" — a
-- per-viewer effect, correctly scoped since has_pending_comment_report is
-- itself per-viewer (auth.uid()-based).

create or replace function public.is_comment_reply_root_visible(p_parent_comment_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  root_status text;
begin
  select moderation_status into root_status
  from public.comments
  where id = p_parent_comment_id;

  if not found then
    return false;
  end if;

  return root_status = 'active' and not public.has_pending_comment_report(p_parent_comment_id);
end;
$$;

revoke execute on function public.is_comment_reply_root_visible(bigint) from public;
grant execute on function public.is_comment_reply_root_visible(bigint) to anon, authenticated;

-- ============================================================================
-- 4. Reporter-only + soft-removal hiding: comments, now reply-aware
-- ============================================================================
-- Recreates the existing policy (moderation.sql) with one added clause. A
-- top-level comment (parent_comment_id is null) is unaffected by the new
-- clause. A reply is additionally gated on its root still being visible —
-- see section 3 for exactly what that means.

drop policy if exists "Public can read comments" on public.comments;
create policy "Public can read comments"
  on public.comments
  for select
  to anon, authenticated
  using (
    moderation_status = 'active'
    and not public.has_pending_comment_report(comments.id)
    and (
      parent_comment_id is null
      or public.is_comment_reply_root_visible(parent_comment_id)
    )
  );

-- ============================================================================
-- 5. add_comment — the only way a comment (top-level or reply) is created
-- ============================================================================
-- security definer is required: authenticated has no INSERT grant on
-- comments at all as of section 2. Identity is derived exclusively from
-- auth.uid() — there is no user_id parameter anywhere in this function's
-- signature, so it cannot be forged.
--
-- p_reply_to_comment_id null => plain top-level comment, identical to the
-- pre-Phase-5D behavior (parent_comment_id/reply_to_user_id both null).
--
-- p_reply_to_comment_id set => the target row is looked up by id AND
-- post_id AND moderation_status = 'active' in one query — a single `not
-- found` therefore uniformly covers three distinct problems (nonexistent
-- id, a real comment belonging to a DIFFERENT post, or a removed comment)
-- without a separate branch that would leak which one it was. This is what
-- makes "reply pointing at another post's comment" and "reply under a
-- removed comment" both impossible.
--
-- root_id := coalesce(target.parent_comment_id, target.id) is the one-level
-- flatten: if the target itself has a parent, that parent is ALREADY
-- guaranteed to be a genuine top-level comment, because this function is the
-- only writer and always performs this same flattening on every insert —
-- by induction, no reply's own parent_comment_id can ever itself be a reply.
-- reply_to_user_id is always target.user_id — the actual author of whatever
-- row was tapped, never a client-supplied value.
--
-- When the target itself was a reply (target.parent_comment_id is not
-- null), root_id points at a DIFFERENT row than target, so target's own
-- already-confirmed active status says nothing about the root's current
-- status — it is re-checked independently. When the target was already
-- top-level, root_id = target.id and this second check would be redundant
-- with the first query, so it's skipped.
--
-- p_body is trimmed exactly once (trimmed_body := btrim(p_body)); that same
-- trimmed value is both validated and the one actually stored, so what's
-- persisted can never silently differ from what passed validation.

create or replace function public.add_comment(
  p_post_id bigint,
  p_body text,
  p_reply_to_comment_id bigint default null
)
returns public.comments
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  post_status text;
  target public.comments%rowtype;
  root_id bigint;
  target_reply_to_user_id uuid;
  trimmed_body text;
  new_row public.comments%rowtype;
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;

  select moderation_status into post_status from public.posts where id = p_post_id;
  if not found or post_status <> 'active' then
    raise exception 'Post not found';
  end if;

  if p_reply_to_comment_id is null then
    root_id := null;
    target_reply_to_user_id := null;
  else
    select *
    into target
    from public.comments
    where id = p_reply_to_comment_id
      and post_id = p_post_id
      and moderation_status = 'active';

    if not found then
      raise exception 'Comment not found';
    end if;

    root_id := coalesce(target.parent_comment_id, target.id);
    target_reply_to_user_id := target.user_id;

    if target.parent_comment_id is not null then
      perform 1 from public.comments where id = root_id and moderation_status = 'active';
      if not found then
        raise exception 'Comment not found';
      end if;
    end if;
  end if;

  trimmed_body := btrim(p_body);
  if trimmed_body is null or char_length(trimmed_body) not between 1 and 2000 then
    raise exception 'Comment must be between 1 and 2000 characters';
  end if;

  insert into public.comments (post_id, user_id, body, parent_comment_id, reply_to_user_id)
  values (p_post_id, me, trimmed_body, root_id, target_reply_to_user_id)
  returning * into new_row;

  return new_row;
end;
$$;

revoke execute on function public.add_comment(bigint, text, bigint) from public;
grant execute on function public.add_comment(bigint, text, bigint) to authenticated;

-- ============================================================================
-- 6. notify_on_comment — extended to also notify whoever is being replied to
-- ============================================================================
-- Same trigger binding as notifications.sql (on_comment_notify, after insert
-- on comments) — only the function body changes via create or replace, the
-- trigger itself doesn't need to be re-created.
--
-- The existing post-owner notification is completely unchanged: it fires
-- exactly as before for every insert (top-level or reply alike), since
-- nothing about it depends on the new columns.
--
-- The new block only fires for a reply (reply_to_user_id is not null),
-- never notifies the replier about their own reply, and is skipped when the
-- replied-to person is the same person the post-owner block already
-- notified in this same trigger invocation — the one-notification-per-
-- action guarantee for the case where the post owner replies to a comment
-- on their own post, or someone replies directly to the post owner's own
-- comment.

create or replace function public.notify_on_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  post_owner uuid;
  post_owner_notified boolean := false;
begin
  select user_id into post_owner from public.posts where id = new.post_id;

  if post_owner is not null and post_owner <> new.user_id then
    insert into public.notifications (recipient_user_id, actor_user_id, type, post_id, comment_id)
    values (post_owner, new.user_id, 'comment', new.post_id, new.id);
    post_owner_notified := true;
  end if;

  if new.reply_to_user_id is not null
     and new.reply_to_user_id <> new.user_id
     and not (post_owner_notified and new.reply_to_user_id = post_owner)
  then
    insert into public.notifications (recipient_user_id, actor_user_id, type, post_id, comment_id)
    values (new.reply_to_user_id, new.user_id, 'comment', new.post_id, new.id);
  end if;

  return new;
end;
$$;
