-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: user-to-user blocking, with mutual consequences from a one-sided
-- relationship. If either A blocks B or B blocks A: neither sees the
-- other's posts/comments, neither can start a new DM or send a new message
-- in an existing one, a blocked conversation drops out of both inboxes,
-- neither can follow the other, neither can Helpful/like the other's
-- posts, and neither can comment/reply on the other's content. Reports/
-- moderation stay completely independent -- nothing here touches
-- reports.sql/moderation.sql/moderation_history.sql.
--
-- One centralized predicate (is_blocked_pair, section 2) is referenced from
-- every policy/RPC below rather than duplicating the block-lookup query in
-- each place -- same pattern this project already uses for
-- has_pending_post_report/has_pending_comment_report (reports.sql).
--
-- IMPORTANT, and the main reason this touches more than just the posts/
-- comments SELECT policies: add_comment and get_or_create_conversation are
-- `security definer` functions, which run with the function owner's
-- privileges and do NOT go through RLS for their own internal queries.
-- Hiding a blocked user's posts via the posts SELECT policy alone would
-- NOT stop add_comment from still successfully inserting a comment on that
-- post, since add_comment's own `select ... from public.posts` bypasses
-- that policy entirely. Every security-definer RPC that can create a
-- cross-user interaction (add_comment, get_or_create_conversation) gets an
-- explicit is_blocked_pair check of its own; plain RLS-governed inserts
-- (post_likes, follows, messages) get it added to their existing policy
-- instead, since those genuinely do go through RLS as the calling user.
--
-- Deliberately does NOT touch post_saves: saving is a private, personal
-- bookmark that never notifies or is visible to the post's author, so it
-- isn't a "content interaction" in the sense blocking is meant to prevent
-- (matching the specific, deliberately-scoped list this was approved
-- against: follow, Helpful/like, comment/reply, DM -- not saves).
--
-- Also deliberately does NOT touch the `profiles` table's own SELECT
-- policy or get_profile_stats: a blocked user's profile (name/avatar/bio)
-- stays visible so the UI can show a graceful "you can't interact with
-- this account" state instead of a broken/missing profile page -- only
-- their POSTS and COMMENTS are hidden, and only their ability to newly
-- interact (follow/like/comment/message) is blocked.
--
-- Safely re-runnable in full.

-- ============================================================================
-- 1. blocked_users
-- ============================================================================
-- Same shape as follows (interactions.sql): composite primary key makes a
-- duplicate block impossible at the database level, the check constraint
-- makes self-blocking impossible at the database level. Directional in
-- storage (only the blocker's own action; the blocked party never gets a
-- symmetric row of their own) -- the mutual VISIBILITY consequence lives
-- entirely in is_blocked_pair below, not in how this table is populated.

create table if not exists public.blocked_users (
  blocker_user_id uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id),
  constraint blocked_users_no_self_block check (blocker_user_id <> blocked_user_id)
);

create index if not exists blocked_users_blocked_user_id_idx on public.blocked_users (blocked_user_id);

alter table public.blocked_users enable row level security;

-- Both participants can see a block involving themselves -- not just the
-- blocker -- so the blocked party's own client can also know to hide
-- Follow/Message controls for that specific person (the real enforcement
-- is still server-side regardless; this is what lets the UI be honest
-- about it up front rather than only failing after a click).
drop policy if exists "Users can read blocks involving themselves" on public.blocked_users;
create policy "Users can read blocks involving themselves"
  on public.blocked_users
  for select
  to authenticated
  using (auth.uid() = blocker_user_id or auth.uid() = blocked_user_id);

drop policy if exists "Users can block as themselves" on public.blocked_users;
create policy "Users can block as themselves"
  on public.blocked_users
  for insert
  to authenticated
  with check (auth.uid() = blocker_user_id);

drop policy if exists "Users can unblock their own blocks" on public.blocked_users;
create policy "Users can unblock their own blocks"
  on public.blocked_users
  for delete
  to authenticated
  using (auth.uid() = blocker_user_id);

grant select, insert, delete on table public.blocked_users to authenticated;
-- No anon grant at all: a signed-out visitor can neither block anyone nor
-- has any block relationships of their own to read, matching follows'
-- identical no-anon-access precedent.

-- ============================================================================
-- 2. is_blocked_pair — the one, single, reusable predicate every policy/RPC
--    below references, so this logic is never duplicated per table.
-- ============================================================================
-- Single-arg, checked against auth.uid() implicitly -- same calling
-- convention as has_pending_post_report/has_pending_comment_report.
-- Symmetric by design: true if EITHER direction of a block exists between
-- the caller and other_user_id, regardless of who blocked whom -- this is
-- what makes a one-sided stored relationship produce mutual consequences.

