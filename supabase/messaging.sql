-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: Messages Phase 3 — real 1-to-1 direct messaging. Two tables only.
-- Deliberately no read/unread state anywhere in this file (no per-participant
-- last-read column, no mark-read RPC, no unread-count RPC) — a message here
-- only ever records that it exists and who sent it, nothing about whether the
-- recipient has seen it. This is unrelated to, and does not touch, the
-- separate Phase 1/2 `notifications` table or its own read/unread state.
--
-- Safely re-runnable in full — including the Realtime publication change in
-- section 6, which checks membership first rather than assuming a plain
-- ADD TABLE will no-op on its own (it won't; see that section).

-- ============================================================================
-- 1. conversations
-- ============================================================================
-- Exactly one row per unordered pair of users. `user_a_id < user_b_id` is a
-- canonical-ordering trick (not a meaningful "who's who" distinction) that
-- turns "same conversation regardless of who messages whom first" into a
-- plain unique index — A messaging B and B messaging A both resolve to
-- (least(A,B), greatest(A,B)), so there is structurally no way for two rows
-- to ever represent the same pair.
--
-- last_message_at/last_message_body are a deliberate, narrow denormalization
-- — purely so the conversation list can be fetched and ordered in one query
-- (see get_conversations below) without a per-conversation "latest message"
-- lookup. They are kept in sync by the trigger in section 5, never written
-- directly by a client.
--
-- last_message_at starts NULL (no default) rather than "now" at creation —
-- an empty, just-created conversation (Profile -> Message, before either
-- side has said anything) has no message yet, so it has no "latest message
-- time" yet either. get_conversations() below only returns rows where this
-- is non-null, so a brand-new empty conversation never appears in the list;
-- it starts appearing the moment the trigger in section 5 populates this
-- column from the first real message.

create table if not exists public.conversations (
  id bigint generated always as identity primary key,
  user_a_id uuid not null references auth.users(id) on delete cascade,
  user_b_id uuid not null references auth.users(id) on delete cascade,
  last_message_at timestamptz,
  last_message_body text,
  created_at timestamptz not null default now(),

  constraint conversations_distinct_users check (user_a_id <> user_b_id),
  constraint conversations_canonical_order check (user_a_id < user_b_id)
);

create unique index if not exists conversations_pair_unique_idx
  on public.conversations (user_a_id, user_b_id);

-- user_a_id is already the leftmost column of the unique index above, so it's
-- covered for lookups; user_b_id needs its own index for the reverse side
-- (both the RLS policies below and get_conversations() query by either
-- column depending on which side the caller is on).
create index if not exists conversations_user_b_id_idx on public.conversations (user_b_id);

alter table public.conversations enable row level security;

drop policy if exists "Participants can read their own conversations" on public.conversations;
create policy "Participants can read their own conversations"
  on public.conversations
  for select
  to authenticated
  using (auth.uid() = user_a_id or auth.uid() = user_b_id);

grant select on table public.conversations to authenticated;

-- No insert/update/delete policy or grant for anon/authenticated, on purpose:
-- the only writer is the security-definer RPC below (rows are created
-- exactly once, never edited by a client) and the security-definer trigger
-- in section 5 (last_message_at/last_message_body). A client cannot create,
-- rename, or reassign a conversation via a direct table call.

-- ============================================================================
-- 2. messages
-- ============================================================================
-- No update/delete policy anywhere in this file — Phase 3 has no edit,
-- delete, or unsend. char_length cap matches the existing comments.body
-- limit (supabase/comments.sql) rather than inventing a new number.

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  conversation_id bigint not null references public.conversations(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_id_created_at_idx
  on public.messages (conversation_id, created_at);

alter table public.messages enable row level security;

drop policy if exists "Participants can read messages in their conversations" on public.messages;
create policy "Participants can read messages in their conversations"
  on public.messages
  for select
  to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );

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
  );

grant select, insert on table public.messages to authenticated;

-- No update/delete grant at all — even a well-formed request can't reach an
-- RLS check that doesn't exist for those operations.

