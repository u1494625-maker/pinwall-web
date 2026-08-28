import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { POST_IMAGE_BUCKET, POST_VIDEO_BUCKET } from "@/lib/storage";

// Server-only — never NEXT_PUBLIC_, so Next.js never inlines this into the
// client bundle. The URL/anon key are already public (used client-side
// throughout this app); only the service-role key is new and sensitive.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/**
 * `listV2` is marked @experimental in the installed storage-js version
 * (signature may change in a future SDK upgrade) but is the only API that
 * gives a flat, delimiter-free listing of every object under a prefix in
 * one paginated sweep — the older `list()` only lists one folder level at
 * a time and would need hand-written recursion (a more likely source of a
 * real bug, for this exact "never leave a file behind, never touch
 * another user's files" operation, than an experimental-labeled but
 * purpose-built vendor API). Re-verify this if the SDK is ever upgraded.
 *
 * `prefix` MUST end with "/" — this is what scopes the listing to exactly
 * this user's own folder. Without it, Storage's prefix match is a plain
 * string match (S3-style), so a bare userId with no trailing slash could
 * theoretically also match a different object whose path merely starts
 * with the same characters. Every returned key is independently
 * re-verified to start with `prefix` before being queued for deletion —
 * defense in depth beyond trusting the API's own filter alone.
 */
async function removeAllUnderPrefix(client: SupabaseClient, bucket: string, prefix: string): Promise<void> {
  if (!prefix.endsWith("/")) {
    throw new Error("removeAllUnderPrefix: prefix must end with '/'");
  }

  const keys: string[] = [];
  let cursor: string | undefined;

  do {
    const { data, error } = await client.storage.from(bucket).listV2({ prefix, cursor, limit: 1000 });
    if (error) {
      throw new Error(`Failed to list ${bucket} objects: ${error.message}`);
    }

    for (const object of data.objects) {
      const key = object.key ?? `${prefix}${object.name}`;
      if (key.startsWith(prefix)) {
        keys.push(key);
      }
    }

    cursor = data.hasNext ? data.nextCursor : undefined;
  } while (cursor);

  const CHUNK_SIZE = 100;
  for (let i = 0; i < keys.length; i += CHUNK_SIZE) {
    const chunk = keys.slice(i, i + CHUNK_SIZE);
    const { error } = await client.storage.from(bucket).remove(chunk);
    if (error) {
      throw new Error(`Failed to remove ${bucket} objects: ${error.message}`);
    }
  }
}

/**
 * Permanently deletes the caller's own Kavanaka account: every Storage
 * object under their own `${userId}/` prefix in both post-image and
 * post-video (covers post photos, videos, video thumbnails, avatar, and
 * background — all of them live under this same prefix convention, see
 * lib/storage.ts — including any orphaned upload with no surviving
 * post_media row, since this lists real Storage objects directly rather
 * than reconstructing paths from database rows), then the auth.users row
 * itself via the Admin API, which cascades away every dependent Postgres
 * row for free (see the on delete cascade already present on every
 * user-owned table).
 *
 * The user being deleted is derived exclusively from the bearer token this
 * request carries, verified server-side against Supabase's own auth
 * service — never from anything the client sends in the request body, so
 * this endpoint can never be used to delete a different account.
 *
 * Storage cleanup runs to completion before the auth.users delete. If it
 * fails partway, the account is untouched and safe to retry from scratch —
 * nothing irreversible has happened yet. Only once Storage is confirmed
 * clean does the one genuinely irreversible step run.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    // Deliberately generic — never reveals which var is missing.
    return NextResponse.json({ error: "Account deletion isn't available right now." }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  if (!token) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Verifies the token against Supabase's own auth service (not a local
  // JWT decode) — this is the ONLY source of truth for who is being
  // deleted. The anon key is sufficient for this; it does not require
  // (and must not use) the service-role client.
  const verifyingClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await verifyingClient.auth.getUser(token);
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Your session has expired. Sign in again and retry." }, { status: 401 });
  }
  const userId = userData.user.id;

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    await removeAllUnderPrefix(adminClient, POST_IMAGE_BUCKET, `${userId}/`);
    await removeAllUnderPrefix(adminClient, POST_VIDEO_BUCKET, `${userId}/`);
  } catch {
    // Never echo the underlying error (could leak internal details) and
    // never proceed to the irreversible step — the account is fully
    // intact, so a retry from the client is always safe here.
    return NextResponse.json(
      { error: "Couldn't clean up your files. Your account was not deleted — please try again." },
      { status: 500 },
    );
  }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
  if (deleteError) {
    // Files are already gone at this point but the account still exists —
    // the one residual bad state this flow can't fully avoid without much
    // heavier distributed-transaction machinery. Told to the user plainly
    // rather than claimed as a success.
    return NextResponse.json(
      { error: "Your files were removed, but we couldn't finish deleting your account. Please contact us and try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
