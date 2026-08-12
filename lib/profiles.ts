"use client";

import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";

export type Profile = {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
};

/** snake_case shape of a `profiles` row, as returned by Supabase/PostgREST. */
type ProfileRow = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
};

function rowToProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
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
    .select("id, display_name, avatar_url, bio")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load profile from Supabase:", error.message);
    return undefined;
  }

  return data ? rowToProfile(data) : undefined;
}
