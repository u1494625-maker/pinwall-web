-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: Messages Phase 5C — system messages triggered by moderation
-- removal. No fake auth.users row, no fake profile: system messages live in
-- their own table, keyed by recipient, and are merged into the normal
-- Messages UI entirely at the client layer (a synthetic list row, a static
-- /messages/system route). Ordinary users get no write access of any kind —
-- the only writer is remove_reported_content below, which this file replaces
-- in place (same signature, same callers, no frontend change required for
-- that part).
--
-- Does not touch conversations, messages, their RLS, get_or_create_conversation,
-- touch_conversation_on_message, mark_conversation_read, or get_conversations.
-- Extends has_new_messages_since_last_open() (below) to also consider system
-- messages against the SAME message_inbox_state.last_opened_at — deliberately
-- not a second, competing unread signal. mark_messages_opened() is untouched:
-- opening /messages still only ever clears the global dot, never any
-- per-thread count, human or system.
--
-- Safely re-runnable in full.

-- ============================================================================
-- 1. system_messages — one row per (recipient, message)
-- ============================================================================
-- target_id is deliberately NOT a foreign key to posts/comments: the whole
-- point of this table is that a message must stay fully meaningful even
-- after the original content is hard-deleted later, so display must never
-- depend on that row still existing. content_preview and body are both
-- captured once, durably, at creation time (inside remove_reported_content,
-- section 6) — never recomputed from a live join afterward, and never
-- reconstructed client-side from a template. body is the complete, final
-- text the UI renders as-is; content_preview is kept alongside as a short,
-- structured field in case a future phase wants it without re-parsing body.
--
-- kind exists so the client can distinguish message types without parsing
-- text, and leaves room for a future kind without a migration (plain text +
-- check, matching every other status-shaped column in this project rather
-- than a Postgres enum).

create table if not exists public.system_messages (
  id bigint generated always as identity primary key,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('report_removed_reporter', 'report_removed_author')),
  target_type text not null check (target_type in ('post', 'comment')),
  target_id bigint not null,
  content_preview text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists system_messages_recipient_created_at_idx
  on public.system_messages (recipient_user_id, created_at);

alter table public.system_messages enable row level security;

drop policy if exists "Users can read their own system messages" on public.system_messages;
create policy "Users can read their own system messages"
  on public.system_messages
  for select
  to authenticated
  using (auth.uid() = recipient_user_id);

grant select on table public.system_messages to authenticated;

-- No insert/update/delete grant or policy for any role, including
-- authenticated. This is the entire enforcement of "ordinary users cannot
-- create system messages, through any client call or direct table access":
-- the coarse-grained GRANT is checked before RLS is even consulted, and no
-- grant exists to bypass. The only writer is remove_reported_content
-- (security definer) in section 6, exactly the same shape as reports.sql's
-- reporter_user_id write path (report_post/report_comment) and
-- messaging_unread.sql's read-timestamp columns (mark_conversation_read).

-- ============================================================================
-- 2. system_message_read_state — per-recipient "last read" marker
-- ============================================================================
-- Structurally identical to message_inbox_state (messaging_unread.sql), but
-- a distinct table on purpose: message_inbox_state means "when did you last
-- open the /messages tab" (the global-dot signal); this means "when did you
-- last read your System Message thread specifically" — the same role
-- conversations.user_a_last_read_at/user_b_last_read_at play for a human
-- thread. Keeping the two concepts in separate tables keeps each
-- unambiguous, the same reasoning already applied when message_inbox_state
-- was kept off of profiles.

create table if not exists public.system_message_read_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_read_at timestamptz
);

alter table public.system_message_read_state enable row level security;

drop policy if exists "Users can read their own system message read state" on public.system_message_read_state;
create policy "Users can read their own system message read state"
  on public.system_message_read_state
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own system message read state" on public.system_message_read_state;
create policy "Users can insert their own system message read state"
  on public.system_message_read_state
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own system message read state" on public.system_message_read_state;
create policy "Users can update their own system message read state"
  on public.system_message_read_state
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on table public.system_message_read_state to authenticated;

-- ============================================================================
-- 3. get_system_message_summary — the one row ConversationList merges in
-- ============================================================================
-- security invoker (the default) is correct: every row this touches is
-- already something the caller could read directly under the policies above,
-- exactly like get_conversations(). Returns NO row at all if the caller has
-- never received a system message — matching get_conversations()'s own
-- "a conversation with no messages doesn't appear" convention, so the client
-- only synthesizes a "System Message" list entry when this actually returns
-- something.
--
-- last_message_body is the same full, composed body a recipient sees inside
-- the thread (not a separately-summarized preview) — the same choice
-- get_conversations() already makes for last_message_body, letting the list
-- row's existing CSS truncation handle length exactly as it does for a human
-- conversation, with no separate "list preview" formatting rule to maintain.