create or replace function public.is_blocked_pair(other_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if auth.uid() is null or other_user_id is null then
    return false;
  end if;

  return exists (
    select 1 from public.blocked_users b
    where (b.blocker_user_id = auth.uid() and b.blocked_user_id = other_user_id)
       or (b.blocker_user_id = other_user_id and b.blocked_user_id = auth.uid())
  );
end;
$$;

grant execute on function public.is_blocked_pair(uuid) to authenticated;
-- Not granted to anon: auth.uid() is always null for a signed-out caller,
-- so this always returns false for them regardless -- nothing in this file
-- ever calls it for the anon role.

-- ============================================================================
-- 3. posts: hide a blocked pair's posts from each other
-- ============================================================================
-- Recreates the current "Public can read posts" policy (moderation.sql)
-- verbatim, adding exactly one more clause. Every existing condition
-- (moderation_status, pending-report hiding) is unchanged; anon visitors
-- are unaffected (is_blocked_pair always returns false for them, since
-- auth.uid() is null).

drop policy if exists "Public can read posts" on public.posts;
create policy "Public can read posts"
  on public.posts
  for select
  to anon, authenticated
  using (
    moderation_status = 'active'
    and not public.has_pending_post_report(posts.id)
    and not public.is_blocked_pair(posts.user_id)
  );

-- ============================================================================
-- 4. comments: hide a blocked pair's comments from each other
-- ============================================================================
-- Recreates the current "Public can read comments" policy
-- (comment_replies.sql) verbatim, adding exactly one more clause. Every
-- existing condition (moderation_status, pending-report hiding,
-- reply-root-visibility) is unchanged.

drop policy if exists "Public can read comments" on public.comments;
create policy "Public can read comments"
  on public.comments
  for select
  to anon, authenticated
  using (
    moderation_status = 'active'
    and not public.has_pending_comment_report(comments.id)
    and not public.is_blocked_pair(comments.user_id)
    and (
      parent_comment_id is null
      or public.is_comment_reply_root_visible(parent_comment_id)
    )
  );

-- ============================================================================
-- 5. post_likes: cannot Helpful/like a blocked pair's posts
-- ============================================================================
-- post_owner_id: a small, narrow security-definer lookup, not a general
-- bypass. Needed specifically because the "Users can like posts as
-- themselves" policy below must resolve a post's owner to run its own
-- block check -- and a PLAIN select from public.posts here would itself be
-- subject to section 3's own RLS change (hiding a blocked pair's posts),
-- which would make the block check see NULL for exactly the post it's
-- supposed to be catching, and NULL fails is_blocked_pair's own null-guard
-- open (returns false) rather than closed. Confirmed by direct testing,
-- not just reasoning: without this helper, the very act of blocking
-- someone made post_likes's own check silently stop working the moment it
-- was needed. add_comment/get_or_create_conversation don't have this
-- problem (already security definer, bypass RLS internally); messages'
-- subquery into conversations doesn't either (conversations' own RLS was
-- never changed to hide anything based on blocking).
create or replace function public.post_owner_id(p_post_id bigint)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select user_id from public.posts where id = p_post_id;
$$;

grant execute on function public.post_owner_id(bigint) to authenticated;

-- Recreates the current insert policy (interactions.sql) verbatim, adding
-- one clause.
drop policy if exists "Users can like posts as themselves" on public.post_likes;
create policy "Users can like posts as themselves"
  on public.post_likes
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and not public.is_blocked_pair(public.post_owner_id(post_likes.post_id))
  );

-- ============================================================================
-- 6. follows: cannot follow a blocked pair
-- ============================================================================
-- Recreates the current insert policy (interactions.sql) verbatim, adding
-- one clause.

drop policy if exists "Users can follow as themselves" on public.follows;
create policy "Users can follow as themselves"
  on public.follows
  for insert
  to authenticated
  with check (
    auth.uid() = follower_user_id
    and not public.is_blocked_pair(following_user_id)
  );

