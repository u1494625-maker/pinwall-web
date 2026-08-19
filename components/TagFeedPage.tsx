"use client";

import Link from "next/link";
import MasonryFeed, { FeedSkeleton } from "@/components/MasonryFeed";
import { useAllPostsState } from "@/lib/posts";

type TagFeedPageProps = {
  tag: string;
};

// Tags are stored exactly as typed (see TagChipInput.tsx — trimmed, never
// lowercased), so matching lowercases both sides here at compare-time only,
// same convention lib/search.ts already uses for its own case-insensitive
// field matching — never mutates stored data.
function normalizeTag(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * A hard tag filter over every post — same MasonryFeed/PostCard used
 * everywhere else in the app, no recommendation personalization involved.
 * Modeled on ClusterPostFeedPage's header/shell (hard-filter feed, no search
 * box) plus SearchScreen's loading gate (avoids a flash of MasonryFeed's own
 * empty state before posts have actually loaded).
 */
export default function TagFeedPage({ tag }: TagFeedPageProps) {
  const { posts, loading } = useAllPostsState();
  const normalizedTag = normalizeTag(tag);
  const taggedPosts = posts.filter((post) => post.tags.some((t) => normalizeTag(t) === normalizedTag));

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-28 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <header className="px-4 pb-4 pt-8">
        <Link href="/" className="text-xs font-bold text-orange-600">
          ‹ Back to Home
        </Link>
        <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.18em] text-orange-600">Tagged</p>
        <h1 className="mt-1 text-2xl font-black tracking-tight">#{tag}</h1>
        {!loading ? (
          <p className="mt-1 text-sm text-stone-500">
            {taggedPosts.length} {taggedPosts.length === 1 ? "post" : "posts"}
          </p>
        ) : null}
      </header>

      {loading ? <FeedSkeleton /> : <MasonryFeed posts={taggedPosts} />}
    </main>
  );
}
