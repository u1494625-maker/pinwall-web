/**
 * Lightweight, text/settings-only draft persistence for the media composer
 * (MediaPostEditor's create flow and EditPostForm's photo-edit flow) —
 * survives a page refresh so the user never loses what they typed, without
 * ever trying to persist a selected local photo/video File or Blob across
 * that refresh. A File isn't JSON-serializable and re-hydrating one from
 * localStorage/IndexedDB after a reload is a meaningfully harder, riskier
 * problem (stale handles, storage-quota blowups from a 300MB video) than
 * this feature is trying to solve — v1's answer is simply: recover the
 * text/settings, and ask the user to re-select any local media that didn't
 * survive. New-media Files are never written here at all, not even
 * transiently.
 *
 * Stored in localStorage (this app already uses it elsewhere for exactly
 * this "survive a reload, doesn't need to survive forever" purpose — see
 * lib/interactions.ts's saved-post migration flag) rather than
 * sessionStorage, because "return to an unfinished post" is explicitly
 * expected to mean later — potentially after closing and reopening the
 * tab — not just within the same tab session.
 */

export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
/** Shared by both composer entry points so the debounce feels identical
 *  everywhere autosave happens. */
export const DRAFT_AUTOSAVE_DEBOUNCE_MS = 900;

export type ComposerDraftMediaEntry = {
  /** post_media row id — never a local/new item. */
  id: number;
  location?: { lat: number; lng: number };
};

export type ComposerDraft = {
  version: 1;
  mode: "create" | "edit";
  /** Present only for mode: "edit". */
  postId?: number;
  title: string;
  caption: string;
  tags: string[];
  showOnMap: boolean;
  coords: { lat: number; lng: number } | null;
  perPhotoLocationMode: boolean;
  /** Edit only — always [] for a create draft. Array order is the saved
   *  position; an existing media id no longer present here was deleted.
   *  Deliberately carries no url/storagePath/aspectRatio/etc. — those
   *  always come from the fresh server fetch on restore, never the draft. */
  existingMediaOrder: ComposerDraftMediaEntry[];
  /** Edit only — every post_media id the server had at the moment this
   *  draft session began (captured once, never recomputed from the
   *  currently-restored composer state). Reconciliation needs this to tell
   *  apart two cases that otherwise look identical — an id missing from
   *  existingMediaOrder because the user deleted it in this session (must
   *  stay gone) vs. an id the server has now that the draft never knew
   *  about because it was added from elsewhere after this draft was first
   *  saved (must be shown, not silently dropped). Always [] for create. */
  knownServerMediaIds: number[];
  /** True if, at last autosave, mediaItems contained at least one
   *  not-yet-uploaded local file — the signal for showing "please
   *  re-select your media" after a restore. */
  hasUnsavedLocalMedia: boolean;
  savedAt: number;
};

export function draftKeyForCreate(): string {
  return "pinwall_draft_create";
}

export function draftKeyForEdit(postId: number): string {
  return `pinwall_draft_edit_${postId}`;
}

export function saveDraft(key: string, draft: ComposerDraft): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Ignore storage failures (e.g. private browsing quota) — same
    // best-effort convention already used for sessionStorage elsewhere
    // (lib/map/viewport.ts). Losing the draft silently is strictly no
    // worse than this feature not existing at all.
  }
}

function isComposerDraft(value: unknown): value is ComposerDraft {
  if (typeof value !== "object" || value === null) return false;
  const draft = value as Partial<ComposerDraft>;
  return (
    draft.version === 1 &&
    (draft.mode === "create" || draft.mode === "edit") &&
    typeof draft.title === "string" &&
    typeof draft.caption === "string" &&
    Array.isArray(draft.tags) &&
    typeof draft.showOnMap === "boolean" &&
    typeof draft.perPhotoLocationMode === "boolean" &&
    Array.isArray(draft.existingMediaOrder) &&
    Array.isArray(draft.knownServerMediaIds) &&
    typeof draft.hasUnsavedLocalMedia === "boolean" &&
    typeof draft.savedAt === "number"
  );
}

/** Reads a draft only if it parses correctly and hasn't expired — an
 *  expired or malformed entry is treated exactly like "no draft" (and is
 *  removed on the spot, so it isn't re-checked on every future mount). */
export function loadDraft(key: string, ttlMs: number = DRAFT_TTL_MS): ComposerDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!isComposerDraft(parsed)) {
      window.localStorage.removeItem(key);
      return null;
    }

    if (Date.now() - parsed.savedAt > ttlMs) {
      window.localStorage.removeItem(key);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore — same best-effort convention as saveDraft above.
  }
}
