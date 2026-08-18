"use client";

import Link from "next/link";
import TextPostVisual from "@/components/post/TextPostVisual";
import { formatShortDate, getDisplayTitle, resolveImageAspectRatio } from "@/lib/postDisplay";
import { paginateText } from "@/lib/textPagination";
import type { Post } from "@/types/post";
import DemoPhoto from "./DemoPhoto";
import PostVideoTile from "./PostVideoTile";

/** Purely decorative "multiple photos" glyph — no count, no click behavior. */
function StackedPhotosIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3"
    >
      <rect x="3" y="7" width="14" height="14" rx="2" />
      <path d="M7 7V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2" />
    </svg>
  );
}

function PostCardMedia({ post }: { post: Post }) {
  const cover = post.media[0];

  if (!cover) {
    // A templated text post (Phase 6A) — only ever page 1 here, matching
    // "the masonry feed shows page 1 only"; PostDetail is where every page
    // becomes visible. A pre-Phase-6A text post has no textTemplate, so it
    // falls through to the plain title/author-only card exactly as before.
    if (post.textTemplate) {
      const pages = paginateText(post.caption, post.textTemplate);
      return (
        <div className="relative">
          <TextPostVisual template={post.textTemplate} text={pages[0]} size="card" />
          {pages.length > 1 ? (
            <span
              aria-hidden="true"
              className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold text-white"
            >
              1/{pages.length}
            </span>
          ) : null}
        </div>
      );
    }

    // A post with no media at all and no template — dead space would just
    // be visual noise, so the card stays naturally compact without one.
    return null;
  }

  if (cover.type === "video") {
    return <PostVideoTile src={cover.url} className="aspect-[4/5]" />;
  }

  return (
    <div className="relative">
      <DemoPhoto
        src={cover.url}
        alt={getDisplayTitle(post)}
        className="w-full"
        style={{ aspectRatio: resolveImageAspectRatio(cover.aspectRatio) }}
      />
      {post.media.length > 1 ? (
        <span
          aria-hidden="true"
          className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-black/60 text-white"
        >
          <StackedPhotosIcon />
        </span>
      ) : null}
    </div>
  );
}

type PostCardProps = {
  post: Post;
};

function PostCardAuthor({ post }: { post: Post }) {
  const content = (
    <>
      {post.authorAvatarUrl ? (
        <DemoPhoto src={post.authorAvatarUrl} alt="" className="size-4 shrink-0 rounded-full" />
      ) : (
        <span className="grid size-4 shrink-0 place-items-center rounded-full bg-stone-200 text-[8px] font-black text-stone-600">
          {post.authorDisplayName.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="truncate text-[11px] font-medium text-stone-500">{post.authorDisplayName}</span>
    </>
  );

  // Degrade safely: a post with no real owner (e.g. authored before auth
  // existed) gets plain, unlinked author text rather than a fake profile link.
  const authorIdentity = !post.userId ? (
    <div className="flex min-w-0 items-center gap-1.5">{content}</div>
  ) : (
    <Link href={`/profile/${post.userId}`} className="flex min-w-0 items-center gap-1.5">
      {content}
    </Link>
  );

  const date = formatShortDate(post.createdAt);

  return (
    <div className="mt-1.5 flex items-center justify-between gap-2">
      {authorIdentity}
      {date ? <span className="shrink-0 text-[11px] text-stone-400">{date}</span> : null}
    </div>
  );
}

export default function PostCard({ post }: PostCardProps) {
  return (
    <article className="mb-2.5 break-inside-avoid overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(55,45,35,0.06),0_6px_16px_rgba(55,45,35,0.05)]">
      <Link href={`/post/${post.id}`}>
        <PostCardMedia post={post} />

        <div className="px-2.5 pt-2.5">
          <h2 className="text-[13px] font-bold leading-snug text-stone-900">
            {getDisplayTitle(post)}
          </h2>
        </div>
      </Link>

      <div className="px-2.5 pb-2.5">
        <PostCardAuthor post={post} />
      </div>
    </article>
  );
}
