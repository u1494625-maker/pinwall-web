import { deleteDraftStorage } from "@/lib/storage";
import { supabase } from "@/lib/supabase/client";
import { DEFAULT_TEXT_TEMPLATE, type TextTemplateId } from "@/lib/textTemplates";
import type { MediaType } from "@/types/post";

/**
 * Phase 2 surface only: get-or-create the caller's single media draft, and
 * insert/delete individual draft_media rows as immediate uploads succeed or
 * get removed. Text-field autosave, restoration, and publish are later
 * phases — this file deliberately doesn't touch post_drafts' text columns at
 * all yet (see getOrCreateMediaDraft below).
 */

export type NewDraftMediaInput = {
  draftId: string;
  mediaType: MediaType;
  url: string;
  storagePath: string;
  aspectRatio: string | null;
  position: number;
  /** Only ever meaningful for a photo — a video post has no per-media
   *  location concept (see useMediaComposer's VideoAsset, which carries no
   *  location field at all). Omitted/null when the item has no location yet
   *  at insert time; see updateDraftMediaLocation below for the path that
   *  persists one assigned/changed after this row already exists. */
  latitude?: number | null;
  longitude?: number | null;
};

export type DraftMedia = {
  id: number;
  draftId: string;
  mediaType: MediaType;
  url: string;
  storagePath: string;
  aspectRatio: string | null;
  position: number;
};

/** One restored draft_media row — see fetchMediaDraftForRestore below. */
export type RestoredDraftMedia = {
  id: number;
  mediaType: MediaType;
  url: string;
  storagePath: string;
  aspectRatio: string | null;
  position: number;
  thumbnailUrl: string | null;
  thumbnailStoragePath: string | null;
  location: { lat: number; lng: number } | null;
};

/** A fully restored media draft — the post_drafts row's own fields plus its
 *  draft_media rows, ordered by position. See fetchMediaDraftForRestore. */
export type RestoredMediaDraft = {
  draftId: string;
  title: string;
  caption: string;
  tags: string[];
  showOnMap: boolean;
  coords: { lat: number; lng: number } | null;
  perPhotoLocationMode: boolean;
  media: RestoredDraftMedia[];
};

type DraftPostType = "media" | "text";

async function selectDraftId(userId: string, postType: DraftPostType): Promise<string | null> {
  const { data, error } = await supabase
    .from("post_drafts")
    .select("id")
    .eq("user_id", userId)
    .eq("post_type", postType)
    .maybeSingle();

  if (error) {
    throw new Error(`Couldn't check for an existing draft: ${error.message}`);
  }
  return (data?.id as string | undefined) ?? null;
}

/**
 * Select-first, insert-only-if-absent — never a blind upsert. A user has at
 * most one draft of a given post_type at a time (enforced by post_drafts'
 * own unique(user_id, post_type) constraint — 'media' and 'text' are
 * independent slots, so a user can have one of each simultaneously); this
 * either finds that existing row or creates a fresh, otherwise-empty one.
 *
 * Race-safe across separate editor instances (two tabs, or the app and a
 * second device session), not just within one mounted composer — an
 * in-process promise cache at the call site (lib/mediaComposer.ts's
 * ensureDraftId, or TextPostEditor's own local equivalent) only ever
 * prevents a SECOND call from within the SAME instance; it can't see a
 * concurrent call from a different one. If two instances both select "no
 * draft yet" and both attempt to insert, the unique(user_id, post_type)
 * constraint lets exactly one INSERT through — the loser re-selects and
 * returns the winner's row instead of treating the conflict as a real
 * failure. Shared by getOrCreateMediaDraft/getOrCreateTextDraft below —
 * identical logic, only the post_type differs.
 */
async function getOrCreateDraft(userId: string, postType: DraftPostType): Promise<string> {
  const existingId = await selectDraftId(userId, postType);
  if (existingId) return existingId;

  const { data: created, error: insertError } = await supabase
    .from("post_drafts")
    .insert({ user_id: userId, post_type: postType })
    .select("id")
    .single();

  if (!insertError && created) {
    return created.id as string;
  }

  // Postgres unique_violation — another caller won the race and created the
  // row between our select and our insert. Not a real failure: re-select
  // and use that row instead.
  if (insertError?.code === "23505") {
    const raceWinnerId = await selectDraftId(userId, postType);
    if (raceWinnerId) return raceWinnerId;
  }

  throw new Error(`Couldn't create a draft: ${insertError?.message ?? "unknown error"}`);
}

