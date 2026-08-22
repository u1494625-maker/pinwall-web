"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import ComposerBottomBar from "@/components/add/ComposerBottomBar";
import ComposerTopBar from "@/components/add/ComposerTopBar";
import DraftRestoredBanner from "@/components/add/DraftRestoredBanner";
import MediaComposerFields from "@/components/add/MediaComposerFields";
import PostLocationFields from "@/components/add/PostLocationFields";
import TagChipInput from "@/components/add/TagChipInput";
import TitleField from "@/components/add/TitleField";
import DemoPhoto from "@/components/DemoPhoto";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  clearDraft,
  draftKeyForEdit,
  DRAFT_AUTOSAVE_DEBOUNCE_MS,
  loadDraft,
  saveDraft,
  type ComposerDraft,
} from "@/lib/composerDraft";
import { useMediaComposer, type ExistingMediaSeed } from "@/lib/mediaComposer";
import { getDisplayTitle, measureImageAspectRatio, resolveImageAspectRatio } from "@/lib/postDisplay";
import { getPostById, updatePost, updatePostWithMedia, type EditPostMediaInput } from "@/lib/posts";
import { deletePostMedia, uploadPostMedia } from "@/lib/storage";
import type { Post } from "@/types/post";

type EditPostFormProps = {
  postId: number;
};

/**
 * Resolves the target post, gates on loading/not-found/ownership, then hands off to
 * EditPostFields — which only ever mounts once a non-null, owned Post is guaranteed,
 * so its field state can be seeded directly from `post` with no "might not exist yet"
 * ambiguity. Mirrors the loading/not-found split already established in PostDetail.tsx.
 */
export default function EditPostForm({ postId }: EditPostFormProps) {
  const { user } = useAuth();
  // A dedicated, fresh, per-id fetch — not the shared cross-page
  // cachedAllPosts cache — for the same reason PostDetail.tsx uses one: a
  // removed post must be unreachable here immediately, not just once some
  // other page's shared cache happens to refetch. See PostDetail.tsx for the
  // full reasoning.
  const [post, setPost] = useState<Post | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load(id: number) {
      if (!Number.isFinite(id)) {
        setPost(undefined);
        setLoading(false);
        return;
      }

      setLoading(true);
      const result = await getPostById(id);
      if (!cancelled) {
        setPost(result);
        setLoading(false);
      }
    }

    load(postId);

    return () => {
      cancelled = true;
    };
  }, [postId]);

  if (loading) {
    return <main className="min-h-screen bg-[#fbfaf7]" />;
  }

  if (!post) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center bg-[#fbfaf7] px-8 text-center">
        <h1 className="text-lg font-black">Post not found</h1>
        <p className="mt-2 text-sm text-stone-500">It may have been removed.</p>
        <Link href="/" className="mt-5 inline-flex rounded-full bg-stone-900 px-5 py-2.5 text-sm font-bold text-white">
          Back to Explore
        </Link>
      </main>
    );
  }

  const isOwner = Boolean(user && post.userId && user.id === post.userId);

  if (!isOwner) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center bg-[#fbfaf7] px-8 text-center">
        <h1 className="text-lg font-black">You can&apos;t edit this post</h1>
        <p className="mt-2 text-sm text-stone-500">Only the post&apos;s owner can make changes.</p>
        <Link
          href={`/post/${post.id}`}
          className="mt-5 inline-flex rounded-full bg-stone-900 px-5 py-2.5 text-sm font-bold text-white"
        >
          Back to post
        </Link>
      </main>
    );
  }

  // Full add/delete/reorder/location editing is only for photo posts — a
  // video post's single file and a text post's template are both out of
  // scope for this phase (unchanged, pre-existing boundary).
  const isPhotoPost = post.media.length > 0 && post.media[0].type === "image";

  return isPhotoPost ? <EditPhotoPostFields post={post} /> : <EditSimplePostFields post={post} />;
}

/** Text posts and video posts: title/caption/tags/location only — unchanged
 *  from before this round. Video's cover renders read-only ("media
 *  replacement is out of scope for this phase"). */
