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
import PostLocationFields from "@/components/add/PostLocationFields";
import TagChipInput from "@/components/add/TagChipInput";
import TextTemplatePicker from "@/components/add/TextTemplatePicker";
import TitleField from "@/components/add/TitleField";
import { useAuth } from "@/lib/auth/AuthProvider";
import { DRAFT_AUTOSAVE_DEBOUNCE_MS } from "@/lib/composerDraft";
import {
  discardTextDraft,
  fetchTextDraftForRestore,
  getOrCreateTextDraft,
  publishPostDraft,
  selectTextDraftId,
  updateTextDraftFields,
  type RestoredTextDraft,
} from "@/lib/postDrafts";
import { DEFAULT_TEXT_TEMPLATE, type TextTemplateId } from "@/lib/textTemplates";

/**
 * Outer wrapper — Phase 4B restoration gate, same principle as
 * MediaPostEditor's own outer component: look up the caller's existing text
 * draft (post_type = 'text') before rendering anything interactive, so
 * TextPostEditorForm's useState lazy initializers always see the correct
 * restored (or genuinely absent) state on their very first render, and
 * normal editing can never start before restoration resolves. A query
 * FAILURE is never treated as "no draft exists" — it shows a retry state
 * instead and never mounts the form, exactly like MediaPostEditor.
 */
export default function TextPostEditor() {
  const { user } = useAuth();
  const userId = user?.id;
  const [restoration, setRestoration] = useState<
    { status: "loading" } | { status: "none" } | { status: "found"; draft: RestoredTextDraft } | { status: "error"; message: string }
  >({ status: "loading" });
  const [retryToken, setRetryToken] = useState(0);
  // Bumped to force TextPostEditorForm to remount from scratch after the
  // restoration banner's Discard succeeds — same "changing key remounts"
  // convention MediaPostEditor already uses for the identical situation.
  const [formInstanceKey, setFormInstanceKey] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchTextDraftForRestore(userId)
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
    <TextPostEditorForm
      key={formInstanceKey}
      restoredDraft={restoration.status === "found" ? restoration.draft : null}
      onDiscardedRestoredDraft={() => {
        setRestoration({ status: "none" });
        setFormInstanceKey((k) => k + 1);
      }}
    />
  );
}

type TextPostEditorFormProps = {
  restoredDraft: RestoredTextDraft | null;
  onDiscardedRestoredDraft: () => void;
};

