"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import TextPostVisual from "@/components/post/TextPostVisual";
import { useAuth } from "@/lib/auth/AuthProvider";
import { formatRelativeDate, getDisplayTitle, resolveImageAspectRatio } from "@/lib/postDisplay";
import { getViewportSeenPostIds, markPostViewportSeen } from "@/lib/recommendation/exploreViewportSeen";
import { logDetailClickEvent } from "@/lib/recommendation/events";
import type { Post } from "@/types/post";
import DemoPhoto from "./DemoPhoto";
import PostVideoTile from "./PostVideoTile";

// A card only counts as seen once at least 70% of it is visible -- and
// since the effect below only acts on entry.isIntersecting (the crossing
// INTO view), a sliver of a pixel can never qualify either.
const VIEWPORT_SEEN_THRESHOLD = 0.7;

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

/** Purely decorative pin glyph for the location signal below — kept tiny and
 *  outlined so it reads as a subtle label icon, not a call to action. */
function LocationPinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-2.5 shrink-0">
      <path d="M12 22s7-7.58 7-12.5A7 7 0 0 0 5 9.5C5 14.42 12 22 12 22Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}

/** Outlined thumbs-up — same glyph family as PostDetail's Helpful button
 *  (components/post/PostDetail.tsx), kept purely as a read-only count badge
 *  here (no toggle behavior on the card itself). */
function ThumbsUpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-2.5 shrink-0">
      <path d="M7 22V10M2 13v7a2 2 0 0 0 2 2h12.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14V5a3 3 0 0 0-3-3l-4 9v2" />
    </svg>
  );
}