create or replace function public.get_system_message_summary()
returns table (
  last_message_at timestamptz,
  last_message_body text,
  unread_count bigint
)
language sql
stable
as $$
  select
    (select sm.created_at from public.system_messages sm
       where sm.recipient_user_id = auth.uid()
       order by sm.created_at desc limit 1),
    (select sm.body from public.system_messages sm
       where sm.recipient_user_id = auth.uid()
       order by sm.created_at desc limit 1),
    (select count(*) from public.system_messages sm
       where sm.recipient_user_id = auth.uid()
         and sm.created_at > coalesce(
           (select last_read_at from public.system_message_read_state where user_id = auth.uid()),
           '-infinity'::timestamptz
         ))
  where exists (select 1 from public.system_messages sm where sm.recipient_user_id = auth.uid());
$$;

grant execute on function public.get_system_message_summary() to authenticated;

-- ============================================================================
-- 4. mark_system_messages_read — the only way this thread's read marker moves
-- ============================================================================
-- Mirrors mark_messages_opened() exactly: no parameters, always auth.uid(),
-- upsert. security invoker is correct — RLS on system_message_read_state
-- already restricts both the insert and the update to the caller's own row.
-- This never touches system_messages or message_inbox_state — opening
-- /messages/system marks only this thread read, exactly parallel to
-- mark_conversation_read marking only one human conversation read.

create or replace function public.mark_system_messages_read()
returns void
language sql
security invoker
as $$
  insert into public.system_message_read_state (user_id, last_read_at)
  values (auth.uid(), now())
  on conflict (user_id) do update set last_read_at = excluded.last_read_at;
$$;

grant execute on function public.mark_system_messages_read() to authenticated;

-- ============================================================================
-- 5. has_new_messages_since_last_open — extended, not replaced by a second
--    competing signal
-- ============================================================================
-- Same function, same signature, same message_inbox_state.last_opened_at —
-- now true when EITHER a normal incoming DM OR a system message exists after
-- that one shared timestamp. mark_messages_opened() (messaging_unread.sql)
-- is completely unchanged and remains the only thing that ever advances
-- last_opened_at, so there is exactly one global-dot clock, not two.

create or replace function public.has_new_messages_since_last_open()
returns boolean
language sql
stable
as $$
  select
    exists (
      select 1
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
        and m.sender_user_id <> auth.uid()
        and m.created_at > coalesce(
          (select last_opened_at from public.message_inbox_state where user_id = auth.uid()),
          '-infinity'::timestamptz
        )
    )
    or exists (
      select 1
      from public.system_messages sm
      where sm.recipient_user_id = auth.uid()
        and sm.created_at > coalesce(
          (select last_opened_at from public.message_inbox_state where user_id = auth.uid()),
          '-infinity'::timestamptz
        )
    );
$$;

grant execute on function public.has_new_messages_since_last_open() to authenticated;

-- ============================================================================
-- 6. remove_reported_content — now also creates system messages, atomically
-- ============================================================================
-- Same signature as moderation.sql's version (returns void, one bigint
-- parameter) so lib/admin.ts and every existing caller need no change at
-- all. Everything from the admin check through the row lock and the target's
-- moderation_status update is unchanged. What's added:
--
--   1. The target's title/caption (post) or body (comment), plus its current
--      author id, are read BEFORE the report-actioning step, directly from
--      the row this function already located — never from client input.
--   2. content_preview is derived with the same "title, else caption
--      excerpt" rule getDisplayTitle() already uses client-side (title if
--      present, else caption; a comment has only body), capped at 60
--      characters with an ellipsis — computed here, in SQL, specifically so
--      it's captured once and stored durably rather than depending on the
--      target row staying readable/unremoved later. An empty title AND
--      empty caption (a bare media post with no text at all) falls back to
--      the fixed string "(no caption)" rather than empty quotes.
--   3. Both message bodies are fully composed here, once — the UI never
--      assembles a template from parts, so a future wording change can never
--      retroactively alter a historical message's stored text.
--   4. The existing "actioned every pending report against this target"
--      UPDATE is now a WITH ... RETURNING CTE, and its RETURNING set is fed
--      directly into the reporter-message INSERT's SELECT — the exact
--      reporters whose reports become 'actioned' are, by construction, the
--      exact reporters who receive a message; there is no separate SELECT
--      that could drift from the UPDATE it's paired with. No DISTINCT is
--      needed on reporter_user_id: reports.sql's partial unique index
--      already guarantees at most one pending report per (reporter, target),
--      so this CTE can never return the same reporter twice for this target.
--   5. Exactly one author message is inserted, only if the target currently
--      has a non-null author (posts.user_id is nullable via `on delete set
--      null`, so an ownerless/legacy-author-deleted post is skipped exactly
--      like the existing notify_on_post_like/notify_on_comment triggers
--      already skip a null owner; comments.user_id is `on delete cascade`,
--      so a comment whose author's account was deleted is already gone by
--      the time an admin could act on it, and this function's own existing
--      `if not found` branch handles that case unchanged).
--
-- All of this runs inside the same function body as the existing removal
-- logic, i.e. the same single transaction: if any step fails, the target is
-- not removed, no report changes state, and no message is sent. There is no
-- partial-failure state to reason about beyond what Postgres already
-- guarantees. A duplicate/racing call on an already-reviewed report still
-- exits at the pre-existing `if not found` check, before any of the new code
-- runs, so messages are never created twice for the same removal.
--
-- Self-report is already rejected at report_post/report_comment insert time,
-- and no feature in this app ever reassigns a post/comment's ownership after
-- creation — so a report's reporter_user_id can never equal that same
-- target's current author, making "author also among the actioned
-- reporters" structurally impossible today. If that invariant ever changed
-- in the future, this function would still behave sensibly: that person
-- would receive both messages, which is the correct outcome if it were ever
-- possible, so no extra exclusion code is added for a case that cannot occur.

