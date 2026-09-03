"use client";

import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";

/** Mirrors the SQL check constraints in supabase/profile_identity_unification.sql. */
export const MAX_DISPLAY_NAME_LENGTH = 20;
export const MAX_BIO_LENGTH = 160;

/** Mirrors profiles_username_format in supabase/profile_username.sql. */
export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 20;
const USERNAME_PATTERN = /^[a-z0-9_]+$/;

/** Shown wherever a post/comment's author has no resolvable profile (e.g. an
 *  ownerless pre-auth post) — never a stale display-name snapshot. New
 *  profiles no longer normally get this value (see handle_new_user in
 *  supabase/profile_username.sql, which generates a real "{Adjective} Kava"
 *  name for every new signup) — it remains solely as this defensive
 *  missing-profile fallback. */
export const FALLBACK_DISPLAY_NAME = "Pinwall user";

export type Profile = {
  id: string;
  displayName: string | null;
  /** Globally unique (case-insensitively), lowercase, stored without "@" —
   *  see profiles_username_format in supabase/profile_username.sql. */
  username: string;
  avatarUrl: string | null;
  bio: string | null;
  backgroundUrl: string | null;
};

/** snake_case shape of a `profiles` row, as returned by Supabase/PostgREST. */
type ProfileRow = {
  id: string;
  display_name: string | null;
  username: string;
  avatar_url: string | null;
  bio: string | null;
  background_url: string | null;
};

const PROFILE_COLUMNS = "id, display_name, username, avatar_url, bio, background_url";

function rowToProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    username: row.username,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    backgroundUrl: row.background_url,
  };
}

/** Normalizes free-typed input into what would actually be stored: trims,
 *  strips a leading "@" if present (purely presentational, never stored —
 *  see EditProfileForm/UserResultRow), and lowercases. Does not otherwise
 *  alter or strip characters — invalid characters are surfaced by
 *  validateUsername, not silently dropped here. */
export function normalizeUsername(input: string): string {
  return input.trim().replace(/^@/, "").toLowerCase();
}

/** Returns an error message if `username` (already normalized via
 *  normalizeUsername) isn't valid, or null if it is. Mirrors
 *  profiles_username_format's DB check constraint exactly, client-side —
 *  the DB constraint (and updateProfile's unique-violation handling below)
 *  remain the actual authority; this is purely early, friendlier feedback. */
export function validateUsername(username: string): string | null {
  if (username.length < MIN_USERNAME_LENGTH || username.length > MAX_USERNAME_LENGTH) {
    return `Username must be ${MIN_USERNAME_LENGTH}–${MAX_USERNAME_LENGTH} characters.`;
  }
  if (!USERNAME_PATTERN.test(username)) {
    return "Username can only contain lowercase letters, numbers, and underscores.";
  }
  return null;
}

/**
 * A user's public profile, or undefined if none exists — e.g. the id doesn't
 * correspond to a real user, or (pre-migration) their profile row hasn't
 * been created yet. Never throws; callers render a not-found state instead.
 */
export async function getProfile(userId: string): Promise<Profile | undefined> {
  if (!isSupabaseConfigured) return undefined;

  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load profile from Supabase:", error.message);
    return undefined;
  }

  return data ? rowToProfile(data) : undefined;
}

/**
 * Batched profile lookup for a set of user ids — the one query every
 * post/comment feed uses to resolve current author identity, however many
 * distinct authors it contains. Never one request per post/comment (no N+1).
 * Returns [] immediately, with no query at all, for an empty input.
 */
export async function getProfilesByUserIds(userIds: string[]): Promise<Map<string, Profile>> {
  const uniqueIds = Array.from(new Set(userIds));
  if (uniqueIds.length === 0 || !isSupabaseConfigured) return new Map();

  const { data, error } = await supabase.from("profiles").select(PROFILE_COLUMNS).in("id", uniqueIds);

  if (error) {
    console.error("Failed to batch-load profiles from Supabase:", error.message);
    return new Map();
  }

  return new Map((data ?? []).map((row) => [row.id, rowToProfile(row)]));
}

const SEARCH_RESULTS_LIMIT = 20;

