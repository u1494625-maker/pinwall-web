let pendingCapture: File | null = null;

/**
 * One-shot, in-memory handoff for a File captured directly from
 * AddPostActionSheet's camera input, bridging the client-side route
 * transition into /add/media. Never persisted (File objects aren't
 * serializable, and don't need to be here: this only survives because
 * Next.js client-side navigation keeps the same JS runtime alive, not
 * because anything is written to storage) — unrelated to lib/composerDraft.ts,
 * which deliberately never carries File objects across a reload.
 */
export function setPendingCapture(file: File): void {
  pendingCapture = file;
}

/**
 * Reads and clears the pending capture in the same step, so it can only
 * ever be consumed once — a later, unrelated mount of the composer (a
 * direct URL visit, a second /add/media navigation) never sees a stale file.
 */
export function takePendingCapture(): File | null {
  const file = pendingCapture;
  pendingCapture = null;
  return file;
}
