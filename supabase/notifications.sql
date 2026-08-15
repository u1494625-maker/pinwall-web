-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: Messages/Notifications Phase 1 — a persistent notification/event
-- log for Likes, Comments, and Follows, generated entirely by database
-- triggers on the existing post_likes/comments/follows tables. No client
-- code creates a notification anywhere — see the security note in section 2.
-- Saves never generate a notification: no trigger is attached to post_saves
-- at all, and nothing in this file could make one appear.
--
-- Safely re-runnable in full.

-- ============================================================================
-- 1. notifications
-- ============================================================================
-- Event history, not a live mirror of post_likes/comments/follows — a row
-- here is never deleted or overwritten by an unlike/unfollow. `read_at` is
-- the only mutable column (see the RLS/grants below), so "read" and
-- "deleted" stay genuinely separate concepts.

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('like', 'comment', 'follow')),
  post_id bigint references public.posts(id) on delete cascade,
  comment_id bigint references public.comments(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now(),

  constraint notifications_actor_not_recipient check (actor_user_id <> recipient_user_id),

  -- Each type carries exactly the fields it needs — enforced at the database
  -- level, not just trusted from the trigger code that inserts these rows.
  constraint notifications_shape_matches_type check (
    (type = 'like' and post_id is not null and comment_id is null) or
    (type = 'comment' and post_id is not null and comment_id is not null) or
    (type = 'follow' and post_id is null and comment_id is null)
  )
);

create index if not exists notifications_recipient_unread_idx
  on public.notifications (recipient_user_id, type)
  where read_at is null;

-- ----------------------------------------------------------------------------
-- Historical dedup: at most one Like notification per (recipient, actor,
-- post), and at most one Follow notification per (recipient, actor) — ever,
-- regardless of unlike/re-like or unfollow/re-follow cycles. Comments are
-- deliberately NOT deduped: every real comment is its own event, and
-- comment_id (a real, unique row per comment) already makes each comment
-- notification naturally distinct — a second comment from the same actor on
-- the same post correctly produces a second notification.
-- ----------------------------------------------------------------------------

create unique index if not exists notifications_like_unique_idx
  on public.notifications (recipient_user_id, actor_user_id, post_id)
  where type = 'like';

create unique index if not exists notifications_follow_unique_idx
  on public.notifications (recipient_user_id, actor_user_id)
  where type = 'follow';

-- ============================================================================
-- 2. Row Level Security
-- ============================================================================
-- Recipients can read their own notifications and flip their own read_at —
-- nothing else. There is deliberately NO insert policy and NO insert grant
-- for anon/authenticated: the only path that ever creates a row is the
-- security-definer trigger functions below, which run with elevated
-- privilege and derive both actor_user_id and recipient_user_id from
-- already-validated rows in post_likes/comments/follows (themselves gated by
-- their own "auth.uid() = user_id"-shaped RLS) — never from a client-supplied
-- value. A client cannot insert into this table at all, at any privilege
-- level a normal session has, so it cannot fabricate a notification
-- pretending to be another actor.

alter table public.notifications enable row level security;

drop policy if exists "Users can read their own notifications" on public.notifications;
create policy "Users can read their own notifications"
  on public.notifications
  for select
  to authenticated
  using (auth.uid() = recipient_user_id);

drop policy if exists "Users can mark their own notifications read" on public.notifications;
create policy "Users can mark their own notifications read"
  on public.notifications
  for update
  to authenticated
  using (auth.uid() = recipient_user_id)
  with check (auth.uid() = recipient_user_id);

grant select on table public.notifications to authenticated;

-- Column-level grant: even though the UPDATE policy above allows updating
-- the row, Postgres also checks column privileges independently — scoping
-- this to read_at means a client literally cannot rewrite type/actor_user_id/
-- post_id/recipient_user_id/etc. via a crafted update payload, only ever
-- toggle read_at.
grant update (read_at) on table public.notifications to authenticated;

-- No insert/delete grant to anon/authenticated on this table, on purpose —
-- see the comment above the RLS block.

-- ============================================================================
-- 3. Like notifications
-- ============================================================================
-- actor = post_likes.user_id, recipient = the post's owner. Skipped entirely
-- when the post has no owner (a pre-auth ownerless post) or when the actor
-- IS the post's owner (liking your own post never notifies). The ON CONFLICT
-- target matches notifications_like_unique_idx exactly, so a
-- like -> unlike -> like cycle can never create a second row.

create or replace function public.notify_on_post_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  post_owner uuid;
begin
  select user_id into post_owner from public.posts where id = new.post_id;

  if post_owner is not null and post_owner <> new.user_id then
    insert into public.notifications (recipient_user_id, actor_user_id, type, post_id)
    values (post_owner, new.user_id, 'like', new.post_id)
    on conflict (recipient_user_id, actor_user_id, post_id) where (type = 'like') do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_post_like_notify on public.post_likes;
create trigger on_post_like_notify
  after insert on public.post_likes
  for each row execute function public.notify_on_post_like();

-- ============================================================================
-- 4. Comment notifications
-- ============================================================================
-- actor = comments.user_id, recipient = the post's owner. Skipped when the
-- post has no owner or the commenter IS the owner (commenting on your own
-- post never notifies). No ON CONFLICT — every real comment is its own
-- event; comment_id already guarantees each row is distinct.

create or replace function public.notify_on_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  post_owner uuid;
begin
  select user_id into post_owner from public.posts where id = new.post_id;

  if post_owner is not null and post_owner <> new.user_id then
    insert into public.notifications (recipient_user_id, actor_user_id, type, post_id, comment_id)
    values (post_owner, new.user_id, 'comment', new.post_id, new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists on_comment_notify on public.comments;
create trigger on_comment_notify
  after insert on public.comments
  for each row execute function public.notify_on_comment();

-- ============================================================================
-- 5. Follow notifications
-- ============================================================================
-- actor = follows.follower_user_id, recipient = follows.following_user_id.
-- The self-follow guard is unreachable in practice today (follows already
-- has `check (follower_user_id <> following_user_id)`) but kept here as
-- defense in depth rather than relying solely on that other table's
-- constraint. ON CONFLICT matches notifications_follow_unique_idx — a
-- follow -> unfollow -> re-follow cycle never creates a second historical row.

create or replace function public.notify_on_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.follower_user_id <> new.following_user_id then
    insert into public.notifications (recipient_user_id, actor_user_id, type)
    values (new.following_user_id, new.follower_user_id, 'follow')
    on conflict (recipient_user_id, actor_user_id) where (type = 'follow') do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_follow_notify on public.follows;
create trigger on_follow_notify
  after insert on public.follows
  for each row execute function public.notify_on_follow();

-- ============================================================================
-- 6. get_unread_notification_counts — one round trip for the Messages badges
-- ============================================================================
-- security invoker (the default) is correct here, unlike get_profile_stats:
-- every row counted already belongs to auth.uid() under the SELECT policy
-- above, so there's no cross-user RLS gap to bypass.

create or replace function public.get_unread_notification_counts()
returns table (like_count bigint, follow_count bigint, comment_count bigint)
language sql
stable
as $$
  select
    (select count(*) from public.notifications where recipient_user_id = auth.uid() and type = 'like' and read_at is null),
    (select count(*) from public.notifications where recipient_user_id = auth.uid() and type = 'follow' and read_at is null),
    (select count(*) from public.notifications where recipient_user_id = auth.uid() and type = 'comment' and read_at is null);
$$;

grant execute on function public.get_unread_notification_counts() to authenticated;