/** Purely decorative eye glyph for the view-count overlay below. */
function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-3">
      <path d="M1 12s4.5-7 11-7 11 7 11 7-4.5 7-11 7-11-7-11-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Small, white, drop-shadowed eye + count — deliberately no background
 *  chip (unlike the dark-circle "multiple photos" badge above), so it reads
 *  as a light overlay directly on the media rather than added visual
 *  weight. Shown over any rendered cover (photo, video, or a templated
 *  text post's own visual), skipped only when there's no cover at all to
 *  overlay onto. */
function ViewCountBadge({ viewCount }: { viewCount: number }) {
  return (
    <span
      aria-hidden="true"
      className="absolute bottom-1.5 left-1.5 flex items-center gap-0.5 text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.55)]"
    >
      <EyeIcon />
      <span className="text-[11px] font-bold leading-none">{viewCount}</span>
    </span>
  );
}

function PostCardMedia({
  post,
  isOwner,
}: {
  post: Post;
  isOwner: boolean;
}) {
  const cover = post.media[0];

  // A post with no media at all and no template has no cover — dead space
  // would just be visual noise, so the card stays naturally compact
  // without one, and there's nothing here for a view badge to sit on top of.
  if (!cover && !post.textTemplate) {
    return null;
  }

  return (
    <div className="relative">
      {!cover ? (
        // A templated text post — the template IS the post's visual cover,
        // showing its title, exactly like a photo cover shows the photo.
        // The headline below (in PostCard itself) is skipped for these so
        // the title never appears twice.
        <TextPostVisual template={post.textTemplate!} text={getDisplayTitle(post)} size="card" />
      ) : cover.type === "video" ? (
        <PostVideoTile src={cover.url} className="aspect-[4/5]" />
      ) : (
        <>
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
        </>
      )}
      {/* view_count itself is incremented only by PostDetail (see
          incrementPostView there) — this only controls who's ALLOWED to SEE
          the number, same private-to-the-author visibility as a private
          analytics stat. */}
      {isOwner ? <ViewCountBadge viewCount={post.viewCount} /> : null}
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
  /** True only for cards rendered inside Explore specifically (never
   *  Following, Maps, Profile, Search, Tag, or Map cluster) — opts this card
   *  into viewport-seen tracking (see lib/recommendation/exploreViewportSeen.ts),
   *  a scroll-driven "the user actually encountered this post" signal
   *  consumed only by Explore's refresh, completely separate from
   *  homeOriginated above and from sessionSeen.ts's own soft penalty. */
  trackViewportSeen?: boolean;
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
  return !post.userId ? (
    <div className="flex min-w-0 items-center gap-1.5">{content}</div>
  ) : (
    <Link href={`/profile/${post.userId}`} className="flex min-w-0 items-center gap-1.5">
      {content}
    </Link>
  );
}

/** WHERE + WHEN on the left (location, if any, then relative freshness —
 *  "23m"/"2h"/"3d", falling back to a short date past a week, via
 *  formatRelativeDate), HELPFUL vote count on the right. Deliberately no
 *  reward/threshold/progress info of any kind here — Helpful is always just
 *  post.likeCount, the same general-purpose community signal PostDetail's
 *  own Helpful button reads and writes, independent of any promotion. */
function PostCardMeta({ post }: { post: Post }) {
  const relativeTime = post.createdAt ? formatRelativeDate(post.createdAt) : undefined;
  const whereWhen = [post.locationName, relativeTime].filter(Boolean).join(" · ");

  return (
    <div className="mt-1 flex items-center justify-between gap-2">
      {whereWhen ? (
        <span className="flex min-w-0 items-center gap-0.5 truncate text-[10.5px] text-stone-400">
          {post.locationName ? <LocationPinIcon /> : null}
          <span className="truncate">{whereWhen}</span>
        </span>
      ) : (
        <span />
      )}
      <span className="flex shrink-0 items-center gap-0.5 text-[10.5px] font-semibold text-stone-500">
        <ThumbsUpIcon />
        {post.likeCount}
      </span>
    </div>
  );
}

export default function PostCard({ post, homeOriginated = false, trackViewportSeen = false }: PostCardProps) {
  const { user } = useAuth();
  const articleRef = useRef<HTMLElement>(null);
  // The one central place this is decided — not a route-specific prop, so
  // it's correct everywhere PostCard renders (Home/Explore, Following,
  // Maps, Me, a public profile, Search, Tag, Map cluster) with no per-page
  // wiring. Determines only whether the view-count badge is SHOWN below —
  // the count itself is never incremented from here at all (see
  // PostDetail's own incrementPostView call).
  const isOwner = Boolean(user && post.userId && user.id === post.userId);

  // Fires only on a real click on this link — never on mount, refresh, or a
  // ?postId= deep link, since those never trigger a click event here at
  // all. Fire-and-forget: never awaited, so a slow/failed insert can never
  // delay the navigation the click already triggers.
  function handleOpen() {
    if (user) {
      logDetailClickEvent(user.id, post.id);
    }
  }

  // Viewport-seen tracking (Explore only, see trackViewportSeen above) — a
  // post already marked seen an earlier time this session never gets a new
  // observer at all (nothing left to detect), and the first qualifying
  // crossing disconnects immediately, matching "recorded once per session."
  useEffect(() => {
    if (!trackViewportSeen) return;
    if (getViewportSeenPostIds().has(post.id)) return;
    const node = articleRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            markPostViewportSeen(post.id);
            observer.disconnect();
          }
        }
      },
      { threshold: VIEWPORT_SEEN_THRESHOLD },
    );
    observer.observe(node);

    return () => observer.disconnect();
  }, [trackViewportSeen, post.id]);

  return (
    <article
      ref={articleRef}
      className="mb-2.5 break-inside-avoid overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(55,45,35,0.06),0_6px_16px_rgba(55,45,35,0.05)]"
    >
      <Link href={homeOriginated ? `/post/${post.id}?from=home` : `/post/${post.id}`} onClick={handleOpen}>
        <PostCardMedia post={post} isOwner={isOwner} />

        {/* The templated-text cover above already shows the title — repeating
            it here would be a literal duplicate, not a supporting caption. */}
        {!post.textTemplate ? (
          <div className="px-2.5 pt-2.5">
            <h2 className="line-clamp-2 text-[13px] font-bold leading-snug text-stone-900">
              {getDisplayTitle(post)}
            </h2>
          </div>
        ) : null}
      </Link>

      <div className="px-2.5 pb-2.5">
        <PostCardAuthor post={post} />
        <PostCardMeta post={post} />
      </div>
    </article>
  );
}
