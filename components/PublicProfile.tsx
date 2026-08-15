"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import PostCard from "@/components/PostCard";
import ProfileHeader from "@/components/profile/ProfileHeader";
import { useAuth } from "@/lib/auth/AuthProvider";
import { followUser, getProfileStats, unfollowUser, useIsFollowing, type ProfileStats } from "@/lib/interactions";
import { getOrCreateConversation } from "@/lib/messages";
import { getPostsByUserIds } from "@/lib/posts";
import { getProfile, type Profile } from "@/lib/profiles";
import type { Post } from "@/types/post";

type PublicProfileProps = {
  userId: string;
};

const EMPTY_STATS: ProfileStats = { followingCount: 0, followersCount: 0, likesAndSavesCount: 0 };

function ProfileHeaderSkeleton() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7]">
      <div className="h-56 w-full animate-pulse bg-stone-200" />
    </main>
  );
}

export default function PublicProfile({ userId }: PublicProfileProps) {
  const router = useRouter();
  const { user, signInWithGoogle } = useAuth();
  const [profile, setProfile] = useState<Profile | undefined>(undefined);
  const [profileLoading, setProfileLoading] = useState(true);
  const [posts, setPosts] = useState<Post[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [stats, setStats] = useState<ProfileStats>(EMPTY_STATS);
  const { isFollowing: isFollowingFromQuery } = useIsFollowing(userId);
  // null means "no local action yet this session, trust the fetched query
  // value" — same optimistic-override pattern PostDetail uses for Follow.
  const [followOverride, setFollowOverride] = useState<boolean | null>(null);
  const [isOpeningConversation, setIsOpeningConversation] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setProfileLoading(true);
      setPostsLoading(true);
      setFollowOverride(null);

      getProfile(userId).then((result) => {
        if (!cancelled) {
          setProfile(result);
          setProfileLoading(false);
        }
      });

      getPostsByUserIds([userId]).then((result) => {
        if (!cancelled) {
          setPosts(result);
          setPostsLoading(false);
        }
      });

      getProfileStats(userId).then((result) => {
        if (!cancelled) setStats(result);
      });
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const isOwnProfile = Boolean(user && user.id === userId);
  const isFollowing = followOverride ?? isFollowingFromQuery;

  async function handleToggleFollow() {
    if (!user) {
      void signInWithGoogle();
      return;
    }
    const wasFollowing = isFollowing;
    setFollowOverride(!wasFollowing);
    try {
      if (wasFollowing) await unfollowUser(user.id, userId);
      else await followUser(user.id, userId);
    } catch {
      setFollowOverride(wasFollowing);
    }
  }

  async function handleMessage() {
    if (!user) {
      void signInWithGoogle();
      return;
    }
    if (isOpeningConversation) return;

    setMessageError(null);
    setIsOpeningConversation(true);
    try {
      const conversationId = await getOrCreateConversation(userId);
      router.push(`/messages/${conversationId}`);
    } catch (err) {
      setMessageError(err instanceof Error ? err.message : "Couldn't start a conversation.");
      setIsOpeningConversation(false);
    }
  }

  if (profileLoading) {
    return <ProfileHeaderSkeleton />;
  }

  if (!profile) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center bg-[#fbfaf7] px-8 text-center">
        <h1 className="text-lg font-black">Profile not found</h1>
        <p className="mt-2 text-sm text-stone-500">This user may no longer exist.</p>
        <Link href="/" className="mt-5 inline-flex rounded-full bg-stone-900 px-5 py-2.5 text-sm font-bold text-white">
          Back to Explore
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-16 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <ProfileHeader profile={profile} onBack={() => router.back()} />

      <div className="relative rounded-t-3xl bg-[#fbfaf7] pt-11">
        <div className="flex items-center justify-around border-b border-stone-100 px-4 pb-4">
          <div className="text-center">
            <p className="text-base font-black text-stone-900">{stats.followingCount}</p>
            <p className="text-[11px] font-semibold text-stone-500">Following</p>
          </div>
          <div className="text-center">
            <p className="text-base font-black text-stone-900">{stats.followersCount}</p>
            <p className="text-[11px] font-semibold text-stone-500">Followers</p>
          </div>
          <div className="text-center">
            <p className="text-base font-black text-stone-900">{stats.likesAndSavesCount}</p>
            <p className="text-[11px] font-semibold text-stone-500">Likes &amp; Saves</p>
          </div>
        </div>

        {!isOwnProfile ? (
          <div className="px-4 pt-4">
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={handleToggleFollow}
                aria-pressed={isFollowing}
                aria-label={isFollowing ? "Unfollow" : "Follow"}
                className={`flex-1 rounded-xl py-2.5 text-sm font-bold ${
                  isFollowing ? "bg-stone-100 text-stone-500" : "bg-stone-900 text-white"
                }`}
              >
                {isFollowing ? "Following" : "Follow"}
              </button>
              <button
                type="button"
                onClick={handleMessage}
                disabled={isOpeningConversation}
                className="flex-1 rounded-xl bg-stone-100 py-2.5 text-center text-sm font-bold text-stone-600 disabled:opacity-60"
              >
                {isOpeningConversation ? "Opening…" : "Message"}
              </button>
            </div>
            {messageError ? <p className="mt-2 text-center text-xs font-semibold text-red-600">{messageError}</p> : null}
          </div>
        ) : null}

        <div className="px-4 pb-2 pt-6">
          <h2 className="text-sm font-black text-stone-900">Posts</h2>
        </div>

        <div className="p-3">
          {postsLoading ? (
            <div className="columns-2 gap-2">
              {[0, 1, 2, 3].map((key) => (
                <div key={key} className="mb-2 h-40 animate-pulse rounded-2xl bg-stone-200" />
              ))}
            </div>
          ) : posts.length > 0 ? (
            <div className="columns-2 gap-2">
              {posts.map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
          ) : (
            <div className="py-16 text-center">
              <p className="text-sm text-stone-400">No posts yet.</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
