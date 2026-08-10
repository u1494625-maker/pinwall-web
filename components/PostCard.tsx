"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { getDisplayTitle, resolveImageAspectRatio } from "@/lib/postDisplay";
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
  const cover = post.media[0];

  // Text posts have no real media — showing an artificial placeholder box here
  // would just be dead space; the card stays naturally compact without one.
  if (!cover) {
    return null;
  }

  if (cover.type === "video") {
    return <PostVideoTile src={cover.url} className="aspect-[4/5]" />;
  }

  return (
    <DemoPhoto
      src={cover.url}
      alt={getDisplayTitle(post)}
      className="w-full"
      style={{ aspectRatio: resolveImageAspectRatio(cover.aspectRatio) }}
    />
  );
}

type PostCardProps = {
  post: Post;
};

export default function PostCard({ post }: PostCardProps) {
  return (
    <article className="mb-2.5 break-inside-avoid overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(55,45,35,0.06),0_6px_16px_rgba(55,45,35,0.05)]">
      <Link href={`/post/${post.id}`}>
        <PostCardMedia post={post} />

        <div className="p-2.5">
          <h2 className="line-clamp-2 text-[13px] font-bold leading-snug text-stone-900">
            {getDisplayTitle(post)}
          </h2>

          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="grid size-4 shrink-0 place-items-center rounded-full bg-stone-200 text-[8px] font-black text-stone-600">
              {post.author.charAt(0).toUpperCase()}
            </span>
            <span className="truncate text-[11px] font-medium text-stone-500">{post.author}</span>
          </div>
        </div>
      </Link>
    </article>
  );
}
