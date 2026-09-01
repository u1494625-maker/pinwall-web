"use client";

import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import ComposerBottomBar from "@/components/add/ComposerBottomBar";
import { ComposerLoadingState, ComposerRestorationError } from "@/components/add/ComposerRestorationStates";
import ComposerTopBar from "@/components/add/ComposerTopBar";
import DraftRestoredBanner from "@/components/add/DraftRestoredBanner";
import ExitDraftSheet from "@/components/add/ExitDraftSheet";
import MediaComposerFields from "@/components/add/MediaComposerFields";
import { useAuth } from "@/lib/auth/AuthProvider";
import { DRAFT_AUTOSAVE_DEBOUNCE_MS } from "@/lib/composerDraft";
import { useMediaComposer, type VideoAsset } from "@/lib/mediaComposer";
import { takePendingCapture } from "@/lib/pendingCapture";
import {
  discardMediaDraft,
  fetchMediaDraftForRestore,
  publishPostDraft,
  reorderDraftMedia,
  updateMediaDraftFields,
  type RestoredMediaDraft,
} from "@/lib/postDrafts";

type MediaPostEditorProps = {
  /** How the user entered this editor — decides which file picker flavor to auto-open. */
  initialSource: "album" | "camera" | null;
};

/**
 * Outer wrapper — Phase 4A restoration gate. Looks up the caller's existing
 * media draft (if any) before rendering anything interactive at all, so
 * normal editing can never start before restoration resolves (see
 * MediaPostEditorForm's own doc comment for why: seeding useMediaComposer's
 * initial state correctly requires restoration to already be resolved by
 * the time that hook first runs, not patched in afterward). A query FAILURE
 * (network/DB error) is never treated as "no draft exists" — that could let
 * the user start a second, conflicting editing session while a real one
 * still exists server-side — it shows a retry state instead and never
 * mounts the form.
 */
export default function MediaPostEditor({ initialSource }: MediaPostEditorProps) {
  const { user } = useAuth();
  const userId = user?.id;
  const [restoration, setRestoration] = useState<
    { status: "loading" } | { status: "none" } | { status: "found"; draft: RestoredMediaDraft } | { status: "error"; message: string }
  >({ status: "loading" });
  const [retryToken, setRetryToken] = useState(0);
  // Bumped to force MediaPostEditorForm to remount from scratch after the
  // restoration banner's Discard succeeds — the simplest way back to a
  // truly empty composer without manually resetting a dozen pieces of local
  // state, matching this app's existing "changing key remounts" convention
  // (see DeleteAccountSheet's own doc comment).
  const [formInstanceKey, setFormInstanceKey] = useState(0);

  // The initial `restoration` state above already covers the very first
  // mount's loading state — a retry (see ComposerRestorationError below)
  // resets it back to "loading" itself, from its own click handler, before
  // bumping retryToken, so this effect body only ever needs to run the fetch
  // and report its outcome, never synchronously reset state on its own.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchMediaDraftForRestore(userId)
      .then((draft) => {
        if (cancelled) return;
        setRestoration(draft ? { status: "found", draft } : { status: "none" });
      })
      .catch((err) => {
        if (cancelled) return;
        setRestoration({ status: "error", message: err instanceof Error ? err.message : "Couldn't load your draft." });
      });
    return () => {
      cancelled = true;
    };
  }, [userId, retryToken]);

  if (restoration.status === "loading") {
    return <ComposerLoadingState />;
  }
  if (restoration.status === "error") {
    return (
      <ComposerRestorationError
        message={restoration.message}
        onRetry={() => {
          setRestoration({ status: "loading" });
          setRetryToken((t) => t + 1);
        }}
      />
    );
  }

  return (
    <MediaPostEditorForm
      key={formInstanceKey}
      initialSource={initialSource}
      restoredDraft={restoration.status === "found" ? restoration.draft : null}
      onDiscardedRestoredDraft={() => {
        setRestoration({ status: "none" });
        setFormInstanceKey((k) => k + 1);
      }}
    />
  );
}

type MediaPostEditorFormProps = MediaPostEditorProps & {
  restoredDraft: RestoredMediaDraft | null;
  onDiscardedRestoredDraft: () => void;
};