/** Text/settings fields stay null until a later phase starts writing them —
 *  Phase 2 only ever needs the id, to use as the Storage path segment and
 *  the draft_media FK target. */
export async function getOrCreateMediaDraft(userId: string): Promise<string> {
  return getOrCreateDraft(userId, "media");
}

/** Phase 4B — TextPostEditor's counterpart. No Storage/media involved at
 *  all; only ever needs the id as the post_drafts row to write fields into. */
export async function getOrCreateTextDraft(userId: string): Promise<string> {
  return getOrCreateDraft(userId, "text");
}

/**
 * Phase 4B hardening — a fresh, uncached SELECT for the caller's existing
 * text draft. Exists specifically as a fallback for discard: a local
 * draft-id cache (TextPostEditor's own draftIdPromiseRef) can be a false
 * negative — getOrCreateTextDraft's INSERT can succeed on the server while
 * the client's own network response fails before it ever sees the id,
 * which clears that cache back to null even though a real row exists.
 * "The cache says null" is not the same claim as "a fresh SELECT confirms
 * none exists" — only the latter is safe to treat as proof for Don't
 * Save/discard. Throws on a query failure, same as selectDraftId's own
 * internal contract — never returns null to mean "unknown."
 */
export async function selectTextDraftId(userId: string): Promise<string | null> {
  return selectDraftId(userId, "text");
}

/**
 * The position a newly-uploaded item in this draft should claim next —
 * (highest existing draft_media.position for this draft) + 1, or 0 if the
 * draft has no media yet. Needed because Phase 2 can start immediate upload
 * into a draft that ALREADY has persisted draft_media rows from an earlier
 * session (Phase 4 restoration doesn't exist yet, so a freshly-opened
 * composer's local mediaItems starts empty even when the draft itself
 * isn't) — without this, a new upload would default to position 0 and
 * collide with unique(draft_id, position) the instant the draft already had
 * anything in it.
 */
export async function getNextDraftMediaPosition(draftId: string): Promise<number> {
  const { data, error } = await supabase
    .from("draft_media")
    .select("position")
    .eq("draft_id", draftId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Couldn't check existing draft media: ${error.message}`);
  }
  return data ? (data.position as number) + 1 : 0;
}

/**
 * Records one already-uploaded Storage object as belonging to a draft.
 * Called only after the Storage upload itself has already succeeded — see
 * uploadAndPersistNewItem in lib/mediaComposer.ts for the caller-side
 * rollback (delete the just-uploaded object) if this throws.
 */
export async function insertDraftMedia(input: NewDraftMediaInput): Promise<DraftMedia> {
  const { data, error } = await supabase
    .from("draft_media")
    .insert({
      draft_id: input.draftId,
      media_type: input.mediaType,
      url: input.url,
      storage_path: input.storagePath,
      aspect_ratio: input.aspectRatio,
      position: input.position,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
    })
    .select("id, draft_id, media_type, url, storage_path, aspect_ratio, position")
    .single();

  if (error || !data) {
    throw new Error(`Couldn't save this upload: ${error?.message ?? "unknown error"}`);
  }

  return {
    id: data.id as number,
    draftId: data.draft_id as string,
    mediaType: data.media_type as MediaType,
    url: data.url as string,
    storagePath: data.storage_path as string,
    aspectRatio: data.aspect_ratio as string | null,
    position: data.position as number,
  };
}

/** Removes one draft_media row — the caller is responsible for the matching
 *  Storage delete (see lib/storage.ts's deletePostMedia); this only ever
 *  touches the DB row. */
export async function deleteDraftMedia(id: number): Promise<void> {
  const { error } = await supabase.from("draft_media").delete().eq("id", id);
  if (error) {
    throw new Error(`Couldn't remove this upload record: ${error.message}`);
  }
}

/**
 * Phase 3's "Don't Save" — deletes this draft's Storage objects first, and
 * only deletes the post_drafts row (draft_media cascades) once that fully
 * succeeds. If Storage cleanup throws, this throws too and the DB row is
 * left untouched — the caller must keep the user in the composer and let
 * them retry, never delete the row while pretending the files are gone.
 * `.eq("user_id", userId)` is redundant with RLS (already owner-scoped) but
 * kept as an explicit, local ownership guard, matching this file's other
 * mutations.
 */