function EditSimplePostFields({ post }: { post: Post }) {
  const router = useRouter();
  const cover = post.media[0];

  const [title, setTitle] = useState(post.title ?? "");
  const [caption, setCaption] = useState(post.caption);
  const [tags, setTags] = useState<string[]>(post.tags);
  const [showOnMap, setShowOnMap] = useState(post.showOnMap);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    post.latitude != null && post.longitude != null ? { lat: post.latitude, lng: post.longitude } : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!caption.trim()) {
      setError("Write something before saving.");
      return;
    }

    if (post.media.length > 0 && !title.trim()) {
      setError("Add a title before saving.");
      return;
    }

    if (showOnMap && !coords) {
      setError("Choose a location on the map before saving.");
      return;
    }

    setIsSubmitting(true);

    try {
      const trimmedTitle = title.trim();

      await updatePost(post.id, {
        title: trimmedTitle ? trimmedTitle : null,
        caption: caption.trim(),
        tags,
        showOnMap,
        latitude: showOnMap ? (coords?.lat ?? null) : null,
        longitude: showOnMap ? (coords?.lng ?? null) : null,
      });

      router.replace(`/post/${post.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-28 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <ComposerTopBar onCancel={() => router.back()} />

      <form onSubmit={handleSubmit} className="space-y-5 px-5 pt-4">
        {cover?.type === "video" ? (
          // Read-only — media replacement is out of scope for this phase.
          <video
            src={`${cover.url}#t=0.001`}
            controls
            playsInline
            preload="metadata"
            className="aspect-[4/3] w-full rounded-2xl bg-black object-contain"
          />
        ) : cover ? (
          <DemoPhoto
            src={cover.url}
            alt={getDisplayTitle(post)}
            className="w-full rounded-2xl"
            style={{ aspectRatio: resolveImageAspectRatio(cover.aspectRatio) }}
          />
        ) : null}

        <TitleField value={title} onChange={setTitle} />

        <textarea
          id="caption"
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          rows={6}
          placeholder="Share something…"
          className="w-full resize-none border-none bg-transparent text-base leading-relaxed text-stone-900 outline-none placeholder:text-stone-400"
        />

        <TagChipInput tags={tags} onTagsChange={setTags} />

        <PostLocationFields
          showOnMap={showOnMap}
          onToggleShowOnMap={() => setShowOnMap((prev) => !prev)}
          coords={coords}
          onCoordsChange={setCoords}
        />

        <ComposerBottomBar isSubmitting={isSubmitting} error={error} submitLabel="Save" submittingLabel="Saving…" />
      </form>
    </main>
  );
}

/** post_media -> ExistingMediaSeed, using the server's own current location
 *  unless a locationOverride is given (a restored draft's saved value for
 *  this specific media id). url/storagePath/aspectRatio/thumbnailUrl always
 *  come from the server — a draft never carries them at all. */
function mediaToSeed(media: Post["media"][number], locationOverride?: { lat: number; lng: number }): ExistingMediaSeed {
  return {
    id: media.id,
    type: media.type,
    url: media.url,
    storagePath: media.storagePath,
    aspectRatio: media.aspectRatio,
    thumbnailUrl: media.thumbnailUrl,
    location:
      locationOverride ??
      (media.latitude != null && media.longitude != null ? { lat: media.latitude, lng: media.longitude } : undefined),
  };
}

/**
 * Photo posts: full add/delete/reorder/location editing, sharing the exact
 * same state machine (useMediaComposer) and JSX (MediaComposerFields) as
 * MediaPostEditor's create flow — see lib/mediaComposer.ts and
 * components/add/MediaComposerFields.tsx. Nothing here reaches Supabase
 * until Save: every delete/add/reorder/location edit is local React state,
 * exactly like the create flow, so Cancel (ComposerTopBar's onCancel ->
 * router.back()) never needs to undo anything server-side.
 */
