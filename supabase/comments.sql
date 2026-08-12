-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: Interaction Phase 2 — real top-level comments. Adds one table
-- (comments) and extends the existing get_post_engagement RPC (defined in
-- interactions.sql) to also return a real comment_count, reusing the same
-- one-call-per-page-load batching already used for like/save counts.
--
-- Safely re-runnable in full.

-- ============================================================================
-- 1. comments
-- ============================================================================
-- Unlike post_likes/post_saves/follows (toggle relationships with a composite
-- PK), each comment is individually addressable content that can be deleted
-- on its own, so it gets its own surrogate id rather than a composite key.
--
-- `author` is a denormalized display-name snapshot written by the client at
-- insert time — the same convention posts.author already uses (no profiles
-- table exists in this app). IMPORTANT: `author` is display text only and is
-- NEVER used for authorization. `user_id` — verified server-side via RLS's
-- auth.uid() check below, not supplied client-side as trusted input — is the
-- only source of truth for ownership and permissions.

create table if not exists public.comments (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  author text not null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists comments_post_id_idx on public.comments (post_id);

alter table public.comments enable row level security;

drop policy if exists "Public can read comments" on public.comments;
create policy "Public can read comments"
  on public.comments
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Users can comment as themselves" on public.comments;
create policy "Users can comment as themselves"
  on public.comments
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own comments" on public.comments;
create policy "Users can delete their own comments"
  on public.comments
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- No update policy: editing comments is out of scope for this phase.

grant select on table public.comments to anon, authenticated;
grant insert, delete on table public.comments to authenticated;

-- ============================================================================
-- 2. get_post_engagement — now also returns comment_count
-- ============================================================================
-- Postgres can't CREATE OR REPLACE a function that changes its return
-- columns, so the old signature (from interactions.sql) is dropped first.
-- like_count/save_count/viewer_has_liked/viewer_has_saved behavior is
-- unchanged — this adds exactly one more correlated subquery, reusing the
-- same batched, no-N+1, no-raw-ID-list RPC already established for Phase 1.

drop function if exists public.get_post_engagement(bigint[]);

create function public.get_post_engagement(post_ids bigint[])
returns table (
  post_id bigint,
  like_count bigint,
  save_count bigint,
  comment_count bigint,
  viewer_has_liked boolean,
  viewer_has_saved boolean
)
language sql
stable
as $$
  select
    id as post_id,
    (select count(*) from public.post_likes pl where pl.post_id = id),
    (select count(*) from public.post_saves ps where ps.post_id = id),
    (select count(*) from public.comments c where c.post_id = id),
    exists (select 1 from public.post_likes pl where pl.post_id = id and pl.user_id = auth.uid()),
    exists (select 1 from public.post_saves ps where ps.post_id = id and ps.user_id = auth.uid())
  from unnest(post_ids) as id;
$$;

grant execute on function public.get_post_engagement(bigint[]) to anon, authenticated;
