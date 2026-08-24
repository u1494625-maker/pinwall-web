"use client";

import Link from "next/link";
import MasonryFeed from "@/components/MasonryFeed";
import { useAllPosts } from "@/lib/posts";

type ClusterPostFeedPageProps = {
  postIds: number[];
};

/**
 * Behaves like a filtered Home feed: same MasonryFeed/PostCard used on Home,
 * scoped to exactly the post IDs the tapped cluster represented.
 */
export default function ClusterPostFeedPage({ postIds }: ClusterPostFeedPageProps) {
  const allPosts = useAllPosts();
  const clusterPosts = postIds
    .map((id) => allPosts.find((post) => post.id === id))
    .filter((post) => post !== undefined);

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-28 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <header className="flex items-start justify-between gap-3 px-4 pb-4 pt-8">
        <div>
          <Link href="/map" className="text-xs font-bold text-kavanaka-aqua">
            ‹ Back to map
          </Link>
          <h1 className="mt-2 text-2xl font-black tracking-tight">
            {clusterPosts.length} {clusterPosts.length === 1 ? "post" : "posts"} in this area
          </h1>
        </div>
      </header>

      <MasonryFeed posts={clusterPosts} />
    </main>
  );
}
