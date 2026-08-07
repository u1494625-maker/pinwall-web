"use client";

import { useState } from "react";
import RequireAuth from "@/components/auth/RequireAuth";
import DemoPhoto from "@/components/DemoPhoto";
import PostCard, { useSavedPostIds } from "@/components/PostCard";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useAllPosts } from "@/lib/posts";

const profileTabs = ["Posts", "Saved"] as const;
type ProfileTab = (typeof profileTabs)[number];

function MeContent() {
  const { user, signOut } = useAuth();
  const posts = useAllPosts();
  const savedPostIds = useSavedPostIds();
  const [activeTab, setActiveTab] = useState<ProfileTab>("Posts");

  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;
  const displayName = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? "You";
  const email = user?.email ?? "";

  const myPosts = user ? posts.filter((post) => post.userId === user.id) : [];
  const savedPosts = posts.filter((post) => savedPostIds.includes(post.id));
  const gridPosts = activeTab === "Posts" ? myPosts : savedPosts;

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <div className="relative h-56 w-full">
        <div className="absolute inset-0 overflow-hidden bg-stone-800">
          {avatarUrl ? (
            <DemoPhoto src={avatarUrl} alt="" className="absolute inset-0 scale-150 blur-3xl" />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-b from-black/15 via-black/45 to-black/80" />
        </div>

        <div className="absolute right-4 top-5 flex items-center gap-2">
          <button
            type="button"
            className="rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/25"
          >
            Edit Profile
          </button>
          <button
            type="button"
            onClick={() => signOut()}
            className="rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/25"
          >
            Log out
          </button>
        </div>

        <div className="absolute inset-x-4 -bottom-9 z-20 flex items-end gap-3">
          {avatarUrl ? (
            <DemoPhoto
              src={avatarUrl}
              alt={`${displayName} profile photo`}
              className="size-20 shrink-0 rounded-full border-4 border-[#fbfaf7] shadow-lg"
            />
          ) : (
            <div className="grid size-20 shrink-0 place-items-center rounded-full border-4 border-[#fbfaf7] bg-stone-200 text-xl font-black text-stone-600 shadow-lg">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 pb-11">
            <h1 className="truncate text-base font-black text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
              {displayName}
            </h1>
            {email ? (
              <p className="mt-0.5 truncate text-[11px] font-medium text-white/80 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
                {email}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="relative rounded-t-3xl bg-[#fbfaf7] pb-28 pt-11">
        <div className="flex border-b border-stone-100 px-1">
          {profileTabs.map((tab) => {
            const isActive = tab === activeTab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                aria-pressed={isActive}
                className="relative flex-1 py-2.5 text-sm font-bold"
              >
                <span className={isActive ? "text-stone-900" : "text-stone-400"}>{tab}</span>
                {isActive ? (
                  <span className="absolute inset-x-0 -bottom-px mx-auto h-[2.5px] w-8 rounded-full bg-orange-500" />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="p-3">
          {gridPosts.length > 0 ? (
            <div className="columns-2 gap-2">
              {gridPosts.map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
          ) : (
            <div className="py-16 text-center">
              <p className="text-sm text-stone-400">
                {activeTab === "Posts" ? "No posts yet." : "No saved posts yet."}
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default function MePage() {
  return (
    <RequireAuth>
      <MeContent />
    </RequireAuth>
  );
}
