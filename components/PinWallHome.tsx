"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import LoginScreen from "./auth/LoginScreen";
import CategoryChips from "./CategoryChips";
import MasonryFeed from "./MasonryFeed";
import TopBar from "./TopBar";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useAllPosts } from "@/lib/posts";
import { filterPostsInBounds, useSavedMapViewport } from "@/lib/map/viewport";

export default function PinWallHome() {
  const [selectedTab, setSelectedTab] = useState("Explore");
  const { user, loading } = useAuth();
  const posts = useAllPosts();
  const savedViewport = useSavedMapViewport();

  const isFollowingTab = selectedTab === "Following";
  const isMapsTab = selectedTab === "Maps";

  const mapsFeedPosts = useMemo(
    () => (savedViewport?.bounds ? filterPostsInBounds(posts, savedViewport.bounds) : []),
    [posts, savedViewport],
  );

  // Following requires a signed-in user. Reuse the same auth state/loading
  // shape RequireAuth uses elsewhere, so this behaves consistently — no
  // redirect, no flash of the wrong content while the session is resolving.
  if (isFollowingTab && loading) {
    return <main className="min-h-screen bg-[#fbfaf7]" />;
  }

  if (isFollowingTab && !user) {
    return <LoginScreen />;
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-28 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <TopBar>
        <CategoryChips selectedTab={selectedTab} onSelectTab={setSelectedTab} />
      </TopBar>

      {isFollowingTab ? (
        <div className="px-6 py-20 text-center">
          <p className="text-sm text-stone-500">Posts from people you follow will appear here.</p>
        </div>
      ) : isMapsTab ? (
        savedViewport?.bounds ? (
          mapsFeedPosts.length > 0 ? (
            <>
              <div className="flex items-center justify-end px-4 pb-1 pt-3">
                <Link href="/map" className="text-xs font-bold text-orange-600">
                  Change area ›
                </Link>
              </div>
              <MasonryFeed posts={mapsFeedPosts} />
            </>
          ) : (
            <div className="mx-4 rounded-3xl border border-dashed border-stone-300 bg-white px-6 py-14 text-center">
              <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-orange-100 text-2xl">📍</div>
              <h2 className="text-lg font-bold">No posts in this area yet</h2>
              <p className="mt-2 text-sm text-stone-500">Try exploring a different part of the map.</p>
              <Link href="/map" className="mt-5 inline-flex rounded-full bg-stone-900 px-5 py-2.5 text-sm font-bold text-white">
                Explore another area
              </Link>
            </div>
          )
        ) : (
          <div className="mx-4 rounded-3xl border border-dashed border-stone-300 bg-white px-6 py-14 text-center">
            <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-orange-100 text-2xl">📍</div>
            <h2 className="text-lg font-bold">No area selected</h2>
            <p className="mt-2 text-sm text-stone-500">Choose an area on the Map to explore posts here.</p>
            <Link href="/map" className="mt-5 inline-flex rounded-full bg-stone-900 px-5 py-2.5 text-sm font-bold text-white">
              Open Map
            </Link>
          </div>
        )
      ) : (
        <MasonryFeed posts={posts} />
      )}
    </main>
  );
}