function EditPhotoPostFields({ post }: { post: Post }) {
  const router = useRouter();
  const { user } = useAuth();

  const draftKey = draftKeyForEdit(post.id);
  // Read once at mount — a later change to the draft in storage (e.g. from
  // another tab) is never reflected back into an already-open composer.
  const [initialDraft] = useState<ComposerDraft | null>(() => {
    const draft = loadDraft(draftKey);
    return draft && draft.postId === post.id ? draft : null;
  });
  const [showDraftBanner, setShowDraftBanner] = useState(() => initialDraft !== null);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [title, setTitle] = useState(() => initialDraft?.title ?? post.title ?? "");
  const [caption, setCaption] = useState(() => initialDraft?.caption ?? post.caption);
  const [tags, setTags] = useState<string[]>(() => initialDraft?.tags ?? post.tags);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // The full set of media ids the server had when this draft session
  // began — captured once (from the draft if one already exists, otherwise
  // from the current fresh fetch) and never recomputed, so it keeps
  // meaning "as of draft creation" across every reload for the life of
  // this draft. See knownServerMediaIds's own doc comment in
  // lib/composerDraft.ts for why reconciliation needs this.
  const [knownServerMediaIds] = useState<number[]>(
    () => initialDraft?.knownServerMediaIds ?? post.media.map((media) => media.id),
  );

  const [initialItems] = useState<ExistingMediaSeed[]>(() => {
    if (!initialDraft) return post.media.map((media) => mediaToSeed(media));

    // Reconcile the draft's saved order/locations against the FRESH server
    // media. A draft entry whose id no longer exists server-side (deleted
    // via another session since the draft was saved) is silently dropped
    // rather than shown broken. Server media the draft doesn't mention is
    // only appended if it's genuinely new (absent from
    // knownServerMediaIds) — media that WAS known at draft-creation time
    // but isn't in existingMediaOrder was deliberately deleted by the user
    // in this session and must stay deleted, not be resurrected.
    const remaining = new Map(post.media.map((media) => [media.id, media]));
    const seeded: ExistingMediaSeed[] = [];
    for (const entry of initialDraft.existingMediaOrder) {
      const media = remaining.get(entry.id);
      if (!media) continue;
      seeded.push(mediaToSeed(media, entry.location));
      remaining.delete(entry.id);
    }
    const knownIds = new Set(initialDraft.knownServerMediaIds);
    for (const media of post.media) {
      if (remaining.has(media.id) && !knownIds.has(media.id)) seeded.push(mediaToSeed(media));
    }
    return seeded;
  });

  // A real multi-spot post is persisted with posts.show_on_map = false (the
  // create flow deliberately never sets both a post-level location AND
  // per-photo locations — see MediaPostEditor's own submit logic) even
  // though every photo has its own pin. The master "Show this post on the
  // map" switch has to reflect that conceptual on-ness, or the whole
  // location section (including "More than one spot" and every existing
  // per-photo pin) would be hidden behind a switch that reads off with no
  // way to reach it.
  const hasPerPhotoLocations = post.media.some((media) => media.latitude != null && media.longitude != null);

  const composer = useMediaComposer({
    initialItems,
    initialShowOnMap: initialDraft?.showOnMap ?? (post.showOnMap || hasPerPhotoLocations),
    initialCoords:
      initialDraft?.coords ??
      (post.latitude != null && post.longitude != null ? { lat: post.latitude, lng: post.longitude } : null),
    initialPerPhotoLocationMode: initialDraft?.perPhotoLocationMode,
  });
  const {
    fileInputRef,
    mediaItems,
    mode,
    showOnMap,
    coords,
    setCoords,
    perPhotoLocationMode,
    selectedLocationKeys,
    error,
    setError,
    isConvertingHeic,
    showAddMoreTile,
    handleMediaChange,
    handleRemoveMedia,
    handleMoveMedia,
    handleToggleShowOnMap,
    handleTogglePerPhotoLocationMode,
    handleTogglePhotoSelection,
    handleSetLocationForSelectedPhotos,
    handleClearLocationForSelectedPhotos,
  } = composer;

  // Debounced autosave — text/settings and existing-media order/location/
  // deletion state only, never the local media Files themselves (those
  // aren't JSON-serializable and aren't meant to survive a reload in this
  // version — see lib/composerDraft.ts). Skipped entirely once a submit is
  // underway, so it can't race with the clear-on-success below.
  useEffect(() => {
    if (isSubmitting) return;

    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      saveDraft(draftKey, {
        version: 1,
        mode: "edit",
        postId: post.id,
        title,
        caption,
        tags,
        showOnMap,
        coords,
        perPhotoLocationMode,
        existingMediaOrder: mediaItems
          .filter((item) => item.kind === "existing")
          .map((item) => ({ id: item.id, location: item.location })),
        knownServerMediaIds,
        hasUnsavedLocalMedia: mediaItems.some((item) => item.kind === "new"),
        savedAt: Date.now(),
      });
    }, DRAFT_AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    };
  }, [
    draftKey,
    post.id,
    isSubmitting,
    title,
    caption,
    tags,
    showOnMap,
    coords,
    perPhotoLocationMode,
    mediaItems,
    knownServerMediaIds,
  ]);

  function cancelPendingDraftSave() {
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
  }

  function handleCancel() {
    cancelPendingDraftSave();
    clearDraft(draftKey);
    router.back();
  }

  function handleDiscardDraft() {
    cancelPendingDraftSave();
    clearDraft(draftKey);
    setShowDraftBanner(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!user) return;

    if (!caption.trim()) {
      setError("Write something before saving.");
      return;
    }

    if (!title.trim()) {
      setError("Add a title before saving.");
      return;
    }

    if (mediaItems.length === 0) {
      setError("Keep at least one photo — delete the whole post instead if you want to remove it.");
      return;
    }

    if (!perPhotoLocationMode && showOnMap && !coords) {
      setError("Choose a location on the map before saving.");
      return;
    }

    setIsSubmitting(true);

    // A fresh draft id for whatever's newly uploaded THIS save — independent
    // of the post's original media, exactly like a create-flow submission
    // groups everything under one new folder per attempt.
    const draftId = crypto.randomUUID();
    const uploadedPaths: string[] = [];

    // Anything from the post's original media whose id is no longer present
    // in the current mediaItems is a deletion. Storage for these is only
    // ever removed AFTER the database transaction below succeeds — never
    // before, so a cancelled/failed save leaves the original files intact.
    const retainedIds = new Set(
      mediaItems.filter((item) => item.kind === "existing").map((item) => item.id),
    );
    const deletedStoragePaths = post.media.filter((media) => !retainedIds.has(media.id)).map((media) => media.storagePath);

    try {
      const media: EditPostMediaInput[] = [];

      for (let index = 0; index < mediaItems.length; index += 1) {
        const item = mediaItems[index];

        if (item.kind === "existing") {
          // Retained photo: id/position/location all come from this same
          // item, so a moved photo's location travels with it by
          // construction — never a separate index-keyed value.
          media.push({
            id: item.id,
            type: item.type,
            url: item.previewUrl,
            storagePath: item.storagePath,
            aspectRatio: item.aspectRatio,
            position: index,
            thumbnailUrl: item.thumbnailUrl,
            latitude: perPhotoLocationMode ? item.location?.lat : undefined,
            longitude: perPhotoLocationMode ? item.location?.lng : undefined,
          });
          continue;
        }

        // New photo — same upload pipeline as MediaPostEditor's create flow.
        const aspectRatio = item.imageDiagnostics
          ? `${item.imageDiagnostics.optimizedWidth}/${item.imageDiagnostics.optimizedHeight}`
          : await measureImageAspectRatio(item.previewUrl);
        const { url, path } = await uploadPostMedia(item.file, user.id, draftId);
        uploadedPaths.push(path);

        media.push({
          type: item.type,
          url,
          storagePath: path,
          aspectRatio,
          position: index,
          latitude: perPhotoLocationMode ? item.location?.lat : undefined,
          longitude: perPhotoLocationMode ? item.location?.lng : undefined,
        });
      }

      const trimmedTitle = title.trim();

      await updatePostWithMedia(
        post.id,
        {
          title: trimmedTitle ? trimmedTitle : null,
          caption: caption.trim(),
          tags,
          // Per-photo mode fully supersedes the post-level location — never
          // save both for the same post. Explicitly null (not merely
          // omitted) so a mode switch away from single-spot clears the old
          // shared location rather than leaving it stale.
          showOnMap: perPhotoLocationMode ? false : showOnMap,
          latitude: perPhotoLocationMode ? null : showOnMap ? (coords?.lat ?? null) : null,
          longitude: perPhotoLocationMode ? null : showOnMap ? (coords?.lng ?? null) : null,
          locationName: null,
        },
        media,
      );

      // Database succeeded — now safe to remove Storage objects for photos
      // the user deleted. Never runs before the transaction above commits.
      if (deletedStoragePaths.length > 0) {
        for (const path of deletedStoragePaths) {
          try {
            await deletePostMedia(path);
          } catch (cleanupErr) {
            // Best-effort, matching deletePostMedia's own documented
            // contract — the database is already correctly saved at this
            // point, so a stray orphaned Storage object is a minor leak,
            // not a correctness bug. Surfaced for diagnostics only.
            console.error("Failed to remove a deleted photo from storage:", path, cleanupErr);
          }
        }
      }

      cancelPendingDraftSave();
      clearDraft(draftKey);
      router.replace(`/post/${post.id}`);
    } catch (err) {
      // The RPC transaction never committed — existing media/Storage is
      // completely untouched. Only roll back files uploaded THIS attempt.
      if (uploadedPaths.length > 0) {
        for (const path of uploadedPaths) {
          try {
            await deletePostMedia(path);
          } catch {
            // Best-effort; the user-facing error below already covers this.
          }
        }
      }
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-28 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <ComposerTopBar onCancel={handleCancel} />

      <form onSubmit={handleSubmit} className="space-y-5 px-5 pt-4">
        {showDraftBanner ? (
          <DraftRestoredBanner
            needsMediaReselect={initialDraft?.hasUnsavedLocalMedia ?? false}
            onDiscard={handleDiscardDraft}
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

        <ComposerBottomBar isSubmitting={isSubmitting} error={error} submitLabel="Save" submittingLabel="Saving…" />
      </form>
    </main>
  );
}