export async function discardMediaDraft(userId: string, draftId: string): Promise<void> {
  await deleteDraftStorage(userId, draftId);

  const { error } = await supabase.from("post_drafts").delete().eq("id", draftId).eq("user_id", userId);
  if (error) {
    throw new Error(`Couldn't discard this draft: ${error.message}`);
  }
}

/**
 * Phase 4A — persists (or clears) one already-uploaded photo's location,
 * for the case insertDraftMedia's own snapshot (taken at insert time) missed
 * because the user assigned/changed a per-photo pin after that row already
 * existed. Video has no per-media location concept, so this is only ever
 * called for a photo's draft_media id.
 */
export async function updateDraftMediaLocation(id: number, location: { lat: number; lng: number } | null): Promise<void> {
  const { error } = await supabase
    .from("draft_media")
    .update({ latitude: location?.lat ?? null, longitude: location?.lng ?? null })
    .eq("id", id);
  if (error) {
    throw new Error(`Couldn't save this photo's location: ${error.message}`);
  }
}

export type MediaDraftFieldsInput = {
  title: string;
  caption: string;
  tags: string[];
  showOnMap: boolean;
  coords: { lat: number; lng: number } | null;
  perPhotoLocationMode: boolean;
};

/**
 * Phase 4A server-side field autosave — MediaPostEditor's composer fields
 * (title/caption/tags/show_on_map/lat/lng/per_photo_location_mode), the
 * durable source now instead of lib/composerDraft.ts's localStorage (see
 * MediaPostEditor.tsx for why). `location_name` isn't included: MediaPostEditor
 * has no location-name input anywhere today (only raw coordinates), so there
 * is no value to write — the column stays null, exactly like it already does
 * for every post this composer publishes. `text_template` isn't included
 * either — that's TextPostEditor's own field; MediaPostEditor never uses it.
 *
 * Explicitly stamps updated_at = now() — post_drafts has no update trigger
 * of its own (only draft_media's insert/update/delete bumps it, via
 * touch_draft_updated_at). This function is only ever called from a
 * debounced autosave gated on "meaningful content actually changed" or from
 * Save Draft's explicit flush — never from mere restoration/mount — so every
 * call here really does represent real user activity, matching "updated_at
 * should represent meaningful user activity."
 *
 * Also explicitly clears cleanup_claimed_at (Phase 6) — this is a
 * meaningful mutation, so if the stale-draft cleanup worker had already
 * claimed this draft, that claim must not silently survive a field edit
 * that just proved the draft isn't abandoned. See
 * supabase/post_drafts_cleanup_claim.sql's own doc comment for why this
 * needs to happen here explicitly rather than via a trigger — this
 * function writes post_drafts directly, never through draft_media.
 */
export async function updateMediaDraftFields(draftId: string, fields: MediaDraftFieldsInput): Promise<void> {
  const { error } = await supabase
    .from("post_drafts")
    .update({
      title: fields.title,
      caption: fields.caption,
      tags: fields.tags,
      show_on_map: fields.showOnMap,
      latitude: fields.coords?.lat ?? null,
      longitude: fields.coords?.lng ?? null,
      per_photo_location_mode: fields.perPhotoLocationMode,
      updated_at: new Date().toISOString(),
      cleanup_claimed_at: null,
    })
    .eq("id", draftId);

  if (error) {
    throw new Error(`Couldn't save your draft: ${error.message}`);
  }
}

/**
 * Phase 4A order reconciliation — persists the final, contiguous display
 * order (0..n-1) for every already-persisted item in this draft, via the
 * reorder_draft_media RPC (supabase/post_drafts_reorder.sql). One RPC call,
 * not N client-side updates: the RPC runs as a single transaction, which is
 * what lets it actually rely on unique(draft_id, position) being deferrable
 * initially deferred — an intermediate collision mid-reorder is fine, only
 * the final state at commit needs to be unique. A no-op for an empty list
 * (nothing persisted yet to reorder).
 */
export async function reorderDraftMedia(draftId: string, orderedIds: number[]): Promise<void> {
  if (orderedIds.length === 0) return;

  const { error } = await supabase.rpc("reorder_draft_media", {
    p_draft_id: draftId,
    p_ordered_ids: orderedIds,
  });
  if (error) {
    throw new Error(`Couldn't save the media order: ${error.message}`);
  }
}

