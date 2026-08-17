-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: Phase 5E, part 1 — reply-vs-comment notification wording, and
-- enabling Realtime on notifications (needed for Phase 5E's BottomNav dot
-- work — see lib/notifications.ts's new subscribeToIncomingNotifications,
-- part 2 of this phase, implemented entirely client-side otherwise).
--
-- Does not touch: reports.sql, moderation.sql, system_messages.sql,
-- comment_replies.sql's add_comment (comment/reply creation behavior is
-- unchanged — this only affects what gets written to notifications
-- alongside an already-happening comment insert).
--
-- Safely re-runnable in full.

-- ============================================================================
-- 1. notifications.is_reply
-- ============================================================================
-- Computed once, at insert time, per recipient row — deliberately not
-- derived client-side from the underlying comment, which can become
-- invisible later (moderation removal, root removal, reply_to_user_id going
-- null on account deletion) without this notification row itself changing.
-- Every existing row (all pre-Phase-5D, necessarily top-level comments) is
-- correctly `false` via the column default — no backfill needed.

alter table public.notifications
  add column if not exists is_reply boolean not null default false;

-- ============================================================================
-- 2. notify_on_comment — now stamps is_reply per recipient
-- ============================================================================
-- Same trigger binding as before (on_comment_notify on comments, after
-- insert) — only the function body changes.
--
-- is_reply answers "is THIS RECIPIENT specifically the person being replied
-- to", not "is the underlying comment structurally a reply" — those two
-- questions differ in exactly one case, and getting this right is the whole
-- point of computing it per-insert rather than once per comment:
--
--   - Someone replies to someone ELSE's comment on my post: my (post-owner)
--     notification should still read as ordinary post activity ("commented
--     on your post") — reply_to_user_id <> post_owner, so coalesce(...)
--     correctly yields false for my row.
--   - The existing dedup case (I own the post AND I'm the one being
--     replied to): only the post-owner insert survives, and
--     reply_to_user_id = post_owner here, so it correctly yields true —
--     the more specific, more accurate wording ("commented on your reply")
--     for exactly the row that actually gets created.
--   - The reply-target insert (second block) is unconditionally true — it
--     only ever fires because someone replied to this exact recipient.

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
    insert into public.notifications (recipient_user_id, actor_user_id, type, post_id, comment_id, is_reply)
    values (post_owner, new.user_id, 'comment', new.post_id, new.id, coalesce(new.reply_to_user_id = post_owner, false));
    post_owner_notified := true;
  end if;

  if new.reply_to_user_id is not null
     and new.reply_to_user_id <> new.user_id
     and not (post_owner_notified and new.reply_to_user_id = post_owner)
  then
    insert into public.notifications (recipient_user_id, actor_user_id, type, post_id, comment_id, is_reply)
    values (new.reply_to_user_id, new.user_id, 'comment', new.post_id, new.id, true);
  end if;

  return new;
end;
$$;

-- ============================================================================
-- 3. Realtime: broadcast new notifications
-- ============================================================================
-- Lets BottomNav's single notifications subscription (lib/notifications.ts)
-- light the dot immediately on a new Like/Follow/Comment while the app is
-- already open, instead of only reflecting it on next mount. RLS ("Users can
-- read their own notifications", notifications.sql) already scopes this
-- correctly per recipient — Realtime enforces the same RLS as REST for
-- authenticated clients, so this doesn't widen access, exactly the same
-- reasoning already applied to messages/system_messages.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
