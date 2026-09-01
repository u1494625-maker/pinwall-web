import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Storage admin helper — takes a caller-supplied SupabaseClient
 * (never constructs its own service-role client), so this file itself
 * carries no credentials and is safe to import from any trusted
 * server-side context. Never import this from client code.
 *
 * Modeled directly on app/api/account/delete/route.ts's own
 * removeAllUnderPrefix (left untouched there — this is a fresh, identical
 * copy, not a refactor of that already-verified, irreversible-operation
 * route, to avoid any risk of regressing it). `listV2` is marked
 * @experimental in the installed storage-js version but is the only API
 * that gives a flat, delimiter-free, paginated listing of every object
 * under a prefix in one sweep — the older `list()` only lists one folder
 * level at a time. Re-verify this if the SDK is ever upgraded.
 *
 * `prefix` MUST end with "/" — this is what scopes the listing to exactly
 * one draft's own folder. Every returned key is independently re-verified
 * to start with `prefix` before being queued for deletion — defense in
 * depth beyond trusting the API's own filter alone. An already-empty
 * prefix (nothing found) is treated as success, not an error — idempotent
 * by construction: running this twice on the same prefix is always safe.
 */
export async function deleteStoragePrefix(client: SupabaseClient, bucket: string, prefix: string): Promise<void> {
  if (!prefix.endsWith("/")) {
    throw new Error("deleteStoragePrefix: prefix must end with '/'");
  }

  const keys: string[] = [];
  let cursor: string | undefined;

  do {
    const { data, error } = await client.storage.from(bucket).listV2({ prefix, cursor, limit: 1000 });
    if (error) {
      throw new Error(`Failed to list ${bucket} objects under ${prefix}: ${error.message}`);
    }

    for (const object of data.objects) {
      const key = object.key ?? `${prefix}${object.name}`;
      if (key.startsWith(prefix)) {
        keys.push(key);
      }
    }

    cursor = data.hasNext ? data.nextCursor : undefined;
  } while (cursor);

  if (keys.length === 0) return;

  const CHUNK_SIZE = 100;
  for (let i = 0; i < keys.length; i += CHUNK_SIZE) {
    const chunk = keys.slice(i, i + CHUNK_SIZE);
    const { error } = await client.storage.from(bucket).remove(chunk);
    if (error) {
      throw new Error(`Failed to remove ${bucket} objects under ${prefix}: ${error.message}`);
    }
  }
}
