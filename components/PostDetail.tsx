"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import DemoPhoto from "@/components/DemoPhoto";
import { useSavedPostIds } from "@/components/PostCard";
import { getDisplayTitle } from "@/lib/postDisplay";
import { useAllPosts } from "@/lib/posts";

type PostDetailProps = {
  postId: number;
};

export default function PostDetail({ postId }: PostDetailProps) {
  const router = useRouter();
  const posts = useAllPosts();
  const post = posts.find((candidate) => candidate.id === postId);
  const savedPostIds = useSavedPostIds();

  if (!post) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center bg-[#fbfaf7] px-8 text-center">
        <h1 className="text-lg font-black">Post not found</h1>
        <p className="mt-2 text-sm text-stone-500">It may have been removed.</p>
        <Link href="/" className="mt-5 inline-flex rounded-full bg-stone-900 px-5 py-2.5 text-sm font-bold text-white">
          Back to Explore
        </Link>
      </main>
    );
  }

  const isSaved = savedPostIds.includes(post.id);

  function toggleSaved() {
    if (!post) return;
    const nextSavedPostIds = isSaved
      ? savedPostIds.filter((id) => id !== post.id)
      : [...savedPostIds, post.id];
    localStorage.setItem("pinwall_saved", JSON.stringify(nextSavedPostIds));
    window.dispatchEvent(new Event("pinwall-saved-change"));
  }

  const backButton = (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label="Go back"
      className="grid size-9 place-items-center rounded-full bg-white/95 text-lg font-bold text-stone-800 shadow-lg backdrop-blur"
    >
      ‹
    </button>
  );

  const saveButton = (
    <button
      type="button"
      onClick={toggleSaved}
      aria-label="Save"
      aria-pressed={isSaved}
      className={`grid size-9 place-items-center rounded-full text-base shadow-lg backdrop-blur ${
        isSaved ? "bg-orange-500 text-white" : "bg-white/95 text-stone-700"
      }`}
    >
      {isSaved ? "♥" : "♡"}
    </button>
  );

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-28 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      {post.postType === "text" ? (
        <div className="flex items-center justify-between px-5 pt-5">
          {backButton}
          {saveButton}
        </div>
      ) : (
        <div className="relative">
          {post.postType === "video" && post.image ? (
            // Do not autoplay with sound — playback starts only via the native controls.
            <video
              src={post.image}
              controls
              playsInline
              preload="metadata"
              className="aspect-[4/3] w-full bg-black object-contain"
            />
          ) : (
            <DemoPhoto src={post.image ?? ""} alt={post.imageAlt ?? ""} className="aspect-[4/3] w-full" />
          )}
          <div className="absolute left-3 top-3">{backButton}</div>
          <div className="absolute right-3 top-3">{saveButton}</div>
        </div>
      )}

      <div className="px-5 pt-5">
        {post.locationName ? (
          <Link
            href="/map"
            className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.14em] text-orange-600"
          >
            📍 {post.locationName}
          </Link>
        ) : null}

        <h1 className="mt-1.5 text-xl font-black leading-tight text-stone-900">{getDisplayTitle(post)}</h1>

        <p className="mt-2 text-sm font-bold text-stone-700">
          <span className="text-orange-500">★</span> {post.rating} · {post.ratingCount} ratings
        </p>

        <p
          className={`mt-4 text-stone-600 ${
            post.postType === "text" ? "text-base leading-8" : "text-sm leading-6"
          }`}
        >
          {post.caption}
        </p>

        {post.tags.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-700"
              >
                #{tag}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-5 border-t border-stone-200 pt-4">
          <span className="text-sm font-semibold text-stone-500">Shared by {post.author}</span>
        </div>
      </div>
    </main>
  );
}
