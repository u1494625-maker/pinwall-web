"use client";

import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";

/** Mirrors the SQL check constraints in supabase/profile_identity_unification.sql. */
export const MAX_DISPLAY_NAME_LENGTH = 20;
export const MAX_BIO_LENGTH = 160;

/** Shown wherever a post/comment's author has no resolvable profile (e.g. an
 *  ownerless pre-auth post) — never a stale display-name snapshot. */
export const FALLBACK_DISPLAY_NAME = "Pinwall user";

export type Profile = {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  backgroundUrl: string | null;
};

/** snake_case shape of a `profiles` row, as returned by Supabase/PostgREST. */
type ProfileRow = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  background_url: string | null;
};

const PROFILE_COLUMNS = "id, display_name, avatar_url, bio, background_url";

function rowToProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    backgroundUrl: row.background_url,
  };
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

export type ProfileEditableFields = {
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  backgroundUrl: string | null;
};

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
      bio: fields.bio,
      avatar_url: fields.avatarUrl,
      background_url: fields.backgroundUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId)
    .select("id");

  if (error) {
    throw new Error(error.message);
  }

  if (!data || data.length === 0) {
    throw new Error("Profile could not be updated.");
  }
}
