"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import DemoPhoto from "@/components/DemoPhoto";
import { useSavedPostIds } from "@/components/PostCard";
import { hasValidMapLocation } from "@/lib/map/viewport";
import { getDisplayTitle, resolveImageAspectRatio } from "@/lib/postDisplay";
import { useAllPostsState } from "@/lib/posts";

type PostDetailProps = {
  postId: number;
};

function formatRelativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return "Just now";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(then);
}

function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
      <path d="M16 6l-4-4-4 4" />
      <path d="M12 2v14" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

/** Neutral placeholder shown only while posts are loading — never the real "not found" state. */
function PostDetailSkeleton() {
  return (
    <main className="relative mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-24 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <div className="flex items-center gap-3 border-b border-stone-100 px-4 py-3">
        <div className="size-9 shrink-0 animate-pulse rounded-full bg-stone-200" />
        <div className="size-9 shrink-0 animate-pulse rounded-full bg-stone-200" />
        <div className="h-4 flex-1 animate-pulse rounded bg-stone-200" />
        <div className="size-9 shrink-0 animate-pulse rounded-full bg-stone-200" />
      </div>
      <div className="aspect-[4/5] w-full animate-pulse bg-stone-200" />
      <div className="space-y-3 px-5 pt-5">
        <div className="h-5 w-3/4 animate-pulse rounded bg-stone-200" />
        <div className="h-4 w-full animate-pulse rounded bg-stone-200" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-stone-200" />
      </div>
    </main>
  );
}

export default function PostDetail({ postId }: PostDetailProps) {
  const router = useRouter();
  const { posts, loading } = useAllPostsState();
  const post = posts.find((candidate) => candidate.id === postId);
  const savedPostIds = useSavedPostIds();
  const commentsSectionRef = useRef<HTMLDivElement>(null);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);

  if (loading) {
    return <PostDetailSkeleton />;
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

  const isSaved = savedPostIds.includes(post.id);

  function toggleSaved() {
    if (!post) return;
    const nextSavedPostIds = isSaved
      ? savedPostIds.filter((id) => id !== post.id)
      : [...savedPostIds, post.id];
    localStorage.setItem("pinwall_saved", JSON.stringify(nextSavedPostIds));
    window.dispatchEvent(new Event("pinwall-saved-change"));
  }

  function scrollToComments() {
    commentsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleShare() {
    if (!post) return;
    const shareData = { title: getDisplayTitle(post), text: post.caption, url: window.location.href };

    if (typeof navigator.share === "function") {
      try {
        await navigator.share(shareData);
      } catch {
        // User canceled the native share sheet — nothing to do.
      }
      return;
    }

    if (navigator.clipboard) {
      await navigator.clipboard.writeText(window.location.href);
      setShareFeedback("Link copied");
      setTimeout(() => setShareFeedback(null), 2000);
    }
  }

  return (
    <main className="relative mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-24 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      {/* Top bar always renders in full, before the media, for every post — including the viewer's own. */}
      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-stone-100 bg-[#fbfaf7]/95 px-4 py-3 backdrop-blur">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Go back"
          className="grid size-9 shrink-0 place-items-center rounded-full text-2xl leading-none text-stone-700"
        >
          ‹
        </button>

        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-stone-200 text-sm font-black text-stone-600">
          {post.author.charAt(0).toUpperCase()}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-stone-900">{post.author}</p>
          {post.createdAt ? <p className="text-[11px] text-stone-400">{formatRelativeDate(post.createdAt)}</p> : null}
        </div>

        <button
          type="button"
          onClick={handleShare}
          aria-label="Share"
          className="grid size-9 shrink-0 place-items-center rounded-full text-stone-700"
        >
          <ShareIcon />
        </button>
      </div>

      {shareFeedback ? (
        <div className="pointer-events-none fixed inset-x-0 top-16 z-30 flex justify-center">
          <span className="rounded-full bg-stone-900 px-3 py-1.5 text-[11px] font-bold text-white shadow-lg">
            {shareFeedback}
          </span>
        </div>
      ) : null}

      {post.postType === "video" && post.image ? (
        // Do not autoplay with sound — playback starts only via the native controls.
        <video
          src={post.image}
          controls
          playsInline
          preload="metadata"
          className="aspect-[4/3] w-full bg-black object-contain"
        />
      ) : post.postType === "image" && post.image ? (
        <DemoPhoto
          src={post.image}
          alt={post.imageAlt ?? ""}
          className="w-full"
          style={{ aspectRatio: resolveImageAspectRatio(post.imageAspect) }}
        />
      ) : null}

      <div className="px-5 pt-5">
        {hasValidMapLocation(post) ? (
          <Link
            href={`/map?postId=${post.id}`}
            className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.14em] text-orange-600"
          >
            📍 {post.locationName || "View on Map"}
          </Link>
        ) : null}

        <h1 className="mt-1.5 text-xl font-black leading-tight text-stone-900">{getDisplayTitle(post)}</h1>

        <p
          className={`mt-3 text-stone-600 ${post.postType === "text" ? "text-base leading-8" : "text-sm leading-6"}`}
        >
          {post.caption}
        </p>

        {post.tags.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-700"
              >
                #{tag}
              </span>
            ))}
          </div>
        ) : null}

        <div ref={commentsSectionRef} className="mt-6 border-t border-stone-200 pt-5">
          <h2 className="text-sm font-black text-stone-900">Comments</h2>
          <p className="mt-4 text-center text-xs text-stone-400">Be the first to comment.</p>
          <div className="mt-4 flex items-center gap-2">
            <input
              type="text"
              disabled
              placeholder="Comments are coming soon"
              className="flex-1 rounded-full border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm text-stone-400 outline-none disabled:cursor-not-allowed"
            />
            <button
              type="button"
              disabled
              className="shrink-0 rounded-full bg-stone-200 px-4 py-2.5 text-xs font-bold text-stone-400 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </div>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto flex w-full max-w-md items-stretch border-t border-stone-200 bg-white/95 px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 backdrop-blur">
        <button
          type="button"
          onClick={toggleSaved}
          aria-pressed={isSaved}
          className="flex flex-1 flex-col items-center gap-0.5 py-1 text-[11px] font-bold text-stone-500"
        >
          <span className={`text-lg leading-none ${isSaved ? "text-orange-500" : "text-stone-500"}`}>
            {isSaved ? "♥" : "♡"}
          </span>
          Save
        </button>
        <button
          type="button"
          onClick={scrollToComments}
          className="flex flex-1 flex-col items-center gap-0.5 py-1 text-[11px] font-bold text-stone-500"
        >
          <CommentIcon />
          Comment
        </button>
      </div>
    </main>
  );
}
