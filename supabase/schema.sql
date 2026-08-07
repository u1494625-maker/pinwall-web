-- Run this in your Supabase project's SQL editor (Dashboard → SQL Editor → New query).
-- Creates the `posts` table that lib/posts.ts reads from and writes to.

create table if not exists public.posts (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),

  -- Core post content
  image text not null,
  image_alt text not null,
  image_aspect text not null default 'aspect-[4/5]',
  title text not null,
  caption text not null,
  tags text[] not null default '{}',
  author text not null default 'Anonymous',

  -- rating uses `real`, not `numeric` — Supabase returns `numeric` columns as strings
  -- to preserve exact decimal precision, which would silently break `post.rating` as
  -- a JS number. `real` comes back as a proper JS number.
  rating real not null default 0,
  rating_count text not null default 'New',

  -- Optional map fields (post creation only, per types/post.ts — no map querying yet)
  show_on_map boolean not null default false,
  latitude double precision,
  longitude double precision,
  location_name text
);

-- Row Level Security is on, but with fully open policies for now: there's no auth
-- yet, so there's no user identity to scope access to. Anyone with the public
-- publishable key can read and create posts. Tighten these (e.g. restrict
-- insert/update/delete to `auth.uid() = author_id`) once authentication is implemented.
alter table public.posts enable row level security;

create policy "Public can read posts"
  on public.posts
  for select
  using (true);

create policy "Public can create posts"
  on public.posts
  for insert
  with check (true);