function TextPostEditorForm({ restoredDraft, onDiscardedRestoredDraft }: TextPostEditorFormProps) {
  const router = useRouter();
  const { user } = useAuth();

  // Never reassigned after mount — same reasoning as MediaPostEditor's
  // identical field: the only way this banner ever disappears is a
  // successful discard, which remounts this whole component fresh (via the
  // outer TextPostEditor's changing key), not a local state flip.
  const showDraftBanner = restoredDraft !== null;
  const [isDiscardingBanner, setIsDiscardingBanner] = useState(false);

  const [title, setTitle] = useState(() => restoredDraft?.title ?? "");
  const [caption, setCaption] = useState(() => restoredDraft?.caption ?? "");
  const [template, setTemplate] = useState<TextTemplateId>(() => restoredDraft?.textTemplate ?? DEFAULT_TEXT_TEMPLATE);
  const [tags, setTags] = useState<string[]>(() => restoredDraft?.tags ?? []);
  const [showOnMap, setShowOnMap] = useState(() => restoredDraft?.showOnMap ?? false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(() => restoredDraft?.coords ?? null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Phase 3-pattern exit-confirmation sheet — see attemptExit below.
  const [isExitSheetOpen, setIsExitSheetOpen] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [exitError, setExitError] = useState<string | null>(null);

  // Draft-id caching, mirroring lib/mediaComposer.ts's ensureDraftId exactly
  // (including the rejection-clearing fix): a text draft has no upload
  // lifecycle to hang this off of the way MediaPostEditor hangs it off
  // useMediaComposer, so it lives here directly rather than inventing a
  // shared hook for what would otherwise be its only other consumer.
  // Pre-seeded with an ALREADY-RESOLVED promise when restoring an existing
  // draft, so resolveDraftIdIfStarted (used by Don't Save / banner discard)
  // correctly reports "yes, a draft exists" from the very first render,
  // before any field has been touched this session.
  const draftIdPromiseRef = useRef<Promise<string> | null>(restoredDraft ? Promise.resolve(restoredDraft.draftId) : null);
  function ensureDraftId(): Promise<string> {
    if (!draftIdPromiseRef.current) {
      const promise = user ? getOrCreateTextDraft(user.id) : Promise.reject(new Error("Not signed in."));
      draftIdPromiseRef.current = promise;
      promise.catch(() => {
        if (draftIdPromiseRef.current === promise) {
          draftIdPromiseRef.current = null;
        }
      });
    }
    return draftIdPromiseRef.current;
  }
  /** Resolves to this draft's id if one was actually created/restored this
   *  session, or null if it wasn't — never calls ensureDraftId() itself, so
   *  checking can never create a draft merely by being called. */
  function resolveDraftIdIfStarted(): Promise<string | null> {
    return draftIdPromiseRef.current ?? Promise.resolve(null);
  }

  /**
   * The definitive answer to "does a server text draft exist right now,"
   * used only by discard (Don't Save / restoration banner Discard) — never
   * by autosave, which should keep trusting the cache. resolveDraftIdIfStarted's
   * local cache can be a false negative: getOrCreateTextDraft's INSERT can
   * succeed on the server while the client's own network response fails
   * before it ever sees the id, which clears draftIdPromiseRef back to null
   * (see ensureDraftId's rejection-handling above) even though a real row
   * exists. "The cache says null" is not proof of "nothing exists" — only a
   * fresh SELECT is. Falls back to exactly one such SELECT only when the
   * cache is empty; if that SELECT itself throws, this throws too (never
   * swallowed into a false "no draft"), and the caller's existing try/catch
   * keeps the user in the composer with a retryable error.
   */
  async function resolveTextDraftIdForDiscard(): Promise<string | null> {
    const cached = await resolveDraftIdIfStarted();
    if (cached) return cached;
    if (!user) return null;
    return selectTextDraftId(user.id);
  }

  // Centralized "is there anything worth prompting about" check — derived
  // from CURRENT state, never from whether the component merely mounted or
  // whether a post_drafts row happens to exist. template is only
  // "meaningful" once it differs from the default: a fresh mount starts at
  // DEFAULT_TEXT_TEMPLATE, so this never fires just because the default
  // template exists — only once the user (this session, or in an earlier
  // one that got restored) actually chose something else.
  const hasMeaningfulContent =
    title.trim().length > 0 ||
    caption.trim().length > 0 ||
    tags.length > 0 ||
    template !== DEFAULT_TEXT_TEMPLATE ||
    showOnMap ||
    coords !== null;

  const fieldFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function cancelPendingFieldFlush() {
    if (fieldFlushTimerRef.current) {
      clearTimeout(fieldFlushTimerRef.current);
      fieldFlushTimerRef.current = null;
    }
  }

  /** Ensures a draft exists (get-or-create, same pattern as MediaPostEditor)
   *  and writes the current fields to it. Throws on failure — callers decide
   *  whether to swallow (background autosave) or surface (Save Draft). */
  async function flushDraftFields(): Promise<void> {
    if (!user) return;
    const draftId = await ensureDraftId();
    await updateTextDraftFields(draftId, { title, caption, tags, showOnMap, coords, textTemplate: template });
  }

  // Server-side field autosave — the durable source of truth for
  // TextPostEditor's draft now (there was no prior localStorage mechanism
  // here at all to remove — TextPostEditor never had one). Debounced, gated
  // on hasMeaningfulContent so this never creates a draft merely because the
  // composer mounted. No separate order-autosave needed: there is no media.
  useEffect(() => {
    if (isSubmitting || !hasMeaningfulContent) return;
    cancelPendingFieldFlush();
    fieldFlushTimerRef.current = setTimeout(() => {
      void flushDraftFields().catch(() => {});
    }, DRAFT_AUTOSAVE_DEBOUNCE_MS);
    return cancelPendingFieldFlush;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, caption, tags, showOnMap, coords, template, isSubmitting]);

  // The single entry point for every controlled exit this composer can
  // reliably intercept (Cancel tap, Android hardware back). Untouched/empty
  // composer: leave immediately. Otherwise opens the Save Draft / Don't Save
  // sheet instead of leaving directly.
  function attemptExit() {
    if (!hasMeaningfulContent) {
      cancelPendingFieldFlush();
      router.push("/");
      return;
    }
    setExitError(null);
    setIsExitSheetOpen(true);
  }

  const attemptExitRef = useRef(attemptExit);
  useEffect(() => {
    attemptExitRef.current = attemptExit;
  });

  // Android hardware back button — scoped strictly to this component's own
  // mount/unmount lifecycle, so it can never affect back-button behavior
  // anywhere else in the app. Same pattern as MediaPostEditor's own.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listenerPromise = CapacitorApp.addListener("backButton", () => {
      attemptExitRef.current();
    });
    return () => {
      listenerPromise.then((listener) => listener.remove());
    };
  }, []);

  // Browser tab close / refresh / external navigation: native generic
  // prompt only, same reasoning as MediaPostEditor — text fields are durable
  // via the server autosave above, at most one debounce interval behind.
  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasMeaningfulContent) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasMeaningfulContent]);

  // Save Draft: cancel pending debounce, await one final field flush,
  // navigate only once it succeeds. No media/uploads exist for a text
  // draft, so no awaitActiveUploads-equivalent is needed here at all.
  async function handleSaveDraftAndExit() {
    setIsExiting(true);
    setExitError(null);
    try {
      cancelPendingFieldFlush();
      await flushDraftFields();
      router.push("/");
    } catch (err) {
      setExitError(err instanceof Error ? err.message : "Couldn't save your draft. Try again.");
      setIsExiting(false);
    }
  }

  // Don't Save: a text draft has no Storage objects and no draft_media rows
  // at all, so this is just "delete the owned post_drafts row" — no
  // discardMediaDraft-style prefix cleanup applies or is called here.
  // resolveTextDraftIdForDiscard (not the raw cache) decides whether there's
  // anything to delete — see its own doc comment for why the raw cache
  // alone isn't trustworthy enough for a discard decision specifically.
  async function handleDontSaveAndExit() {
    setIsExiting(true);
    setExitError(null);
    try {
      cancelPendingFieldFlush();
      if (user) {
        const pendingDraftId = await resolveTextDraftIdForDiscard();
        if (pendingDraftId) {
          await discardTextDraft(user.id, pendingDraftId);
        }
      }
      router.push("/");
    } catch (err) {
      setExitError(err instanceof Error ? err.message : "Couldn't discard this draft. Try again.");
      setIsExiting(false);
    }
  }

  // Restoration banner's Discard — same discardTextDraft helper AND the same
  // resolveTextDraftIdForDiscard resolution as Don't Save, never a second
  // implementation (in practice this banner only ever shows when
  // restoredDraft was non-null, so draftIdPromiseRef is always pre-seeded
  // here and the fallback SELECT never actually fires — using the same
  // resolver anyway keeps discard's "does a draft exist" decision uniform
  // everywhere, rather than trusting the raw cache in one place and not
  // the other). Stays ON the page: the outer TextPostEditor remounts this
  // component fresh (changing key) once discard succeeds.
  async function handleDiscardRestoredDraft() {
    if (isDiscardingBanner) return;
    setIsDiscardingBanner(true);
    setError(null);
    try {
      cancelPendingFieldFlush();
      if (user) {
        const pendingDraftId = await resolveTextDraftIdForDiscard();
        if (pendingDraftId) {
          await discardTextDraft(user.id, pendingDraftId);
        }
      }
      onDiscardedRestoredDraft();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't discard this draft. Try again.");
      setIsDiscardingBanner(false);
    }
  }

  // Phase 5 publish — ensure/get draft id, final field flush, one atomic
  // publishPostDraft call. Replaces the old addPost()-then-best-effort-
  // discardTextDraft path entirely: the RPC's own transaction now creates
  // the post AND deletes post_drafts atomically, so no separate discard call
  // is needed (or correct — deleting it here as a second step would defeat
  // the point of the RPC being atomic in the first place).
  //
  // publishPostDraft is idempotent (see its own doc comment) — on any
  // failure, the composer just stays open with an error and Publish
  // re-enables; tapping it again safely recovers whether or not the
  // previous attempt's transaction actually committed.
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // If the session drops mid-edit, RequireAuth swaps this whole page to
    // LoginScreen on its own — this guard just protects the submit itself.
    if (!user) return;

    if (!title.trim()) {
      setError("Add a title before publishing.");
      return;
    }

    if (!caption.trim()) {
      setError("Write something before publishing.");
      return;
    }

    if (showOnMap && !coords) {
      setError("Choose a location on the map before publishing.");
      return;
    }

    setIsSubmitting(true);
    cancelPendingFieldFlush();

    try {
      const draftId = await ensureDraftId();
      await updateTextDraftFields(draftId, { title, caption, tags, showOnMap, coords, textTemplate: template });
      await publishPostDraft(draftId);

      // post_drafts is gone (deleted by the RPC's own transaction) —
      // reopening this composer will no longer show a "Draft restored"
      // banner for it.
      router.replace("/me");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setIsSubmitting(false);
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

        <TitleField value={title} onChange={setTitle} />

        <textarea
          id="caption"
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          rows={10}
          placeholder="Share something…"
          className="w-full resize-none border-none bg-transparent text-base leading-relaxed text-stone-900 outline-none placeholder:text-stone-400"
        />

        <TextTemplatePicker template={template} onTemplateChange={setTemplate} title={title} />

        <TagChipInput tags={tags} onTagsChange={setTags} />

        <PostLocationFields
          showOnMap={showOnMap}
          onToggleShowOnMap={() => setShowOnMap((prev) => !prev)}
          coords={coords}
          onCoordsChange={setCoords}
        />

        <ComposerBottomBar isSubmitting={isSubmitting} error={error} />
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
