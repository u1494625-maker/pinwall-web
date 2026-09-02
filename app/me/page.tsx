"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import RequireAuth from "@/components/auth/RequireAuth";
import PostCard from "@/components/PostCard";
import ProfileHeader from "@/components/profile/ProfileHeader";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getProfileStats, useLikedPostIds, useSavedPostIds, type ProfileStats } from "@/lib/interactions";
import { getPostsByUserIds, useAllPosts } from "@/lib/posts";
import { getProfile, type Profile } from "@/lib/profiles";
import type { Post } from "@/types/post";

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

/** Saved/Helpful tab content, split into its own component purely so its
 *  useAllPosts() call — and the global getAllPosts() fetch it triggers —
 *  only mounts once the user actually selects one of these tabs, instead of
 *  unconditionally on every /me visit (hooks can't be called conditionally,
 *  so a child component is the smallest way to make the fetch itself
 *  conditional). Renders exactly what Saved/Helpful rendered before this
 *  split — filtering here is still not gated on any loading state, matching
 *  existing, unchanged Saved/Helpful semantics. */
function SavedOrHelpfulTab({ postIds, emptyCopy }: { postIds: number[]; emptyCopy: string }) {
  const posts = useAllPosts();
  const tabPosts = posts.filter((post) => postIds.includes(post.id));

  if (tabPosts.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-stone-400">{emptyCopy}</p>
      </div>
    );
  }

  return (
    <div className="columns-2 gap-2.5 px-3">
      {tabPosts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  );
}

function MeContent() {
  const { user } = useAuth();
  // Stable primitive so a same-user TOKEN_REFRESHED doesn't refetch stats/profile.
  const userId = user?.id ?? null;
  const { ids: savedPostIds } = useSavedPostIds();
  const { ids: likedPostIds } = useLikedPostIds();
  const [activeTab, setActiveTab] = useState<ProfileTab>("Posts");
  const [stats, setStats] = useState<ProfileStats>(EMPTY_STATS);
  const [profile, setProfile] = useState<Profile | undefined>(undefined);
  const [profileLoading, setProfileLoading] = useState(true);

  // Own posts, scoped to this one user (getPostsByUserIds([userId])) rather
  // than filtered out of every post in the app — own loading/error state, so
  // profile/header/stats aren't blocked on this, and a failed fetch can be
  // told apart from a genuine zero-posts result (see the render below).
  const [ownPosts, setOwnPosts] = useState<Post[]>([]);
  const [ownPostsLoading, setOwnPostsLoading] = useState(true);
  const [ownPostsError, setOwnPostsError] = useState(false);
  const [ownPostsRetryToken, setOwnPostsRetryToken] = useState(0);

  useEffect(() => {
    if (!userId) return;
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
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    getPostsByUserIds([userId])
      .then((result) => {
        if (cancelled) return;
        setOwnPosts(result);
        setOwnPostsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setOwnPostsLoading(false);
        setOwnPostsError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [userId, ownPostsRetryToken]);

  function retryOwnPosts() {
    setOwnPostsLoading(true);
    setOwnPostsError(false);
    setOwnPostsRetryToken((token) => token + 1);
  }

  if (profileLoading || !profile) {
    return <ProfileHeaderSkeleton />;
  }

  // Same default-background test ProfileHeader itself uses, duplicated here
  // only because headerActions renders outside ProfileHeader's own DOM (it's
  // passed in as a plain ReactNode) — keeps the Edit Profile pill legible
  // against either variant of the header background.
  const hasPhoto = Boolean(profile.backgroundUrl || profile.avatarUrl);
  // Helpful received across every post this user has authored — summed
  // client-side from ownPosts' own already-fetched likeCount (real-time via
  // get_post_engagement), never a separate "Helpful + Saves" combined
  // figure. Saves stay private, surfaced only via the existing Saved tab.
  const helpfulCount = ownPosts.reduce((sum, post) => sum + post.likeCount, 0);

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <ProfileHeader
        profile={profile}
        headerActions={
          <Link
            href="/me/edit"
            className={`rounded-full px-3 py-1 text-[11px] font-medium backdrop-blur-sm transition-colors ${
              hasPhoto
                ? "bg-white/15 text-white/90 hover:bg-white/25"
                : "bg-kavanaka-ink/8 text-kavanaka-ink hover:bg-kavanaka-ink/15"
            }`}
          >
            Edit Profile
          </Link>
        }
      />

      <div className="relative rounded-t-3xl bg-[#fbfaf7] pb-28 pt-11">
        <div className="flex items-center justify-around border-b border-stone-100 px-4 pb-4">
          <div className="text-center">
            <p className="text-base font-black text-stone-900">{ownPosts.length}</p>
            <p className="text-[11px] font-semibold text-stone-500">Posts</p>
          </div>
          <Link href="/me/following" className="text-center">
            <p className="text-base font-black text-stone-900">{stats.followingCount}</p>
            <p className="text-[11px] font-semibold text-stone-500">Following</p>
          </Link>
          <Link href="/me/followers" className="text-center">
            <p className="text-base font-black text-stone-900">{stats.followersCount}</p>
            <p className="text-[11px] font-semibold text-stone-500">Followers</p>
          </Link>
          <div className="text-center">
            <p className="text-base font-black text-stone-900">{helpfulCount}</p>
            <p className="text-[11px] font-semibold text-stone-500">Helpful</p>
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
                  <span className="absolute inset-x-0 -bottom-px mx-auto h-[2.5px] w-8 rounded-full bg-kavanaka-lime" />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="pt-3">
          {activeTab === "Posts" ? (
            ownPostsLoading ? (
              <div className="columns-2 gap-2.5 px-3">
                {[0, 1, 2, 3].map((key) => (
                  <div key={key} className="mb-2.5 h-40 animate-pulse rounded-2xl bg-stone-200" />
                ))}
              </div>
            ) : ownPostsError ? (
              <div className="py-16 text-center">
                <p className="text-sm text-stone-500">Couldn&apos;t load posts.</p>
                <button
                  type="button"
                  onClick={retryOwnPosts}
                  className="mt-5 inline-flex rounded-full bg-stone-900 px-5 py-2.5 text-sm font-bold text-white"
                >
                  Try again
                </button>
              </div>
            ) : ownPosts.length > 0 ? (
              <div className="columns-2 gap-2.5 px-3">
                {ownPosts.map((post) => (
                  <PostCard key={post.id} post={post} />
                ))}
              </div>
            ) : (
              <div className="py-16 text-center">
                <p className="text-sm text-stone-400">No posts yet.</p>
              </div>
            )
          ) : (
            <SavedOrHelpfulTab
              postIds={activeTab === "Saved" ? savedPostIds : likedPostIds}
              emptyCopy={activeTab === "Saved" ? "No saved posts yet." : "Nothing marked helpful yet."}
            />
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
