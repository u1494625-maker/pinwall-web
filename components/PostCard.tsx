"use client";

import Link from "next/link";
import TextPostVisual from "@/components/post/TextPostVisual";
import { useAuth } from "@/lib/auth/AuthProvider";
import { formatShortDate, getDisplayTitle, resolveImageAspectRatio } from "@/lib/postDisplay";
import { logDetailClickEvent } from "@/lib/recommendation/events";
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
    // A templated text post — the template IS the post's visual cover,
    // showing its title, exactly like a photo cover shows the photo. The
    // headline below (in PostCard itself) is skipped for these so the title
    // never appears twice. A text post with no template (published before
    // this feature, or without one) falls through to the plain
    // title/author-only card exactly as before.
    if (post.textTemplate) {
      return <TextPostVisual template={post.textTemplate} text={getDisplayTitle(post)} size="card" />;
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
  /** True only for cards rendered inside Home/Explore's own feed tabs
   *  (Explore, Following, Maps-filter) — marks the outgoing link so
   *  PostDetail knows this view is allowed to become the restorable "Home"
   *  route (see lib/homeRoute.ts). Every other feed surface (Me, Profile,
   *  Search, Tag, Map cluster) omits this, so opening a post from there
   *  never overwrites Home's saved route. */
  homeOriginated?: boolean;
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

export default function PostCard({ post, homeOriginated = false }: PostCardProps) {
  const { user } = useAuth();

  // Fires only on a real click on this link — never on mount, refresh, or a
  // ?postId= deep link, since those never trigger a click event here at
  // all. Fire-and-forget: never awaited, so a slow/failed insert can never
  // delay the navigation the click already triggers.
  function handleOpen() {
    if (user) {
      logDetailClickEvent(user.id, post.id);
    }
  }

  return (
    <article className="mb-2.5 break-inside-avoid overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(55,45,35,0.06),0_6px_16px_rgba(55,45,35,0.05)]">
      <Link href={homeOriginated ? `/post/${post.id}?from=home` : `/post/${post.id}`} onClick={handleOpen}>
        <PostCardMedia post={post} />

        {/* The templated-text cover above already shows the title — repeating
            it here would be a literal duplicate, not a supporting caption. */}
        {!post.textTemplate ? (
          <div className="px-2.5 pt-2.5">
            <h2 className="text-[13px] font-bold leading-snug text-stone-900">
              {getDisplayTitle(post)}
            </h2>
          </div>
        ) : null}
      </Link>

      <div className="px-2.5 pb-2.5">
        <PostCardAuthor post={post} />
      </div>
    </article>
  );
}
