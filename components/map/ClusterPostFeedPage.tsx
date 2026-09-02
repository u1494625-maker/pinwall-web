"use client";

import Link from "next/link";
import MasonryFeed, { FeedSkeleton } from "@/components/MasonryFeed";
import { useMapPostsState } from "@/lib/posts";

type ClusterPostFeedPageProps = {
  postIds: number[];
};

/**
 * Behaves like a filtered Home feed: same MasonryFeed/PostCard used on Home,
 * scoped to exactly the post IDs the tapped cluster represented. `postIds`
 * always come from a cluster built out of Map's own map-eligible item index
 * (see buildMapItems/buildClusterIndex), so every id here is guaranteed to
 * be a map-eligible post — sourcing from the same scoped useMapPostsState()
 * Map itself now uses (rather than every post in the app) is an exact,
 * lossless swap, not a narrower/different pool. Used directly (not the
 * useMapPosts() convenience wrapper) so a still-loading or failed fetch can
 * be told apart from a genuine zero-post result.
 */
export default function ClusterPostFeedPage({ postIds }: ClusterPostFeedPageProps) {
  const { posts: mapPosts, loading, error, retry } = useMapPostsState();
  const clusterPosts = postIds
    .map((id) => mapPosts.find((post) => post.id === id))
    .filter((post) => post !== undefined);

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-28 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <header className="flex items-start justify-between gap-3 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <div>
          <Link href="/map" className="text-xs font-bold text-kavanaka-aqua">
            ‹ Back to map
          </Link>
          <h1 className="mt-2 text-2xl font-black tracking-tight">
            {loading || error
              ? "Posts in this area"
              : `${clusterPosts.length} ${clusterPosts.length === 1 ? "post" : "posts"} in this area`}
          </h1>
        </div>
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
        <MasonryFeed posts={clusterPosts} />
      )}
    </main>
  );
}
