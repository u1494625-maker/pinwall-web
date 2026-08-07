"use client";

import { useState } from "react";
import LoginScreen from "./auth/LoginScreen";
import CategoryChips from "./CategoryChips";
import MasonryFeed from "./MasonryFeed";
import TopBar from "./TopBar";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useAllPosts } from "@/lib/posts";

export default function PinWallHome() {
  const [selectedTab, setSelectedTab] = useState("Explore");
  const { user, loading } = useAuth();
  const posts = useAllPosts();

  const isFollowingTab = selectedTab === "Following";

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
      ) : (
        <MasonryFeed posts={posts} />
      )}
    </main>
  );
}
