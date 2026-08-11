"use client";

import MasonryFeed from "@/components/MasonryFeed";
import { useSavedPostIds } from "@/lib/interactions";
import { useAllPosts } from "@/lib/posts";

export default function SavedPage() {
  const { ids: savedPostIds } = useSavedPostIds();
  const posts = useAllPosts();
  const savedPosts = posts.filter((post) => savedPostIds.includes(post.id));

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-28 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <header className="px-4 pb-5 pt-8">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-600">Your collection</p>
        <h1 className="mt-1 text-2xl font-black tracking-tight">Saved spots</h1>
        <p className="mt-1 text-sm text-stone-500">Places you want to remember.</p>
      </header>
      <MasonryFeed posts={savedPosts} />
    </main>
  );
}