-- ============================================================================
-- 3. get_or_create_conversation — the only way a conversation row is ever created
-- ============================================================================
-- security definer is required: authenticated clients have no INSERT grant
-- on conversations at all (see section 1). This function is the sole
-- exception, and it only ever inserts a row where one side is auth.uid()
-- itself — a caller can request a conversation *with* anyone, but can never
-- fabricate one that doesn't include themselves, and can never specify both
-- sides.
--
-- Concurrency: `on conflict (user_a_id, user_b_id) do nothing` followed by a
-- plain select is safe under a race — if two requests for the same pair
-- commit at nearly the same instant, exactly one insert wins, the other's
-- on-conflict clause no-ops, and both calls then select the same single row.
-- There is no window where two rows for the same pair can exist.
--
-- Input validation: a null other_user_id, or one that doesn't correspond to
-- a real auth.users row, both raise a clean "User not found" rather than
-- either failing on the foreign key constraint with a raw Postgres error or
-- (worse) silently succeeding and creating a conversation referencing a
-- nonexistent user.

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

grant execute on function public.get_or_create_conversation(uuid) to authenticated;

-- ============================================================================
-- 4. get_conversations — one round trip for the whole conversation list
-- ============================================================================
-- security invoker (the default) is correct: every row this touches is
-- already something the caller could read directly under the SELECT policy
-- above, so there's no RLS gap to bypass. Returns the other participant's id
-- only — never their name/avatar, which the client resolves via the existing
-- getProfilesByUserIds, exactly like every other list in this app (never a
-- stored snapshot).
--
-- `last_message_at is not null` excludes a conversation that was created
-- (via Profile -> Message) but has never actually had a message sent in it —
-- the row genuinely exists (so the empty conversation screen can still open),
-- it just isn't "conversation activity" yet, so it doesn't belong in a list
-- that's fundamentally about recent activity.

create or replace function public.get_conversations()
returns table (
  id bigint,
  other_user_id uuid,
  last_message_at timestamptz,
  last_message_body text,
  created_at timestamptz
)
language sql
stable
as $$
  select
    c.id,
    case when c.user_a_id = auth.uid() then c.user_b_id else c.user_a_id end as other_user_id,
    c.last_message_at,
    c.last_message_body,
    c.created_at
  from public.conversations c
  where (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    and c.last_message_at is not null
  order by c.last_message_at desc;
$$;

grant execute on function public.get_conversations() to authenticated;

-- ============================================================================
-- 5. Keep last_message_at/last_message_body in sync on every new message
-- ============================================================================
-- security definer is required here too: the update grant a sender would
-- otherwise need doesn't exist (see "no insert/update grant" note in section
-- 1) — senders can insert messages, but only this trigger touches the
-- conversation row itself, and only these two columns.

create or replace function public.touch_conversation_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set last_message_at = new.created_at, last_message_body = new.body
  where id = new.conversation_id;

  return new;
end;
$$;

drop trigger if exists on_message_touch_conversation on public.messages;
create trigger on_message_touch_conversation
  after insert on public.messages
  for each row execute function public.touch_conversation_on_message();

-- ============================================================================
-- 6. Realtime: broadcast new messages
-- ============================================================================
-- Adds `messages` to the publication Supabase Realtime streams from. Realtime
-- enforces the same RLS as REST for authenticated clients, so this doesn't
-- widen access — a subscriber only ever receives INSERT events for
-- conversations they're already allowed to SELECT.
--
-- Plain `alter publication ... add table` has no IF NOT EXISTS form and
-- errors ("relation already member of publication") on a second run — unlike
-- every other statement in this file, so this checks pg_publication_tables
-- first and only adds it if it isn't already there, making it safe to re-run.
--
-- If your project's publication isn't named supabase_realtime (rare, but
-- possible on older/custom setups), skip this block and instead toggle
-- Replication on for the `messages` table from Database -> Replication in
-- the dashboard — functionally identical.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;
