"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import MasonryFeed from "@/components/MasonryFeed";
import { saveMapViewport } from "@/lib/map/viewport";
import { useAllPosts } from "@/lib/posts";

type ClusterPostFeedPageProps = {
  postIds: number[];
  latitude: number;
  longitude: number;
  expansionZoom: number;
};

/**
 * Behaves like a filtered Home feed: same MasonryFeed/PostCard used on Home,
 * scoped to exactly the post IDs the tapped cluster represented.
 */
export default function ClusterPostFeedPage({
  postIds,
  latitude,
  longitude,
  expansionZoom,
}: ClusterPostFeedPageProps) {
  const router = useRouter();
  const allPosts = useAllPosts();
  const clusterPosts = postIds
    .map((id) => allPosts.find((post) => post.id === id))
    .filter((post) => post !== undefined);

  function viewAreaOnMap() {
    saveMapViewport({ lat: latitude, lng: longitude, zoom: expansionZoom });
    router.push("/map");
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-28 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <header className="flex items-start justify-between gap-3 px-4 pb-4 pt-8">
        <div>
          <Link href="/map" className="text-xs font-bold text-kavanaka-aqua">
            ‹ Back to map
          </Link>
          <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.18em] text-kavanaka-aqua">
            This area
          </p>
          <h1 className="mt-1 text-2xl font-black tracking-tight">
            {clusterPosts.length} {clusterPosts.length === 1 ? "post" : "posts"} nearby
          </h1>
          <p className="mt-1 text-sm text-stone-500">Posts grouped at this spot on the map.</p>
        </div>
      </header>

      <div className="px-4 pb-4">
        <button
          type="button"
          onClick={viewAreaOnMap}
          className="rounded-full bg-stone-100 px-3.5 py-2 text-xs font-bold text-stone-700 hover:bg-kavanaka-aqua/10"
        >
          Zoom into this area on the map
        </button>
      </div>

      <MasonryFeed posts={clusterPosts} />
    </main>
  );
}
