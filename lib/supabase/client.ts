import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/** False until NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are set in .env.local. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

// Falls back to placeholder values so the client can always be constructed (no crash
// at import time / build time) even before .env.local is filled in. Callers should
// check `isSupabaseConfigured` before relying on real data coming back.
export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabasePublishableKey || "placeholder-publishable-key",
);
