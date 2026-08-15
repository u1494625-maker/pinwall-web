-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: Messages Phase 4 — unread direct-message indicators. Adds two
-- read-timestamp columns to conversations (per-conversation unread counts),
-- one new private table (the global "have I opened /messages since new DM
-- activity" signal), and three RPCs. Does not touch messages, its RLS, the
-- touch_conversation_on_message trigger, get_or_create_conversation, or the
-- Realtime publication statement from supabase/messaging.sql — all of that
-- is unchanged and still governs sending/creating/streaming messages.
--
-- Also does not touch, in any way: the notifications table, its RLS, or the
-- Likes/Comments/Follow triggers from supabase/notifications.sql. Direct-
-- message unread state and notification unread state remain two completely
-- separate systems.
--
-- Safely re-runnable in full.

-- ============================================================================
-- 1. conversations: per-participant read timestamps
-- ============================================================================
-- Nullable, no default — NULL means "this participant has never opened this
-- conversation," under which every message from the other side counts as
-- unread (see get_conversations() below). That's the correct, intended
-- meaning for a conversation that's genuinely never been opened by one side.
--
-- It would NOT be correct for conversations that already existed before this
-- migration, though: without a backfill, every existing conversation would
-- suddenly show its entire message history as unread the moment this ships.
-- The backfill below (section 2) sets both columns to the conversation's own
-- last_message_at wherever one already exists, so existing activity starts
-- "already read," and only genuinely new messages sent after this migration
-- ever produce an unread count. A conversation with no messages yet
-- (last_message_at still NULL) is left alone — it has nothing to have read,
-- and the correct all-unread-once-opened behavior for it is unaffected
-- either way.

alter table public.conversations
  add column if not exists user_a_last_read_at timestamptz;

alter table public.conversations
  add column if not exists user_b_last_read_at timestamptz;

-- No new grant/policy for these columns: authenticated has no UPDATE
-- privilege on conversations at all (see messaging.sql), and that stays
-- true here. The only writer is mark_conversation_read() in section 4,
-- which is why it exists as a security definer function instead of a plain
-- client update.

-- ============================================================================
-- 2. One-time backfill for conversations that already have real history
-- ============================================================================
-- Scoped to `last_message_at is not null` on purpose — a conversation with
-- no messages yet has nothing to backfill, and leaving its read columns
-- NULL produces the exact same (zero) unread count as backfilling them
-- would, until it gets a real first message, at which point NULL's
-- all-unread-until-opened meaning is exactly what's wanted for a
-- conversation nobody has looked at yet.

update public.conversations
set
  user_a_last_read_at = last_message_at,
  user_b_last_read_at = last_message_at
where last_message_at is not null
  and user_a_last_read_at is null
  and user_b_last_read_at is null;

-- ============================================================================
-- 3. message_inbox_state — the global "have I opened Messages" signal
-- ============================================================================
-- Deliberately its own table, not a column on profiles: profiles is publicly
-- readable (`select using (true)`, by original design — everyone can see
-- everyone's display name/avatar), and "when did you last check your DMs"
-- shouldn't ride along on that. This table is private to its own owner.
--
-- One row per user, created on first use via the upsert in
-- mark_messages_opened() (section 6) — there's no row for a user who has
-- never opened Messages, which has_new_messages_since_last_open() (section
-- 7) treats the same as "opened at the beginning of time" (coalesce to
-- -infinity), i.e. anything and everything counts as new activity.

create table if not exists public.message_inbox_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_opened_at timestamptz not null default now()
);

alter table public.message_inbox_state enable row level security;

drop policy if exists "Users can read their own inbox state" on public.message_inbox_state;
create policy "Users can read their own inbox state"
  on public.message_inbox_state
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own inbox state" on public.message_inbox_state;
create policy "Users can insert their own inbox state"
  on public.message_inbox_state
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own inbox state" on public.message_inbox_state;
create policy "Users can update their own inbox state"
  on public.message_inbox_state
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on table public.message_inbox_state to authenticated;

-- No other user can read or write this row under any circumstance — every
-- policy above is scoped to auth.uid() = user_id, with no public/anon access
-- at all (unlike profiles).

-- ============================================================================
-- 4. mark_conversation_read — the only way a read timestamp is ever written
-- ============================================================================
-- Takes a conversation id, never a user id — which of the two columns gets
-- touched is decided entirely inside the function from auth.uid(), so a
-- caller can never modify the OTHER participant's timestamp no matter what
-- they pass in. This is deliberately NOT left to RLS: a plain row-level
-- policy can confirm "you're a participant in this row" but has no way to
-- compare which stored column is "yours" versus "theirs" without OLD/NEW
-- access, which plain policies don't have outside a trigger. security
-- definer plus no direct UPDATE grant on these columns closes that off by
-- construction rather than by policy cleverness.

create or replace function public.mark_conversation_read(p_conversation_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update public.conversations
  set
    user_a_last_read_at = case when user_a_id = auth.uid() then now() else user_a_last_read_at end,
    user_b_last_read_at = case when user_b_id = auth.uid() then now() else user_b_last_read_at end
  where id = p_conversation_id
    and (user_a_id = auth.uid() or user_b_id = auth.uid());
$$;

grant execute on function public.mark_conversation_read(bigint) to authenticated;

-- ============================================================================
-- 5. get_conversations — now also returns unread_count
-- ============================================================================
-- Postgres can't CREATE OR REPLACE a function that changes its return
-- columns (same rule already hit by get_post_engagement in comments.sql), so
-- the old signature is dropped first. Everything else — the filter, the
-- ordering, the security-invoker choice — is unchanged from messaging.sql.
--
-- unread_count only ever counts messages from the OTHER participant
-- (sender_user_id <> auth.uid()) created after the caller's own last-read
-- timestamp for this conversation, defaulting to the beginning of time if
-- that's NULL (never opened). The caller's own sent messages can never
-- contribute to their own unread count, by this same condition.

drop function if exists public.get_conversations();

create function public.get_conversations()
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
  order by c.last_message_at desc;
$$;

grant execute on function public.get_conversations() to authenticated;

-- ============================================================================
-- 6. mark_messages_opened — clears the global dot signal only
-- ============================================================================
-- No parameters at all — always auth.uid(), never a client-supplied id.
-- security invoker (the default) is correct: RLS on message_inbox_state
-- already restricts both the insert and the update to the caller's own row,
-- so there's no bypass needed. This never touches conversations or messages
-- — opening /messages does not mark any individual conversation read.

create or replace function public.mark_messages_opened()
returns void
language sql
security invoker
as $$
  insert into public.message_inbox_state (user_id, last_opened_at)
  values (auth.uid(), now())
  on conflict (user_id) do update set last_opened_at = excluded.last_opened_at;
$$;

grant execute on function public.mark_messages_opened() to authenticated;

-- ============================================================================
-- 7. has_new_messages_since_last_open — the global dot's data source
-- ============================================================================
-- security invoker: every row this touches (the caller's own conversations,
-- messages within them, and the caller's own inbox-state row) is already
-- something they could read directly under existing RLS.
--
-- This intentionally has no notion of "except the conversation I'm currently
-- viewing" — that exclusion is a client-side concern (the open conversation
-- id lives in the browser, not the database) and is applied in the frontend
-- realtime handler, not here. This function answers the simpler, broader
-- question "has anything happened since I last opened the Messages tab,"
-- which is also exactly what re-computes correctly on a fresh page load.

create or replace function public.has_new_messages_since_last_open()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
      and m.sender_user_id <> auth.uid()
      and m.created_at > coalesce(
        (select last_opened_at from public.message_inbox_state where user_id = auth.uid()),
        '-infinity'::timestamptz
      )
  );
$$;

grant execute on function public.has_new_messages_since_last_open() to authenticated;
