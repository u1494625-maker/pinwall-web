-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready.
--
-- Context: introduces a real, globally-unique username/handle alongside the
-- existing display_name — display_name stays exactly what it is today (a
-- non-unique, user-editable label; existing users' values are NEVER
-- touched by this migration), username becomes the new unique lookup/
-- disambiguation field ("Sleepy Kava" / "@sleepykava_184").
--
-- Existing users: backfilled with a deterministic, collision-safe username
-- derived from their CURRENT display_name + their own UUID — never a random
-- Kava name, and never a change to display_name itself.
--
-- New users (via handle_new_user, updated below): both display_name AND
-- username are now randomly generated from the same curated adjective list
-- ("{Adjective} Kava" / "{adjective}kava_NNN") instead of the OAuth
-- full_name/email that seeded display_name until now. avatar_url continues
-- to come from OAuth metadata, unchanged.
--
-- Safely re-runnable in full (column add is `if not exists`, the backfill
-- loop only ever touches rows where username is still null, constraints/
-- index are dropped-and-recreated, and the trigger is a plain
-- create-or-replace).

-- ============================================================================
-- Phase A — profiles.username, nullable for now
-- ============================================================================

alter table public.profiles
  add column if not exists username text;

-- ============================================================================
-- Phase B — backfill every existing row, WITHOUT touching display_name
-- ============================================================================
-- Base candidate: display_name normalized down to lowercase ascii
-- letters/digits only (falls back to 'user' if that strips to nothing, e.g.
-- a name that's pure emoji/non-Latin script). First attempt appends the
-- last 8 hex characters of the user's own UUID (already globally unique, so
-- this collides with essentially zero probability) as the suffix; the
-- result is still verified against every other row before being accepted,
-- and a short numeric counter is used as a fallback suffix in the
-- (practically unreachable) case that verification ever fails — this is a
-- guaranteed-unique construction, not a "hope for no collision" one.

do $$
declare
  r record;
  base text;
  candidate text;
  attempt integer;
begin
  for r in select id, display_name from public.profiles where username is null order by created_at, id loop
    base := lower(regexp_replace(coalesce(r.display_name, ''), '[^a-zA-Z0-9]', '', 'g'));
    if base = '' then
      base := 'user';
    end if;
    -- Leave room for "_" + up to 8 hex chars within the 20-char cap enforced below.
    base := left(base, 11);

    candidate := base || '_' || right(replace(r.id::text, '-', ''), 8);

    attempt := 0;
    while exists (select 1 from public.profiles where lower(username) = candidate and id <> r.id) loop
      attempt := attempt + 1;
      candidate := base || '_' || lpad(attempt::text, 3, '0');
    end loop;

    update public.profiles set username = candidate where id = r.id;
  end loop;
end $$;

-- ============================================================================
-- Phase C — lock the column down: required, formatted, uniquely indexed
-- ============================================================================
-- Format matches what both the frontend validator (lib/profiles.ts) and the
-- generator below produce: lowercase a-z/0-9/underscore only, 3-20 chars.
-- Uniqueness is a case-insensitive index on lower(username) rather than a
-- plain unique constraint on the raw column — belt-and-suspenders alongside
-- the app always normalizing to lowercase before saving.

alter table public.profiles alter column username set not null;

alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles
  add constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,20}$');

drop index if exists profiles_username_unique_ci;
create unique index profiles_username_unique_ci on public.profiles (lower(username));

