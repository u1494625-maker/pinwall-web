import Link from "next/link";
import type { Post } from "@/types/post";
import PostCard from "./PostCard";

const SKELETON_HEIGHTS = ["h-40", "h-56", "h-32", "h-48", "h-60", "h-36"];

/**
 * Neutral placeholder shown only while posts are loading — never a real empty
 * state. Shares this file with MasonryFeed so its columns-2 gap-2.5 px-3
 * wrapper always stays visibly in sync with the real feed's own layout.
 */
export function FeedSkeleton() {
  return (
    <div className="columns-2 gap-2.5 px-3">
      {SKELETON_HEIGHTS.map((height, index) => (
        <div
          key={index}
          className={`mb-2.5 break-inside-avoid animate-pulse overflow-hidden rounded-2xl bg-stone-200 ${height}`}
        />
      ))}
    </div>
  );
}

type MasonryFeedProps = {
  posts: Post[];
  /** Threaded straight through to each PostCard — see PostCard's own doc
   *  comment. Only PinWallHome's own tabs pass this. */
  homeOriginated?: boolean;
  /** Threaded straight through to each PostCard — see PostCard's own doc
   *  comment. Only PinWallHome's Explore tab passes this (never Following,
   *  Maps, or any other feed surface). */
  trackViewportSeen?: boolean;
};

export default function MasonryFeed({ posts, homeOriginated = false, trackViewportSeen = false }: MasonryFeedProps) {
  if (posts.length === 0) {
    return (
      <div className="mx-4 rounded-3xl border border-dashed border-stone-300 bg-white px-6 py-14 text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-kavanaka-lime/15 text-2xl">+</div>
        <h2 className="text-lg font-bold">No spots yet</h2>
        <p className="mt-2 text-sm text-stone-500">Be the first to share a place worth visiting.</p>
        <Link href="/add" className="mt-5 inline-flex rounded-full bg-stone-900 px-5 py-2.5 text-sm font-bold text-white">
          + Add a Spot
        </Link>
      </div>
    );
  }

  return (
    <div className="columns-2 gap-2.5 px-3">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} homeOriginated={homeOriginated} trackViewportSeen={trackViewportSeen} />
      ))}
    </div>
  );
}
