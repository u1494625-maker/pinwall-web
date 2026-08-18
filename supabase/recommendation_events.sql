-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: Recommendation V1 + Smart Search V1 — Phase A shared foundation.
-- Adds the one new table this feature needs: user_interest_events, a
-- personalization/behavioral-signal log for the three interaction types that
-- have no existing home (search queries, detail-page opens, map-marker
-- opens). Save/Helpful/Comment personalization signals are read directly
-- from the existing post_saves/post_likes/comments tables instead of being
-- duplicated here — see the Recommendation V1 plan for why.
--
-- Signed-in only, by design: user_id is NOT NULL and every policy is
-- `to authenticated` only, so no anonymous long-term personalization data is
-- ever collected.
--
-- Safely re-runnable in full.

-- ============================================================================
-- 1. user_interest_events
-- ============================================================================
-- Each row is one behavioral signal: a committed (not per-keystroke) search
-- query, a deliberate PostCard -> PostDetail click, or a Map marker ->
-- PostDetail open. post_id is null only for search_query rows; query is null
-- for every other event_type — the shape check below enforces this as a real
-- database guarantee, not just an app-code convention. Immutable log — no
-- update/delete policy, same precedent as public.notifications.

create table if not exists public.user_interest_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('search_query', 'detail_click', 'map_interaction')),
  post_id bigint references public.posts(id) on delete cascade,
  query text,
  created_at timestamptz not null default now(),
  constraint user_interest_events_shape check (
    (event_type = 'search_query' and post_id is null and query is not null)
    or (event_type in ('detail_click', 'map_interaction') and post_id is not null and query is null)
  )
);

create index if not exists user_interest_events_user_recent_idx
  on public.user_interest_events (user_id, created_at desc);

alter table public.user_interest_events enable row level security;

drop policy if exists "Users can read their own interest events" on public.user_interest_events;
create policy "Users can read their own interest events"
  on public.user_interest_events
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can log their own interest events" on public.user_interest_events;
create policy "Users can log their own interest events"
  on public.user_interest_events
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- No update/delete policy: this is an immutable behavioral log, same
-- precedent as public.notifications — decay/relevance is handled entirely in
-- application code (continuous, age-based), never by editing or deleting rows.

grant select, insert on table public.user_interest_events to authenticated;

-- ============================================================================
-- 2. comments.user_id index
-- ============================================================================
-- comments already has post_id/parent_comment_id indexes but none on
-- user_id — personalization needs an efficient "posts I commented on
-- recently" read (`where user_id = auth.uid() order by created_at`), which
-- would otherwise be a full table scan. Purely additive; no behavior change.

create index if not exists comments_user_id_idx on public.comments (user_id);