create or replace function public.remove_reported_content(p_report_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_report public.reports%rowtype;
  content_target_id bigint;
  post_title text;
  post_caption text;
  comment_body text;
  content_author_id uuid;
  content_preview text;
  reporter_message_body text;
  author_message_body text;
begin
  if not public.is_current_user_admin() then
    raise exception 'Not authorized';
  end if;

  select *
  into target_report
  from public.reports
  where id = p_report_id and status = 'pending'
  for update;

  if not found then
    raise exception 'Report not found or already reviewed';
  end if;

  if target_report.target_type = 'post' then
    content_target_id := target_report.target_post_id;

    select p.title, p.caption, p.user_id
    into post_title, post_caption, content_author_id
    from public.posts p
    where p.id = content_target_id;

    update public.posts set moderation_status = 'removed' where id = content_target_id;

    if nullif(btrim(post_title), '') is not null then
      content_preview := btrim(post_title);
    elsif nullif(btrim(post_caption), '') is not null then
      content_preview := btrim(post_caption);
    else
      content_preview := '(no caption)';
    end if;

    author_message_body := 'Your post was removed after review.' || chr(10) || chr(10) ||
      'You are responsible for what you post online.';
  else
    content_target_id := target_report.target_comment_id;

    select c.body, c.user_id
    into comment_body, content_author_id
    from public.comments c
    where c.id = content_target_id;

    update public.comments set moderation_status = 'removed' where id = content_target_id;

    content_preview := btrim(comment_body);

    author_message_body := 'Your comment was removed after review.' || chr(10) || chr(10) ||
      'You are responsible for what you post online.';
  end if;

  if char_length(content_preview) > 60 then
    content_preview := rtrim(left(content_preview, 60)) || '…';
  end if;

  reporter_message_body := 'Thanks for your report.' || chr(10) || chr(10) ||
    'We reviewed the content you reported and removed it for violating our community standards.' || chr(10) || chr(10) ||
    'Reported content: "' || content_preview || '"';

  author_message_body := author_message_body || chr(10) || chr(10) ||
    'Reported content: "' || content_preview || '"';

  with actioned_reports as (
    update public.reports
    set status = 'actioned', reviewed_by_user_id = auth.uid(), reviewed_at = now()
    where status = 'pending'
      and target_type = target_report.target_type
      and (
        (target_report.target_type = 'post' and target_post_id = target_report.target_post_id)
        or (target_report.target_type = 'comment' and target_comment_id = target_report.target_comment_id)
      )
    returning reporter_user_id
  )
  insert into public.system_messages (recipient_user_id, kind, target_type, target_id, content_preview, body)
  select ar.reporter_user_id, 'report_removed_reporter', target_report.target_type, content_target_id, content_preview, reporter_message_body
  from actioned_reports ar;

  if content_author_id is not null then
    insert into public.system_messages (recipient_user_id, kind, target_type, target_id, content_preview, body)
    values (content_author_id, 'report_removed_author', target_report.target_type, content_target_id, content_preview, author_message_body);
  end if;
end;
$$;

revoke execute on function public.remove_reported_content(bigint) from public;
grant execute on function public.remove_reported_content(bigint) to authenticated;

-- ============================================================================
-- 7. Realtime: broadcast new system messages
-- ============================================================================
-- Same reasoning as messaging.sql's own addition of `messages`: Realtime
-- enforces the same RLS as REST for authenticated clients, so a subscriber
-- only ever receives INSERT events for rows they could already SELECT —
-- i.e., only their own recipient_user_id. Checked against
-- pg_publication_tables first so this file stays safely re-runnable, exactly
-- like messaging.sql's own version of this block.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'system_messages'
  ) then
    alter publication supabase_realtime add table public.system_messages;
  end if;
end;
$$;
