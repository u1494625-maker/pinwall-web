"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { getDisplayTitle } from "@/lib/postDisplay";
import type { Post } from "@/types/post";
import DemoPhoto from "./DemoPhoto";
import PostVideoTile from "./PostVideoTile";

function getSavedPostsSnapshot() {
  return localStorage.getItem("pinwall_saved") ?? "[]";
}

function getServerSnapshot() {
  return "[]";
}

function subscribeToSavedPosts(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("pinwall-saved-change", onStoreChange);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("pinwall-saved-change", onStoreChange);
  };
}

export function useSavedPostIds() {
  const savedPostsJson = useSyncExternalStore(
    subscribeToSavedPosts,
    getSavedPostsSnapshot,
    getServerSnapshot,
  );

  return useMemo<number[]>(() => {
    try {
      return JSON.parse(savedPostsJson);
    } catch {
      return [];
    }
  }, [savedPostsJson]);
}

function PostCardMedia({ post }: { post: Post }) {
  if (post.postType === "text") {
    return (
      <div className="flex min-h-[9rem] flex-col justify-center bg-stone-50 p-4">
        <h2 className="text-base font-black leading-snug text-stone-900">{getDisplayTitle(post)}</h2>
        <p className="mt-2 line-clamp-6 text-xs leading-relaxed text-stone-600">{post.caption}</p>
      </div>
    );
  }

  if (post.postType === "video" && post.image) {
    return <PostVideoTile src={post.image} className={post.imageAspect ?? "aspect-[4/5]"} />;
  }

  if (post.image) {
    return (
      <DemoPhoto src={post.image} alt={post.imageAlt ?? ""} className={post.imageAspect ?? "aspect-[4/5]"} />
    );
  }

  // Defensive fallback — shouldn't happen, but a post missing the media its type implies
  // should still render something rather than break the card.
  return (
    <div className="grid aspect-[4/5] place-items-center bg-stone-100 text-xs font-semibold text-stone-400">
      No preview available
    </div>
  );
}

type PostCardProps = {
  post: Post;
};

export default function PostCard({ post }: PostCardProps) {
  const savedPostIds = useSavedPostIds();
  const isSaved = savedPostIds.includes(post.id);
  const isTextPost = post.postType === "text";

  function toggleSavedPost() {
    const nextSavedPostIds = isSaved
      ? savedPostIds.filter((id) => id !== post.id)
      : [...savedPostIds, post.id];

    localStorage.setItem("pinwall_saved", JSON.stringify(nextSavedPostIds));
    window.dispatchEvent(new Event("pinwall-saved-change"));
  }

  return (
    <article className="mb-2.5 break-inside-avoid overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(55,45,35,0.06),0_6px_16px_rgba(55,45,35,0.05)]">
      <Link href={`/post/${post.id}`}>
        <PostCardMedia post={post} />

        <div className={isTextPost ? "px-4 pb-0" : "p-3 pb-0"}>
          {!isTextPost ? (
            <>
              <h2 className="text-sm font-bold leading-snug text-stone-900">{getDisplayTitle(post)}</h2>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-stone-600">{post.caption}</p>
            </>
          ) : null}

          <p className="mt-2 text-[11px] font-bold text-stone-700">
            <span className="text-orange-500">★</span> {post.rating} · {post.ratingCount} ratings
          </p>

          <div className="mt-2 flex flex-wrap gap-1">
            {post.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-orange-50 px-2 py-1 text-[10px] font-semibold text-orange-700">
                #{tag}
              </span>
            ))}
          </div>
        </div>
      </Link>

      <div className="p-3">
        <div className="flex items-center justify-between border-t border-stone-100 pt-2.5">
          <span className="truncate pr-2 text-[11px] font-medium text-stone-500">{post.author}</span>
          <button
            type="button"
            onClick={toggleSavedPost}
            aria-label="Save"
            aria-pressed={isSaved}
            className={`grid size-8 shrink-0 place-items-center rounded-full text-base transition-colors ${
              isSaved
                ? "bg-orange-500 text-white"
                : "bg-stone-100 text-stone-600 hover:bg-orange-100"
            }`}
          >
            {isSaved ? "♥" : "♡"}
          </button>
        </div>
      </div>
    </article>
  );
}
