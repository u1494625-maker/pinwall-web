"use client";

import Link from "next/link";
import MasonryFeed, { FeedSkeleton } from "@/components/MasonryFeed";
import { useAllPostsState } from "@/lib/posts";
import { rankPostsByTag } from "@/lib/search";

type TagFeedPageProps = {
  tag: string;
};

/**
 * A topic-focused tag feed over every post — same MasonryFeed/PostCard used
 * everywhere else in the app, no recommendation personalization involved.
 * Modeled on ClusterPostFeedPage's header/shell (hard-filter feed, no search
 * box) plus SearchScreen's loading gate (avoids a flash of MasonryFeed's own
 * empty state before posts have actually loaded). Ranking is
 * rankPostsByTag (lib/search.ts) — the same stemming/synonym-tolerant
 * matching Search itself uses, just weighted so an exact/stemmed tag match
 * dominates and a single related word elsewhere can't alone qualify an
 * unrelated post (see that function's own doc comment) — so #clubs
 * correctly surfaces a post tagged "sports club" instead of requiring the
 * tag string to equal "clubs" exactly.
 */
export default function TagFeedPage({ tag }: TagFeedPageProps) {
  const { posts, loading, error, retry } = useAllPostsState();
  const taggedPosts = rankPostsByTag(posts, tag);

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-28 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <header className="px-4 pb-4 pt-8">
        <Link href="/" className="text-xs font-bold text-kavanaka-green">
          ‹ Back to Home
        </Link>
        <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.18em] text-kavanaka-green">Tagged</p>
        <h1 className="mt-1 text-2xl font-black tracking-tight">#{tag}</h1>
        {!loading && !error ? (
          <p className="mt-1 text-sm text-stone-500">
            {taggedPosts.length} {taggedPosts.length === 1 ? "post" : "posts"}
          </p>
        ) : null}
      </header>

      {loading ? (
        <FeedSkeleton />
      ) : error ? (
        <div className="mx-4 rounded-3xl border border-dashed border-stone-300 bg-white px-6 py-14 text-center">
          <h2 className="text-lg font-bold">Couldn&apos;t load posts.</h2>
          <button
            type="button"
            onClick={retry}
            className="mt-5 inline-flex rounded-full bg-stone-900 px-5 py-2.5 text-sm font-bold text-white"
          >
            Try again
          </button>
        </div>
      ) : (
        <MasonryFeed posts={taggedPosts} />
      )}
    </main>
  );
}