/** Shared by both the "Choose from album" and "Camera" entries in the Add action sheet. */
function MediaPostEditorForm({ initialSource, restoredDraft, onDiscardedRestoredDraft }: MediaPostEditorFormProps) {
  const router = useRouter();
  const { user } = useAuth();
  const hasAutoOpenedRef = useRef(false);

  // Never reassigned after mount — the only way the banner ever disappears
  // is a successful discard, which remounts this whole component fresh (via
  // the outer MediaPostEditor's changing key), not a local state flip.
  const showDraftBanner = restoredDraft !== null;
  const [isDiscardingBanner, setIsDiscardingBanner] = useState(false);

  const [title, setTitle] = useState(() => restoredDraft?.title ?? "");
  const [caption, setCaption] = useState(() => restoredDraft?.caption ?? "");
  const [tags, setTags] = useState<string[]>(() => restoredDraft?.tags ?? []);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Drives the submit button's label across Publish's phases — Phase 5's
  // publish never uploads anything itself (media already uploaded via
  // Phase 2's immediate upload), so this no longer tracks upload progress at
  // all; it just distinguishes "waiting for a still-in-flight upload to
  // settle" from "writing the final draft state and calling publish."
  const [stage, setStage] = useState<"finishing-uploads" | "saving" | null>(null);

  // Phase 3 exit-confirmation sheet — see attemptExit below for when it opens.
  const [isExitSheetOpen, setIsExitSheetOpen] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [exitError, setExitError] = useState<string | null>(null);

  const restoredPhotoItems = restoredDraft
    ? restoredDraft.media
        .filter((m) => m.mediaType === "image")
        .map((m) => ({
          id: m.id,
          type: m.mediaType,
          url: m.url,
          storagePath: m.storagePath,
          aspectRatio: m.aspectRatio,
          thumbnailUrl: m.thumbnailUrl ?? undefined,
          thumbnailStoragePath: m.thumbnailStoragePath ?? undefined,
          location: m.location ?? undefined,
        }))
    : [];
  const restoredVideoRow = restoredDraft?.media.find((m) => m.mediaType === "video") ?? null;
  const restoredVideo: VideoAsset | undefined = restoredVideoRow
    ? { kind: "draft", id: restoredVideoRow.id, url: restoredVideoRow.url, storagePath: restoredVideoRow.storagePath }
    : undefined;

  const composer = useMediaComposer({
    initialDraftItems: restoredPhotoItems,
    initialVideo: restoredVideo,
    initialShowOnMap: restoredDraft?.showOnMap ?? false,
    initialCoords: restoredDraft?.coords ?? null,
    initialPerPhotoLocationMode: restoredDraft?.perPhotoLocationMode,
    initialDraftId: restoredDraft?.draftId,
    // Phase 2: media uploads immediately to a persisted draft as soon as
    // it's selected, instead of only at Publish. EditPostForm never sets
    // this, so its own upload-at-submit behavior is unaffected.
    userId: user?.id,
    enableImmediateUpload: true,
  });
  const {
    fileInputRef,
    mediaItems,
    mode,
    showOnMap,
    coords,
    perPhotoLocationMode,
    selectedLocationKeys,
    error,
    setError,
    isConvertingHeic,
    showAddMoreTile,
    handleMediaChange,
    handleMediaFiles,
    handleRemoveMedia,
    handleMoveMedia,
    handleRetryMedia,
    handleToggleShowOnMap,
    handleTogglePerPhotoLocationMode,
    handleTogglePhotoSelection,
    handleSetLocationForSelectedPhotos,
    handleClearLocationForSelectedPhotos,
    setCoords,
    video,
    videoInputRef,
    handleVideoChange,
    handleRemoveVideo,
    handleRetryVideo,
    resolveDraftIdIfStarted,
    prepareForDiscard,
    ensureDraftId,
    awaitActiveUploads,
    awaitPendingLocationWrites,
    mediaItemsRef,
    videoRef,
  } = composer;

  // Centralized "is there anything worth prompting about" check — derived
  // from the CURRENT editor state (never from whether the component merely
  // mounted, or whether a post_drafts row happens to exist). Also true
  // immediately on mount when a restored draft's initial values are
  // themselves non-empty — that's real content that would be lost, exactly
  // as if the user had just typed it. This is also what gates the server
  // field autosave below from creating a draft merely because the composer
  // mounted with empty fields (see its own comment).
  const hasMeaningfulContent =
    title.trim().length > 0 ||
    caption.trim().length > 0 ||
    tags.length > 0 ||
    mediaItems.length > 0 ||
    video !== null ||
    showOnMap ||
    coords !== null;

  // Consumes a File already captured inside AddPostActionSheet (see
  // lib/pendingCapture.ts) before this page ever mounted -- fed directly
  // into handleMediaFiles, the same shared pipeline handleMediaChange's own
  // <input onChange> delegates to, so mode-locking/HEIC/optimization/limits
  // are never duplicated. Only ever attempted for initialSource === "camera"
  // -- an "album" or direct/unspecified mount must never consume a stale
  // pending camera File left over from an earlier flow. Falls back to the
  // old auto-click when nothing was handed off (a direct/stale
  // /add/media?source=camera visit) -- "album" behavior is unchanged. Safe
  // to run after restoration (this component doesn't mount until
  // restoration resolves, see MediaPostEditor above) — a restored video
  // draft correctly rejects an incoming photo via handleMediaFiles' own
  // existing mode-lock, surfaced through the normal error state.
  useEffect(() => {
    if (hasAutoOpenedRef.current) return;
    hasAutoOpenedRef.current = true;

    if (initialSource === "camera") {
      const pendingFile = takePendingCapture();
      if (pendingFile) {
        void handleMediaFiles([pendingFile]);
        return;
      }
      fileInputRef.current?.click();
      return;
    }

    if (initialSource === "album") {
      fileInputRef.current?.click();
    }
  }, [initialSource, fileInputRef, handleMediaFiles]);

  const fieldFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const orderFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelPendingFieldFlush() {
    if (fieldFlushTimerRef.current) {
      clearTimeout(fieldFlushTimerRef.current);
      fieldFlushTimerRef.current = null;
    }
  }
  function cancelPendingOrderFlush() {
    if (orderFlushTimerRef.current) {
      clearTimeout(orderFlushTimerRef.current);
      orderFlushTimerRef.current = null;
    }
  }

  /** Ensures a draft exists (the SAME get-or-create mechanism uploads
   *  already use — never a second draft-creation path) and writes the
   *  current text/settings fields to it. Throws on failure — callers decide
   *  whether to swallow (background autosave) or surface (Save Draft). */
  async function flushDraftFields(): Promise<void> {
    if (!user) return;
    const draftId = await ensureDraftId();
    await updateMediaDraftFields(draftId, { title, caption, tags, showOnMap, coords, perPhotoLocationMode });
  }

  /** Persists the final, contiguous display order for every already-
   *  persisted item (a still-uploading item has no draft_media id yet, so
   *  it's simply excluded — its own eventual insert claims its position via
   *  the existing claimNextPosition, independent of this). A no-op when
   *  nothing is persisted yet.
   *
   * Reads mediaItemsRef.current, not the mediaItems closure variable —
   * required for Save Draft's sequence (see handleSaveDraftAndExit): after
   * awaiting awaitActiveUploads(), an upload that just settled has updated
   * state via setMediaItems, but THIS function's own caller is an
   * already-running closure from before that update — only the ref reflects
   * it. Reading the ref here too (rather than only in a Save-Draft-specific
   * copy) means the background debounce below gets the same correctness for
   * free, and there is only one implementation of "what order to send." */
  async function flushDraftMediaOrder(): Promise<void> {
    if (!user) return;
    const orderedIds = mediaItemsRef.current
      .map((item) => (item.kind === "draft" ? item.id : item.kind === "new" ? item.draftMediaId : undefined))
      .filter((id): id is number => id != null);
    if (orderedIds.length === 0) return;
    const draftId = await ensureDraftId();
    await reorderDraftMedia(draftId, orderedIds);
  }

  // Server-side field autosave — the durable source of truth for
  // MediaPostEditor's draft fields now (see this file's own notes on
  // removing the lib/composerDraft.ts localStorage dependency: keeping both
  // active would create two competing sources of truth for the same data).
  // Debounced, and gated on hasMeaningfulContent so this can never create a
  // draft merely because the composer mounted — only once a tracked field
  // is genuinely non-empty does the first tick fire. Deps deliberately
  // exclude mediaItems/video: an upload status transition alone must not
  // rewrite unchanged title/caption/etc. (see the separate order-autosave
  // effect below for that). Background failures are swallowed — self-heals
  // on the next tick; Save Draft's own explicit flush surfaces a failure
  // instead, since that's the one the user is relying on succeeding.
  useEffect(() => {
    if (isSubmitting || !hasMeaningfulContent) return;
    cancelPendingFieldFlush();
    fieldFlushTimerRef.current = setTimeout(() => {
      void flushDraftFields().catch(() => {});
    }, DRAFT_AUTOSAVE_DEBOUNCE_MS);
    return cancelPendingFieldFlush;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, caption, tags, showOnMap, coords, perPhotoLocationMode, isSubmitting]);

  // Media-order autosave — a SEPARATE debounce from the field autosave above
  // so a reorder never also rewrites unrelated, unchanged title/caption/etc.
  // (and vice versa) — "do not write unchanged values unnecessarily."
  // signature is a plain string of persisted-item ids in display order, not
  // the mediaItems array reference itself: an upload STATUS change alone
  // (uploading -> uploaded) only changes this once that item's id first
  // joins the sequence, not on every unrelated re-render.
  const mediaOrderSignature = mediaItems
    .map((item) => (item.kind === "draft" ? item.id : item.kind === "new" ? item.draftMediaId : null))
    .filter((id): id is number => id != null)
    .join(",");

  // Skipped entirely while anything is actively uploading — the simpler of
  // two acceptable options (vs. letting a doomed attempt fail and rely on
  // the signature changing again once the upload settles). Without this, a
  // background tick could compute an order that EXCLUDES a photo whose
  // upload finishes moments later: reorder_draft_media would then see more
  // draft_media rows than ids supplied and reject the whole call (its own
  // count guard — see supabase/post_drafts_reorder.sql) once that insert
  // lands before the RPC actually runs server-side. Harmless either way (the
  // RPC is all-or-nothing, so a rejected attempt leaves positions
  // untouched), but skipping avoids the doomed round-trip outright, and is
  // simpler to reason about than proving the self-heal always fires. Save
  // Draft's own explicit flush (after awaitActiveUploads) is the actual
  // guarantee — this is background-only, best-effort, and freely skippable.
  const hasActiveUpload =
    mediaItems.some((item) => item.kind === "new" && item.uploadStatus === "uploading") ||
    (video?.kind === "new" && video.uploadStatus === "uploading");

  useEffect(() => {
    if (isSubmitting || mediaOrderSignature === "" || hasActiveUpload) return;
    cancelPendingOrderFlush();
    orderFlushTimerRef.current = setTimeout(() => {
      void flushDraftMediaOrder().catch(() => {});
    }, DRAFT_AUTOSAVE_DEBOUNCE_MS);
    return cancelPendingOrderFlush;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaOrderSignature, isSubmitting, hasActiveUpload]);

  // The single entry point for every controlled exit this composer can
  // reliably intercept (Cancel tap, Android hardware back — see the
  // backButton effect below). Untouched/empty composer: leave immediately,
  // exactly like today's plain Cancel — never shows a prompt just because
  // the component mounted or a post_drafts row happens to exist. Otherwise
  // opens the Save Draft / Don't Save sheet instead of leaving directly.
  function attemptExit() {
    if (!hasMeaningfulContent) {
      cancelPendingFieldFlush();
      cancelPendingOrderFlush();
      router.push("/");
      return;
    }
    setExitError(null);
    setIsExitSheetOpen(true);
  }

  // Keeps a stable ref to the latest attemptExit for the native backButton
  // listener below, which is registered once on mount — re-registering a
  // Capacitor listener on every render would be wasteful churn for no
  // benefit, since only the callback's closure needs to stay current.
  const attemptExitRef = useRef(attemptExit);
  useEffect(() => {
    attemptExitRef.current = attemptExit;
  });

  // Android hardware back button — scoped strictly to this component's own
  // mount/unmount lifecycle (registered here, not globally), so it can never
  // affect back-button behavior anywhere else in the app. Registering any
  // 'backButton' listener suppresses Capacitor's own default handling for as
  // long as it's registered, so attemptExit is fully responsible for what
  // happens next (leave directly, or show the sheet) — there's no "let the
  // default happen" fallthrough to opt back into.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listenerPromise = CapacitorApp.addListener("backButton", () => {
      attemptExitRef.current();
    });
    return () => {
      listenerPromise.then((listener) => listener.remove());
    };
  }, []);

  // Browser tab close / refresh / external navigation: the one exit path
  // this composer cannot reliably intercept with a custom UI (no browser
  // supports a custom beforeunload dialog anymore, generic prompt only) —
  // and doesn't need to, since media is already durable (Phase 2) and
  // text/settings are now durable too (server field autosave above, at most
  // one debounce interval behind). This only asks the browser to show its
  // native confirmation; it never discards anything itself either way.
  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasMeaningfulContent) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasMeaningfulContent]);

  // Save Draft (Phase 4A hardening — revised sequence):
  //   1. disable duplicate taps (isExiting)
  //   2. cancel pending debounce timers
  //   3. awaitActiveUploads() — let every currently-uploading item settle
  //      normally (never neutralized like prepareForDiscard does; nothing
  //      here is being deleted)
  //   4. verify nothing settled into "error" — if it did, stop: an order
  //      computed while an item is stuck in error is not "complete," and
  //      publishing that order as final would silently misrepresent what's
  //      actually in the draft
  //   5. flushDraftFields()
  //   6. flushDraftMediaOrder() — reads mediaItemsRef, not the mediaItems
  //      closure, so it reflects whatever awaitActiveUploads() just settled,
  //      not whatever was true when this function started running
  //   7. navigate away, only once both DB writes above actually succeeded
  //
  // This replaces the earlier Phase 3 conclusion that Save Draft never
  // needs to wait for uploads — that held for the media/text persistence
  // itself (still true: an upload's OWN Storage/DB write finishes correctly
  // after unmount, independent of this component), but final order
  // reconciliation is different: reorder_draft_media needs the complete set
  // of ids at the moment it's called, and computing that from a stale
  // snapshot (or from an item still mid-upload, with no id yet) either
  // omits a row or races an insert that lands between computing the list
  // and the RPC actually running — see mediaOrderSignature's own doc
  // comment above for the matching background-autosave fix.
  async function handleSaveDraftAndExit() {
    setIsExiting(true);
    setExitError(null);
    try {
      cancelPendingFieldFlush();
      cancelPendingOrderFlush();
      await awaitActiveUploads();

      const hasErroredMedia = mediaItemsRef.current.some(
        (item) => item.kind === "new" && item.uploadStatus === "error",
      );
      const settledVideo = videoRef.current;
      const hasErroredVideo = settledVideo?.kind === "new" && settledVideo.uploadStatus === "error";
      if (hasErroredMedia || hasErroredVideo) {
        setExitError("Some media couldn't be uploaded. Retry or remove it, then try saving again.");
        setIsExiting(false);
        return;
      }

      await flushDraftFields();
      await flushDraftMediaOrder();
      router.push("/");
    } catch (err) {
      setExitError(err instanceof Error ? err.message : "Couldn't save your draft. Try again.");
      setIsExiting(false);
    }
  }

  // Don't Save: discards the server draft (Storage objects, then the
  // post_drafts row — see discardMediaDraft).
  //
  // prepareForDiscard() runs FIRST and is awaited to completion before
  // anything is deleted — it's what guarantees no upload still in flight
  // when the user tapped Don't Save can later finish and create a new
  // Storage object under this draft's prefix after cleanup has already
  // begun (see its own doc comment in lib/mediaComposer.ts). Only once
  // every upload has settled is it safe to read resolveDraftIdIfStarted():
  // by that point draftIdPromiseRef is guaranteed to be either null (no
  // draft was ever created — nothing server-side to discard, no server call
  // made at all) or a resolved id for a draft that genuinely exists — never
  // a still-pending or still-rejected promise. Stays in the composer with a
  // visible error on failure, so a partial discard can never be mistaken
  // for a complete one.
  async function handleDontSaveAndExit() {
    setIsExiting(true);
    setExitError(null);
    try {
      cancelPendingFieldFlush();
      cancelPendingOrderFlush();
      await prepareForDiscard();
      if (user) {
        const pendingDraftId = await resolveDraftIdIfStarted();
        if (pendingDraftId) {
          await discardMediaDraft(user.id, pendingDraftId);
        }
      }
      router.push("/");
    } catch (err) {
      setExitError(err instanceof Error ? err.message : "Couldn't discard this draft. Try again.");
      setIsExiting(false);
    }
  }

  // Restoration banner's Discard — same safe discard flow as Don't Save
  // (prepareForDiscard -> Storage cleanup -> post_drafts delete), never a
  // second implementation. Unlike Don't Save, this stays ON the page: the
  // outer MediaPostEditor remounts this whole component fresh (via a
  // changing key) once discard succeeds, the simplest way back to a truly
  // empty composer without manually resetting every piece of local state.
  async function handleDiscardRestoredDraft() {
    if (isDiscardingBanner) return;
    setIsDiscardingBanner(true);
    setError(null);
    try {
      cancelPendingFieldFlush();
      cancelPendingOrderFlush();
      await prepareForDiscard();
      if (user) {
        const pendingDraftId = await resolveDraftIdIfStarted();
        if (pendingDraftId) {
          await discardMediaDraft(user.id, pendingDraftId);
        }
      }
      onDiscardedRestoredDraft();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't discard this draft. Try again.");
      setIsDiscardingBanner(false);
    }
  }

  // Phase 5 publish — replaces the old "re-upload everything, addPost(),
  // leave the draft behind" path entirely. Media already uploaded once via
  // Phase 2's immediate upload; this never touches Storage at all, it just
  // asks publish_post_draft to atomically turn the existing draft into a
  // real post, reusing the exact same url/storage_path draft_media already
  // has. Sequence:
  //   1. disable duplicate taps (isSubmitting)
  //   2. cancel pending field/order debounce timers
  //   3. awaitActiveUploads() — let anything still uploading settle normally
  //   4. inspect mediaItemsRef/videoRef AFTER that await (not the possibly-
  //      stale mediaItems/video closure)
  //   5. if anything settled into "error": stop, surface a retryable error
  //   6. verify every VISIBLE item actually has a persisted draft_media id —
  //      stronger than publish_post_draft's own "count > 0" check, and
  //      catches a case that check can't (something on screen that isn't
  //      durably backed for any reason)
  //   7. awaitPendingLocationWrites() — a per-photo pin changed moments ago
  //      must be persisted before publish reads draft_media, not still in
  //      flight
  //   8. flush latest draft fields
  //   9. flush the final, complete, contiguous media order
  //  10. publishPostDraft(draftId) — the one atomic RPC call
  //
  // publishPostDraft is idempotent (see its own doc comment): on ANY
  // failure here, the composer just stays open with an error and the
  // Publish button re-enables — tapping it again safely recovers whether or
  // not the previous attempt's transaction actually committed. No separate
  // client-side "did it commit" check is needed on top of that.
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // If the session drops mid-edit, RequireAuth swaps this whole page to
    // LoginScreen on its own — this guard just protects the submit itself.
    if (!user) return;

    if (!title.trim() || !caption.trim()) {
      setError("Add a title and caption before publishing.");
      return;
    }

    if (mode === null) {
      setError("Choose at least one photo or video before publishing.");
      return;
    }

    if (!perPhotoLocationMode && showOnMap && !coords) {
      setError("Choose a location on the map before publishing.");
      return;
    }

    setIsSubmitting(true);
    cancelPendingFieldFlush();
    cancelPendingOrderFlush();

    try {
      setStage("finishing-uploads");
      await awaitActiveUploads();

      const settledItems = mediaItemsRef.current;
      const settledVideo = videoRef.current;

      const hasErroredMedia = settledItems.some((item) => item.kind === "new" && item.uploadStatus === "error");
      const hasErroredVideo = settledVideo?.kind === "new" && settledVideo.uploadStatus === "error";
      if (hasErroredMedia || hasErroredVideo) {
        setError("Some media couldn't be uploaded. Retry or remove it, then try publishing again.");
        setIsSubmitting(false);
        setStage(null);
        return;
      }

      const photosFullyPersisted =
        mode !== "photo" ||
        settledItems.every((item) => item.kind === "draft" || (item.kind === "new" && item.draftMediaId != null));
      const videoFullyPersisted =
        mode !== "video" ||
        settledVideo?.kind === "draft" ||
        (settledVideo?.kind === "new" && settledVideo.uploadStatus === "uploaded" && settledVideo.draftMediaId != null);
      if (!photosFullyPersisted || !videoFullyPersisted) {
        setError("Some media hasn't finished saving yet. Try again in a moment.");
        setIsSubmitting(false);
        setStage(null);
        return;
      }

      setStage("saving");
      await awaitPendingLocationWrites();
      const draftId = await ensureDraftId();
      await flushDraftFields();
      if (mode === "photo") {
        await flushDraftMediaOrder();
      }

      await publishPostDraft(draftId);

      // post_drafts is gone (deleted by the RPC's own transaction,
      // draft_media cascaded with it) — reopening this composer will no
      // longer show a "Draft restored" banner for it. Storage is untouched:
      // the exact same objects draft_media already pointed at now belong to
      // this post's post_media rows instead.
      router.replace("/me");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setIsSubmitting(false);
      setStage(null);
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-28 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <ComposerTopBar onCancel={attemptExit} />

      <form onSubmit={handleSubmit} className="space-y-5 px-5 pt-4">
        {showDraftBanner ? (
          <DraftRestoredBanner
            needsMediaReselect={false}
            isDiscarding={isDiscardingBanner}
            onDiscard={() => void handleDiscardRestoredDraft()}
          />
        ) : null}

        <MediaComposerFields
          fileInputRef={fileInputRef}
          mediaItems={mediaItems}
          mode={mode}
          showAddMoreTile={showAddMoreTile}
          isConvertingHeic={isConvertingHeic}
          onMediaChange={handleMediaChange}
          onRemoveMedia={handleRemoveMedia}
          onMoveMedia={handleMoveMedia}
          onRetryMedia={handleRetryMedia}
          captureEnvironment={initialSource === "camera"}
          video={video}
          videoInputRef={videoInputRef}
          onVideoChange={handleVideoChange}
          onRemoveVideo={handleRemoveVideo}
          onRetryVideo={handleRetryVideo}
          title={title}
          onTitleChange={setTitle}
          caption={caption}
          onCaptionChange={setCaption}
          tags={tags}
          onTagsChange={setTags}
          showOnMap={showOnMap}
          onToggleShowOnMap={handleToggleShowOnMap}
          coords={coords}
          onCoordsChange={setCoords}
          perPhotoLocationMode={perPhotoLocationMode}
          onTogglePerPhotoLocationMode={handleTogglePerPhotoLocationMode}
          selectedLocationKeys={selectedLocationKeys}
          onTogglePhotoSelection={handleTogglePhotoSelection}
          onSetLocationForSelected={handleSetLocationForSelectedPhotos}
          onClearLocationForSelected={handleClearLocationForSelectedPhotos}
        />

        <ComposerBottomBar
          isSubmitting={isSubmitting}
          error={error}
          submittingLabel={
            stage === "finishing-uploads" ? "Finishing uploads…" : stage === "saving" ? "Saving post…" : "Publishing…"
          }
        />
      </form>

      <ExitDraftSheet
        open={isExitSheetOpen}
        isBusy={isExiting}
        error={exitError}
        onSaveDraft={handleSaveDraftAndExit}
        onDontSave={handleDontSaveAndExit}
        onStay={() => {
          if (isExiting) return;
          setIsExitSheetOpen(false);
        }}
      />
    </main>
  );
}
