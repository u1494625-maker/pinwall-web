"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import ComposerBottomBar from "@/components/add/ComposerBottomBar";
import ComposerTopBar from "@/components/add/ComposerTopBar";
import PostLocationFields from "@/components/add/PostLocationFields";
import TagChipInput from "@/components/add/TagChipInput";
import TitleField from "@/components/add/TitleField";
import DemoPhoto from "@/components/DemoPhoto";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getDisplayTitle, resolveImageAspectRatio } from "@/lib/postDisplay";
import { updatePost, useAllPostsState } from "@/lib/posts";
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
  const { posts, loading } = useAllPostsState();
  const post = posts.find((candidate) => candidate.id === postId);

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

  return <EditPostFields post={post} />;
}

function EditPostFields({ post }: { post: Post }) {
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
      <ComposerTopBar cancelHref={`/post/${post.id}`} />

      <form onSubmit={handleSubmit} className="space-y-5 px-5 pt-4">
        {cover?.type === "video" ? (
          // Read-only — media replacement is out of scope for this phase.
          <video
            src={cover.url}
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
          placeholder="Share something useful…"
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