-- ============================================================================
-- Phase D — handle_new_user(): NEW users only get a random Kava identity
-- ============================================================================
-- Existing users are entirely unaffected by this (the trigger only ever
-- fires on a NEW row in auth.users). display_name and username are both
-- generated from the SAME chosen adjective. Collision-safe by construction:
-- the insert is attempted directly and a real unique_violation (from the
-- lower(username) index above) triggers a retry with a fresh
-- adjective/suffix combination, bounded so a run of bad luck can never fail
-- the sign-up itself; an (astronomically unlikely, 50 adjectives x 1000
-- suffixes = 50,000 slots) exhausted retry budget falls back to a
-- UUID-derived candidate — see that section's own comment below for why
-- this is NOT treated as a bare mathematical guarantee just because it's
-- derived from a unique UUID, and is instead given its own bounded,
-- deterministic (not random) retry.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  adjectives text[] := array[
    'Curious','Sleepy','Hungry','Lucky','Chill','Shy','Late','Busy','Tired','Cozy',
    'Wild','Quiet','Brave','Sneaky','Awkward','Confused','Chaotic','Caffeinated','Mysterious','Suspicious',
    'Wandering','Helpful','Local','Hidden','Social','Random','Adventurous','Restless','Nosy','Unbothered',
    'Dramatic','Silly','Goofy','Moody','Spontaneous','Friendly','Fresh','Secret','Playful','Sunny',
    'Cloudy','Dreamy','Bouncy','Clever','Gentle','Witty','Quirky','Peppy','Swift','Jolly'
  ];
  chosen_adjective text;
  chosen_username text;
  attempt integer;
  max_attempts constant integer := 30;
  fallback_hex text;
  fallback_attempt integer;
begin
  -- Idempotent re-run safety, matching the previous trigger's own
  -- `on conflict (id) do nothing` behavior.
  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  for attempt in 1..max_attempts loop
    chosen_adjective := adjectives[1 + floor(random() * array_length(adjectives, 1))::integer];
    chosen_username := lower(chosen_adjective) || 'kava_' || lpad(floor(random() * 1000)::text, 3, '0');

    begin
      insert into public.profiles (id, display_name, username, avatar_url)
      values (new.id, chosen_adjective || ' Kava', chosen_username, new.raw_user_meta_data->>'avatar_url');
      return new;
    exception when unique_violation then
      -- Only `username` can collide here (the `id` idempotency check above
      -- already ruled out a conflict on the primary key) -- try a fresh
      -- random adjective/suffix combination.
      continue;
    end;
  end loop;

  -- Every bounded random attempt above collided (astronomically unlikely).
  -- Fall back to a UUID-derived candidate using FAR more of the UUID's own
  -- entropy (15 hex characters -- as many as fit alongside the "kava_"
  -- prefix within the 20-char cap -- not a small truncation), so a real
  -- collision is already extremely unlikely. This is still, strictly
  -- speaking, a truncation of the full 128-bit UUID, not on its own a
  -- mathematical uniqueness guarantee -- so it gets its own bounded,
  -- DETERMINISTIC retry (a strictly-incrementing counter appended, never
  -- another random guess, so every candidate in this loop is guaranteed
  -- distinct from every other one tried here) rather than being assumed to
  -- always succeed on the first try. display_name keeps using the chosen
  -- adjective regardless of which username candidate ultimately wins.
  chosen_adjective := adjectives[1 + floor(random() * array_length(adjectives, 1))::integer];
  fallback_hex := right(replace(new.id::text, '-', ''), 15);

  for fallback_attempt in 0..999 loop
    chosen_username := case
      when fallback_attempt = 0 then 'kava_' || fallback_hex
      else left('kava_' || fallback_hex, 16) || '_' || fallback_attempt::text
    end;

    begin
      insert into public.profiles (id, display_name, username, avatar_url)
      values (new.id, chosen_adjective || ' Kava', chosen_username, new.raw_user_meta_data->>'avatar_url');
      return new;
    exception when unique_violation then
      continue;
    end;
  end loop;

  -- Unreachable in any realistic scenario (it requires 1000 mutually-
  -- distinct, UUID-derived candidates to EACH already be taken by another
  -- row). If it somehow happens, let this final unique_violation propagate
  -- and fail this one sign-up attempt loudly (the user can simply retry) --
  -- never silently return without a profiles row for new.id.
  insert into public.profiles (id, display_name, username, avatar_url)
  values (new.id, chosen_adjective || ' Kava', chosen_username, new.raw_user_meta_data->>'avatar_url');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
