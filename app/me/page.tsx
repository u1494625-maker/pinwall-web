"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import RequireAuth from "@/components/auth/RequireAuth";
import PostCard from "@/components/PostCard";
import ProfileHeader from "@/components/profile/ProfileHeader";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getProfileStats, useLikedPostIds, useSavedPostIds, type ProfileStats } from "@/lib/interactions";
import { useAllPosts } from "@/lib/posts";
import { getProfile, type Profile } from "@/lib/profiles";

const profileTabs = ["Posts", "Saved", "Helpful"] as const;
type ProfileTab = (typeof profileTabs)[number];

const EMPTY_STATS: ProfileStats = { followingCount: 0, followersCount: 0, likesAndSavesCount: 0 };

function ProfileHeaderSkeleton() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7]">
      <div className="h-56 w-full animate-pulse bg-stone-200" />
    </main>
  );
}

function MeContent() {
  const { user, signOut } = useAuth();
  const posts = useAllPosts();
  const { ids: savedPostIds } = useSavedPostIds();
  const { ids: likedPostIds } = useLikedPostIds();
  const [activeTab, setActiveTab] = useState<ProfileTab>("Posts");
  const [stats, setStats] = useState<ProfileStats>(EMPTY_STATS);
  const [profile, setProfile] = useState<Profile | undefined>(undefined);
  const [profileLoading, setProfileLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    let cancelled = false;

    getProfileStats(userId).then((result) => {
      if (!cancelled) setStats(result);
    });

    getProfile(userId).then((result) => {
      if (!cancelled) {
        setProfile(result);
        setProfileLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const myPosts = user ? posts.filter((post) => post.userId === user.id) : [];
  const savedPosts = posts.filter((post) => savedPostIds.includes(post.id));
  const likedPosts = posts.filter((post) => likedPostIds.includes(post.id));
  const gridPosts = activeTab === "Posts" ? myPosts : activeTab === "Saved" ? savedPosts : likedPosts;
  const emptyCopy =
    activeTab === "Posts" ? "No posts yet." : activeTab === "Saved" ? "No saved posts yet." : "Nothing marked helpful yet.";

  if (profileLoading || !profile) {
    return <ProfileHeaderSkeleton />;
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <ProfileHeader
        profile={profile}
        headerActions={
          <>
            <Link
              href="/me/edit"
              className="rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/25"
            >
              Edit Profile
            </Link>
            <button
              type="button"
              onClick={() => signOut()}
              className="rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/25"
            >
              Log out
            </button>
          </>
        }
      />

      <div className="relative rounded-t-3xl bg-[#fbfaf7] pb-28 pt-11">
        <div className="flex items-center justify-around border-b border-stone-100 px-4 pb-4">
          <Link href="/me/following" className="text-center">
            <p className="text-base font-black text-stone-900">{stats.followingCount}</p>
            <p className="text-[11px] font-semibold text-stone-500">Following</p>
          </Link>
          <Link href="/me/followers" className="text-center">
            <p className="text-base font-black text-stone-900">{stats.followersCount}</p>
            <p className="text-[11px] font-semibold text-stone-500">Followers</p>
          </Link>
          <div className="text-center">
            <p className="text-base font-black text-stone-900">{stats.likesAndSavesCount}</p>
            <p className="text-[11px] font-semibold text-stone-500">Helpful + Saves</p>
          </div>
        </div>

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
              <p className="text-sm text-stone-400">{emptyCopy}</p>
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
