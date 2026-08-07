import Link from "next/link";
import type { Post } from "@/types/post";
import PostCard from "./PostCard";

type MasonryFeedProps = {
  posts: Post[];
};

export default function MasonryFeed({ posts }: MasonryFeedProps) {
  if (posts.length === 0) {
    return (
      <div className="mx-4 rounded-3xl border border-dashed border-stone-300 bg-white px-6 py-14 text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-orange-100 text-2xl">+</div>
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
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  );
}