-- ============================================================================
-- 7. add_comment: cannot comment on a blocked pair's post, or reply to
--    their comment
-- ============================================================================
-- Recreates add_comment (comment_replies.sql) in full -- see this file's
-- own top comment for why a security-definer RPC needs its own explicit
-- check rather than relying on the posts/comments SELECT policies above.
-- Two checks: the post's own author (covers commenting directly on a
-- blocked user's post) and, when replying, the specific comment's author
-- (covers replying to a blocked user's comment on someone else's post,
-- which the post-author check alone wouldn't catch). Every other line is
-- unchanged from the current version.

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
  post_author uuid;
  target public.comments%rowtype;
  root_id bigint;
  target_reply_to_user_id uuid;
  trimmed_body text;
  new_row public.comments%rowtype;
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;

  select moderation_status, user_id into post_status, post_author from public.posts where id = p_post_id;
  if not found or post_status <> 'active' then
    raise exception 'Post not found';
  end if;

  if public.is_blocked_pair(post_author) then
    raise exception 'Cannot comment on this post';
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

    if public.is_blocked_pair(target.user_id) then
      raise exception 'Cannot reply to this comment';
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

-- ============================================================================
-- 8. get_or_create_conversation: cannot start a new DM with a blocked pair
-- ============================================================================
-- Recreates the current version (messaging.sql) in full, adding one check
-- alongside the existing self-message/user-existence checks. Same
-- security-definer-bypasses-RLS reasoning as add_comment above.

create or replace function public.get_or_create_conversation(other_user_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  lo uuid;
  hi uuid;
  conv_id bigint;
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;

  if other_user_id is null then
    raise exception 'User not found';
  end if;

  if me = other_user_id then
    raise exception 'Cannot start a conversation with yourself';
  end if;

  if not exists (select 1 from auth.users u where u.id = other_user_id) then
    raise exception 'User not found';
  end if;

  if public.is_blocked_pair(other_user_id) then
    raise exception 'Cannot message this user';
  end if;

  lo := least(me, other_user_id);
  hi := greatest(me, other_user_id);

  insert into public.conversations (user_a_id, user_b_id)
  values (lo, hi)
  on conflict (user_a_id, user_b_id) do nothing;

  select id into conv_id
  from public.conversations
  where user_a_id = lo and user_b_id = hi;

  return conv_id;
end;
$$;

-- ============================================================================
-- 9. get_conversations: a blocked pair's conversation drops out of BOTH
--    inboxes
-- ============================================================================
-- Recreates the current version (messaging_unread.sql) in full, adding one
-- clause to the WHERE. Existing message history is untouched by this --
-- only whether the conversation appears in the inbox LIST changes; opening
-- it directly (getMessages, unchanged) still shows past messages for both
-- participants.

create or replace function public.get_conversations()
returns table (
  id bigint,
  other_user_id uuid,
  last_message_at timestamptz,
  last_message_body text,
  created_at timestamptz,
  unread_count bigint
)
language sql
stable
as $$
  select
    c.id,
    case when c.user_a_id = auth.uid() then c.user_b_id else c.user_a_id end as other_user_id,
    c.last_message_at,
    c.last_message_body,
    c.created_at,
    (
      select count(*)
      from public.messages m
      where m.conversation_id = c.id
        and m.sender_user_id <> auth.uid()
        and m.created_at > coalesce(
          case when c.user_a_id = auth.uid() then c.user_a_last_read_at else c.user_b_last_read_at end,
          '-infinity'::timestamptz
        )
    ) as unread_count
  from public.conversations c
  where (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    and c.last_message_at is not null
    and not public.is_blocked_pair(case when c.user_a_id = auth.uid() then c.user_b_id else c.user_a_id end)
  order by c.last_message_at desc;
$$;

-- ============================================================================
-- 10. messages: cannot send a NEW message to a blocked pair, even in an
--     already-existing conversation
-- ============================================================================
-- Recreates the current insert policy (messaging.sql) verbatim, adding one
-- clause. This is a plain RLS-governed insert (unlike add_comment/
-- get_or_create_conversation, sendMessage in lib/messages.ts does a direct
-- table insert), so extending the policy itself is sufficient here -- no
-- RPC needed. Deliberately checked against the conversation's OTHER
-- participant, not against conversation_id itself, so this also covers a
-- conversation that already existed before either side blocked the other.

drop policy if exists "Participants can send messages as themselves" on public.messages;
create policy "Participants can send messages as themselves"
  on public.messages
  for insert
  to authenticated
  with check (
    sender_user_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
    and not public.is_blocked_pair(
      (
        select case when c.user_a_id = auth.uid() then c.user_b_id else c.user_a_id end
        from public.conversations c
        where c.id = conversation_id
      )
    )
  );