/**
 * Phase 4A restoration — looks up the caller's existing media draft (if
 * any) and its draft_media rows, ordered by position. Returns null only
 * when the SELECT genuinely found no row — a query failure throws instead
 * (see this function's callers: a thrown error must never be treated as "no
 * draft exists," since that could let the user start a second, conflicting
 * editing session while a real draft still exists server-side).
 *
 * Two plain queries, not a nested PostgREST select — matches this file's
 * existing style (selectMediaDraftId/getNextDraftMediaPosition are also
 * separate queries), and avoids depending on the embedded-resource
 * ordering option's exact spelling across supabase-js versions.
 */
export async function fetchMediaDraftForRestore(userId: string): Promise<RestoredMediaDraft | null> {
  const { data: draftRow, error: draftError } = await supabase
    .from("post_drafts")
    .select("id, title, caption, tags, show_on_map, latitude, longitude, per_photo_location_mode")
    .eq("user_id", userId)
    .eq("post_type", "media")
    .maybeSingle();

  if (draftError) {
    throw new Error(`Couldn't check for an existing draft: ${draftError.message}`);
  }
  if (!draftRow) return null;

  const { data: mediaRows, error: mediaError } = await supabase
    .from("draft_media")
    .select("id, media_type, url, storage_path, aspect_ratio, position, thumbnail_url, thumbnail_storage_path, latitude, longitude")
    .eq("draft_id", draftRow.id)
    .order("position", { ascending: true });

  if (mediaError) {
    throw new Error(`Couldn't load this draft's media: ${mediaError.message}`);
  }

  return {
    draftId: draftRow.id as string,
    title: (draftRow.title as string | null) ?? "",
    caption: (draftRow.caption as string | null) ?? "",
    tags: (draftRow.tags as string[] | null) ?? [],
    showOnMap: draftRow.show_on_map as boolean,
    coords:
      draftRow.latitude != null && draftRow.longitude != null
        ? { lat: draftRow.latitude as number, lng: draftRow.longitude as number }
        : null,
    perPhotoLocationMode: draftRow.per_photo_location_mode as boolean,
    media: (mediaRows ?? []).map((row) => ({
      id: row.id as number,
      mediaType: row.media_type as MediaType,
      url: row.url as string,
      storagePath: row.storage_path as string,
      aspectRatio: row.aspect_ratio as string | null,
      position: row.position as number,
      thumbnailUrl: row.thumbnail_url as string | null,
      thumbnailStoragePath: row.thumbnail_storage_path as string | null,
      location:
        row.latitude != null && row.longitude != null
          ? { lat: row.latitude as number, lng: row.longitude as number }
          : null,
    })),
  };
}

/**
 * Phase 4B — TextPostEditor's counterpart to MediaDraftFieldsInput/
 * updateMediaDraftFields. `location_name` isn't included: TextPostEditor,
 * like MediaPostEditor, has no location-name input anywhere today (only raw
 * coordinates) — the column stays null. `per_photo_location_mode` doesn't
 * apply here at all (no media, no per-photo anything).
 */
export type TextDraftFieldsInput = {
  title: string;
  caption: string;
  tags: string[];
  showOnMap: boolean;
  coords: { lat: number; lng: number } | null;
  textTemplate: TextTemplateId;
};

/** A fully restored text draft — the post_drafts row's own fields, no
 *  media involved at all. See fetchTextDraftForRestore below. */
export type RestoredTextDraft = {
  draftId: string;
  title: string;
  caption: string;
  tags: string[];
  showOnMap: boolean;
  coords: { lat: number; lng: number } | null;
  textTemplate: TextTemplateId;
};

/**
 * Same reasoning as updateMediaDraftFields: explicitly stamps updated_at =
 * now(), since post_drafts has no update trigger of its own for a plain
 * field write (only draft_media's own insert/update/delete bumps it, and a
 * text draft never has any draft_media rows at all). Only ever called from
 * a debounced autosave gated on "meaningful content actually changed" or
 * from Save Draft's explicit flush — never from mere restoration/mount.
 *
 * Also explicitly clears cleanup_claimed_at (Phase 6) — same reasoning as
 * updateMediaDraftFields: a field edit is meaningful activity, so any
 * in-progress cleanup claim on this draft must not survive it.
 */