/**
 * Real Pinwall users matching `query`, optionally excluding `excludeUserId`
 * (the searching user themselves, when there is one) — used by the New
 * Message screen and Search's own Users tab. `excludeUserId` is optional
 * specifically for Search: neither /search nor a profile page require
 * sign-in, so a signed-out visitor (with no id of their own to exclude) can
 * still search. Deliberately does not filter by block state —
 * profiles.sql's own SELECT policy never has, on purpose, so a blocked
 * user's profile stays discoverable (e.g. to unblock them); see
 * supabase/blocking.sql's own doc comment. Returns [] immediately, with no
 * query at all, for a blank search.
 *
 * Searches BOTH username (exact/prefix match — an unambiguous identity
 * match, e.g. "sleepykava" finds @sleepykava_184) and display_name
 * (case-insensitive substring match, the original behavior). Two small,
 * fixed queries run in parallel (not one per result — never N+1), then
 * merged: username matches are listed first, display_name matches fill the
 * remainder, deduplicated by id. Deliberately simple/deterministic — no
 * scored ranking engine.
 */
export async function searchProfiles(query: string, excludeUserId?: string): Promise<Profile[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0 || !isSupabaseConfigured) return [];

  const usernameQuery = normalizeUsername(trimmed);

  let usernameRequest = supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .ilike("username", `${usernameQuery}%`)
    .order("username", { ascending: true })
    .limit(SEARCH_RESULTS_LIMIT);

  let displayNameRequest = supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .ilike("display_name", `%${trimmed}%`)
    .order("display_name", { ascending: true })
    .limit(SEARCH_RESULTS_LIMIT);

  if (excludeUserId) {
    usernameRequest = usernameRequest.neq("id", excludeUserId);
    displayNameRequest = displayNameRequest.neq("id", excludeUserId);
  }

  const [usernameResult, displayNameResult] = await Promise.all([usernameRequest, displayNameRequest]);

  if (usernameResult.error) {
    console.error("Failed to search profiles by username from Supabase:", usernameResult.error.message);
  }
  if (displayNameResult.error) {
    console.error("Failed to search profiles by display name from Supabase:", displayNameResult.error.message);
  }

  const seenIds = new Set<string>();
  const results: Profile[] = [];

  for (const row of usernameResult.data ?? []) {
    if (seenIds.has(row.id)) continue;
    seenIds.add(row.id);
    results.push(rowToProfile(row));
  }
  for (const row of displayNameResult.data ?? []) {
    if (seenIds.has(row.id)) continue;
    seenIds.add(row.id);
    results.push(rowToProfile(row));
  }

  return results.slice(0, SEARCH_RESULTS_LIMIT);
}

export type ProfileEditableFields = {
  displayName: string;
  username: string;
  bio: string | null;
  avatarUrl: string | null;
  backgroundUrl: string | null;
};

/** Postgres SQLSTATE for a unique-constraint violation — fires here from
 *  profiles_username_unique_ci (supabase/profile_username.sql) if the
 *  requested username was taken by someone else between any client-side
 *  check and this save. That DB constraint, not a client-side check, is the
 *  real authority. */
const UNIQUE_VIOLATION = "23505";

/** Updates the signed-in user's own profile — RLS (`auth.uid() = id`)
 *  guarantees this can never target another user's row regardless of what
 *  `userId` is passed. */
export async function updateProfile(userId: string, fields: ProfileEditableFields): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase isn't configured — add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local.",
    );
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({
      display_name: fields.displayName,
      username: fields.username,
      bio: fields.bio,
      avatar_url: fields.avatarUrl,
      background_url: fields.backgroundUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId)
    .select("id");

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new Error("That username is already taken.");
    }
    throw new Error(error.message);
  }

  if (!data || data.length === 0) {
    throw new Error("Profile could not be updated.");
  }
}

/**
 * Lightweight UX-only check — never the source of truth. Callers (e.g.
 * EditProfileForm) may use this for early "already taken" feedback while
 * typing, but MUST still handle updateProfile() throwing its own
 * "already taken" error at save time, since another user can take the name
 * in the gap between this check and the real save; that DB-level check
 * (profiles_username_unique_ci) is what actually prevents a collision.
 * Fails open (reports "available") on a network error, for the same reason —
 * this is advisory only.
 */
export async function isUsernameAvailable(username: string, excludeUserId?: string): Promise<boolean> {
  if (!isSupabaseConfigured) return true;

  let request = supabase.from("profiles").select("id").eq("username", username).limit(1);
  if (excludeUserId) {
    request = request.neq("id", excludeUserId);
  }

  const { data, error } = await request;
  if (error) {
    console.error("Failed to check username availability from Supabase:", error.message);
    return true;
  }

  return !data || data.length === 0;
}
