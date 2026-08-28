import { supabase } from "@/lib/supabase/client";

/**
 * Permanently deletes the signed-in user's own account — see
 * app/api/account/delete/route.ts for the actual privileged work (Storage
 * cleanup, then the Supabase Admin API's auth.users delete, which cascades
 * away every dependent row). This function only forwards the caller's
 * current access token; the server independently re-verifies it and never
 * trusts a client-supplied user id. Throws a plain, user-facing message on
 * any failure — the caller (DeleteAccountSheet) is responsible for keeping
 * the account's local session intact until this actually resolves
 * successfully, never signing out speculatively.
 */
export async function deleteAccount(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw new Error("Your session has expired. Sign in again and retry.");
  }

  const response = await fetch("/api/account/delete", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    let message = "Couldn't delete your account. Try again.";
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Non-JSON error body — fall back to the generic message above.
    }
    throw new Error(message);
  }
}