export async function updateTextDraftFields(draftId: string, fields: TextDraftFieldsInput): Promise<void> {
  const { error } = await supabase
    .from("post_drafts")
    .update({
      title: fields.title,
      caption: fields.caption,
      tags: fields.tags,
      show_on_map: fields.showOnMap,
      latitude: fields.coords?.lat ?? null,
      longitude: fields.coords?.lng ?? null,
      text_template: fields.textTemplate,
      updated_at: new Date().toISOString(),
      cleanup_claimed_at: null,
    })
    .eq("id", draftId);

  if (error) {
    throw new Error(`Couldn't save your draft: ${error.message}`);
  }
}

/**
 * Phase 4B restoration — looks up the caller's existing text draft, if any.
 * Same "null only means genuinely no row, a query failure throws instead"
 * contract as fetchMediaDraftForRestore, for the same reason: the caller
 * must never treat a failed lookup as "no draft exists."
 */
export async function fetchTextDraftForRestore(userId: string): Promise<RestoredTextDraft | null> {
  const { data: draftRow, error } = await supabase
    .from("post_drafts")
    .select("id, title, caption, tags, show_on_map, latitude, longitude, text_template")
    .eq("user_id", userId)
    .eq("post_type", "text")
    .maybeSingle();

  if (error) {
    throw new Error(`Couldn't check for an existing draft: ${error.message}`);
  }
  if (!draftRow) return null;

  return {
    draftId: draftRow.id as string,
    title: (draftRow.title as string | null) ?? "",
    caption: (draftRow.caption as string | null) ?? "",
    tags: (draftRow.tags as string[] | null) ?? [],
    showOnMap: draftRow.show_on_map as boolean,
    coords:
      draftRow.latitude != null && draftRow.longitude != null
        ? { lat: draftRow.latitude as number, lng: draftRow.longitude as number }
        : null,
    textTemplate: (draftRow.text_template as TextTemplateId | null) ?? DEFAULT_TEXT_TEMPLATE,
  };
}

/**
 * Text-draft "Don't Save"/banner-discard — deliberately NOT discardMediaDraft:
 * a text draft never has draft_media rows or Storage objects (TextPostEditor
 * has no media/upload lifecycle at all), so there is nothing for
 * deleteDraftStorage to clean up — calling it would be at best a wasted
 * no-op Storage list() against a prefix that never had anything, and at
 * worst a maintenance hazard if a future text-draft feature ever DID add
 * media without updating this call site. A plain row delete is the whole
 * operation. `.eq("user_id", userId)` is redundant with RLS (already
 * owner-scoped) but kept as an explicit, local ownership guard, matching
 * this file's other mutations.
 */
export async function discardTextDraft(userId: string, draftId: string): Promise<void> {
  const { error } = await supabase.from("post_drafts").delete().eq("id", draftId).eq("user_id", userId);
  if (error) {
    throw new Error(`Couldn't discard this draft: ${error.message}`);
  }
}

/**
 * Phase 5 — converts a draft into a real, published post via the
 * publish_post_draft RPC (supabase/post_draft_publish_idempotency.sql): one
 * atomic transaction that inserts posts (+ post_media for a media draft,
 * reusing the exact same url/storage_path already sitting in draft_media —
 * no Storage upload/move/copy here or in the RPC) and deletes post_drafts
 * (draft_media cascades). Used by both MediaPostEditor and TextPostEditor —
 * one RPC, post_type inside it decides what to do, never a separate
 * publish_media_draft/publish_text_draft pair.
 *
 * Idempotent by design: calling this again with the SAME draftId — e.g. the
 * first call's transaction committed but its HTTP response never reached
 * the client — returns the SAME post id instead of creating a duplicate
 * (see posts.source_draft_id). This is deliberately the ONLY recovery
 * mechanism: on any failure, the caller's normal retry (tapping Publish
 * again) is always safe, so no separate client-side "did it actually
 * commit" check-then-recover dance is needed on top of this.
 */
export async function publishPostDraft(draftId: string): Promise<number> {
  const { data, error } = await supabase.rpc("publish_post_draft", { p_draft_id: draftId });
  if (error || data == null) {
    throw new Error(error?.message ?? "Failed to publish this post.");
  }
  return data as number;
}
