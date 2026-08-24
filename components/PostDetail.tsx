"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import DemoPhoto from "@/components/DemoPhoto";
import LinkifiedText from "@/components/LinkifiedText";
import PostMediaGallery from "@/components/PostMediaGallery";
import CommentThread from "@/components/post/CommentThread";
import PostManageSheet from "@/components/post/PostManageSheet";
import ReportModal from "@/components/post/ReportModal";
import TextPostVisual from "@/components/post/TextPostVisual";
import { useAuth } from "@/lib/auth/AuthProvider";
import { deleteComment, getCommentsForPost, type Comment } from "@/lib/comments";
import { saveHomeRoute } from "@/lib/homeRoute";
import { followUser, likePost, savePost, unfollowUser, unlikePost, unsavePost, useIsFollowing } from "@/lib/interactions";
import { hasValidMapLocation } from "@/lib/map/viewport";
import { formatRelativeDate, getDisplayTitle } from "@/lib/postDisplay";
import { isCurrentUserAdmin } from "@/lib/admin";
import { getPostById, getPostForModeration } from "@/lib/posts";
import { reportComment, reportPost } from "@/lib/reports";
import type { Post, PostMedia } from "@/types/post";

type PostDetailProps = {
  postId: number;
  /** From /post/[id]?mediaId=... (e.g. a Map marker for a specific photo) —
   *  seeds which photo the gallery opens on. Undefined for a plain link,
   *  which behaves exactly as before (opens on media[0]). */
  initialMediaId?: number;
  /** From /post/[id]?moderate=1 — the explicit moderation-tool marker (see
   *  ModerationQueue.tsx's "View" links). The ONLY thing that makes the load
   *  effect below ever attempt the admin fallback fetch on a not-found post;
   *  a plain visit, even by an admin, never does. Defaults to false so every
   *  other PostDetail caller is unaffected. */
  isModerationView?: boolean;
  /** From /post/[id]?from=home — set only by PostCard links rendered inside
   *  Home/Explore's own feed tabs (see PostCard.tsx). The ONLY thing that
   *  lets this view record itself as the restorable "Home" route (see the
   *  saveHomeRoute effect below and lib/homeRoute.ts). Defaults to false, so
   *  a post opened from Me, a profile, Map, Search, a tag, or a shared link
   *  never overwrites Home's saved state. */
  isHomeOriginated?: boolean;
};

/** Avatar + name, linking to the author's public profile — real userId only,
 *  never derived from the display-only author string. Degrades to plain,
 *  unlinked text for posts with no owner (e.g. authored before auth existed). */
function PostAuthorIdentity({ post }: { post: Post }) {
  const content = (
    <>
      {post.authorAvatarUrl ? (
        <DemoPhoto src={post.authorAvatarUrl} alt="" className="size-9 shrink-0 rounded-full" />
      ) : (
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-stone-200 text-sm font-black text-stone-600">
          {post.authorDisplayName.charAt(0).toUpperCase()}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-stone-900">{post.authorDisplayName}</p>
        {post.createdAt ? <p className="text-[11px] text-stone-400">{formatRelativeDate(post.createdAt)}</p> : null}
      </div>
    </>
  );

  if (!post.userId) {
    return <div className="flex min-w-0 flex-1 items-center gap-3">{content}</div>;
  }

  return (
    <Link href={`/profile/${post.userId}`} className="flex min-w-0 flex-1 items-center gap-3">
      {content}
    </Link>
  );
}

function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
      <path d="M16 6l-4-4-4 4" />
      <path d="M12 2v14" />
    </svg>
  );
}

/** Outlined speech bubble with a lower-right tail — Comments. Built by
 *  horizontally mirroring the standard "message square" bubble shape (whose
 *  tail natively points lower-left) via an SVG transform, rather than
 *  hand-deriving new curve coordinates by hand. */
function CommentIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-[24px]"
    >
      <path transform="scale(-1,1) translate(-24,0)" d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** Outlined thumbs-up — Helpful. `filled` swaps to a solid fill for the
 *  active state. Same 24x24/stroke-2 convention as the other action icons. */
function ThumbsUpIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-[24px]"
    >
      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
    </svg>
  );
}

/** Outlined star — Save. `filled` swaps to a solid fill for the saved state. */
function SaveIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-[24px]"
    >
      <path d="M12 2.5l2.9 6.26 6.9.74-5.2 4.53 1.5 6.97L12 17.27l-6.1 3.73 1.5-6.97-5.2-4.53 6.9-.74L12 2.5Z" />
    </svg>
  );
}

/** Outlined flag — report a post/comment. */
function FlagIcon({ className = "size-[24px]" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M5 21V4" />
      <path d="M5 4h13l-3 4.5L18 13H5" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-[24px]">
      <circle cx="5" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="19" cy="12" r="1.75" />
    </svg>
  );
}

/** Which photo the gallery should open on: the requested mediaId if it
 *  actually belongs to this post, otherwise media[0] — same "media[0] is the
 *  canonical default" convention used everywhere else in this codebase. */
function resolveInitialMedia(post: Post, initialMediaId: number | undefined): PostMedia | null {
  if (post.media.length === 0) return null;
  if (initialMediaId != null) {
    const match = post.media.find((item) => item.id === initialMediaId);
    if (match) return match;
  }
  return post.media[0];
}

/** Neutral placeholder shown only while posts are loading — never the real "not found" state. */
function PostDetailSkeleton() {
  return (
    <main className="relative mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-24 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <div className="flex items-center gap-3 border-b border-stone-100 px-4 py-3">
        <div className="size-9 shrink-0 animate-pulse rounded-full bg-stone-200" />
        <div className="size-9 shrink-0 animate-pulse rounded-full bg-stone-200" />
        <div className="h-4 flex-1 animate-pulse rounded bg-stone-200" />
        <div className="size-9 shrink-0 animate-pulse rounded-full bg-stone-200" />
      </div>
      <div className="aspect-[4/5] w-full animate-pulse bg-stone-200" />
      <div className="space-y-3 px-5 pt-5">
        <div className="h-5 w-3/4 animate-pulse rounded bg-stone-200" />
        <div className="h-4 w-full animate-pulse rounded bg-stone-200" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-stone-200" />
      </div>
    </main>
  );
}

export default function PostDetail({
  postId,
  initialMediaId,
  isModerationView = false,
  isHomeOriginated = false,
}: PostDetailProps) {
  const router = useRouter();
  const { user, signInWithGoogle } = useAuth();
  // A dedicated, fresh, per-id fetch — never the shared cross-page
  // cachedAllPosts cache (see useAllPostsState in lib/posts.ts). That cache
  // is fetched once per Home/Map/Search mount and shared app-wide; reading
  // "does this exact post still exist for me" from it meant an already-warm
  // tab could keep showing a post an admin had since removed, since RLS's
  // moderation_status filter only ever applied the next time that shared
  // cache happened to refetch, not the moment this specific page opened.
  // getPostById issues its own RLS-governed query on every mount/id change,
  // so a removed post is excluded immediately, every time, including for its
  // own author — while an admin's bypass policy still applies exactly as it
  // does for every other posts read.
  const [fetchedPost, setFetchedPost] = useState<Post | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load(id: number) {
      // An invalid route param (e.g. /post/not-a-number) is treated the same
      // as a real id that doesn't resolve to anything — never sent to
      // Supabase, matching ConversationScreen's identical guard.
      if (!Number.isFinite(id)) {
        setFetchedPost(undefined);
        setLoading(false);
        return;
      }

      setLoading(true);
      let result = await getPostById(id);

      // Explicitly moderation-triggered only — never attempted on an
      // ordinary 404, including for an admin casually browsing. The real
      // security boundary is get_post_for_moderation's own admin check on
      // every call, unconditionally; this is purely a client-side gate to
      // avoid the extra round trip on every other "not found" case.
      if (!result && isModerationView) {
        const isAdmin = await isCurrentUserAdmin();
        if (!cancelled && isAdmin) {
          result = await getPostForModeration(id);
        }
      }

      if (!cancelled) {
        setFetchedPost(result);
        setLoading(false);
      }
    }

    load(postId);

    return () => {
      cancelled = true;
    };
  }, [postId, isModerationView]);

  // Reporting this post immediately makes it behave as if it were already
  // gone for this viewer — the same "not found" state a genuinely deleted
  // post already produces — without waiting for a refetch. This matches
  // exactly what a refresh would show anyway, since the RLS policy no
  // longer returns this post to its reporter.
  const [locallyReportedPostId, setLocallyReportedPostId] = useState<number | null>(null);
  const post = postId === locallyReportedPostId ? undefined : fetchedPost;
  const { isFollowing: isFollowingFromQuery } = useIsFollowing(post?.userId);
  const commentsSectionRef = useRef<HTMLDivElement>(null);
  const commentInputRef = useRef<HTMLInputElement>(null);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  // null means "no gallery interaction yet this session, trust the derived
  // default" — same override idiom as likeOverride/saveOverride/followOverride
  // below. Drives the page indicator, View on Map targeting, and stays the
  // one single source of truth for "which photo is active" (see
  // PostMediaGallery's onActiveMediaChange).
  const [activeMediaOverride, setActiveMediaOverride] = useState<PostMedia | null>(null);
  // Computed here (rather than after the loading/not-found early returns
  // below, where it conceptually belongs) only so the home-route-recording
  // effect right below can depend on it — hooks can't follow a conditional
  // return. Safe even before `post` resolves: resolveInitialMedia already
  // requires a real Post, so this stays null for exactly as long as `post`
  // itself is undefined/loading.
  const activeMedia = post ? (activeMediaOverride ?? resolveInitialMedia(post, initialMediaId)) : null;
  const [manageSheetOpen, setManageSheetOpen] = useState(false);
  // Bumped only when opening, so PostManageSheet remounts with fresh internal state each
  // time — it stays mounted (same key) through its own close animation when closing.
  const [manageSheetKey, setManageSheetKey] = useState(0);
  // Optimistic overrides — null means "no local action yet this session, trust
  // the fetched post/query value." Like, Save, and Follow each get their own
  // independent override; none of them share state with each other.
  const [likeOverride, setLikeOverride] = useState<{ liked: boolean; count: number } | null>(null);
  const [saveOverride, setSaveOverride] = useState<{ saved: boolean; count: number } | null>(null);
  const [followOverride, setFollowOverride] = useState<boolean | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [deletingCommentId, setDeletingCommentId] = useState<number | null>(null);
  // What ReportModal is currently open for — meaningless while
  // reportModalOpen is false, so its initial value doesn't matter.
  const [reportTarget, setReportTarget] = useState<{ type: "post" } | { type: "comment"; commentId: number }>({
    type: "post",
  });
  const [reportModalOpen, setReportModalOpen] = useState(false);
  // Bumped only when opening, same convention as manageSheetKey above — the
  // modal remounts with fresh internal state each time.
  const [reportModalKey, setReportModalKey] = useState(0);

  useEffect(() => {
    const currentPostId = post?.id;
    if (currentPostId === undefined) return;

    let cancelled = false;

    async function load(id: number) {
      setCommentsLoading(true);
      const result = await getCommentsForPost(id);
      if (!cancelled) {
        setComments(result);
        setCommentsLoading(false);
      }
    }

    load(currentPostId);

    return () => {
      cancelled = true;
    };
  }, [post?.id]);

  // Remembers this exact Post Detail view — post + selected photo, for a
  // multi-photo post — as "the current Home-tab route" (see
  // lib/homeRoute.ts), so BottomNav's Home tab can restore it after a detour
  // to Map or another tab instead of resetting to the Explore feed. Kept
  // live in sync as the user swipes to a different photo (activeMedia
  // changes), not just at mount, so this always matches whichever photo is
  // actually on screen — the same photo "View Map" itself would target.
  // Gated on isHomeOriginated so a post opened from Me, a profile, Map,
  // Search, or a tag can never overwrite Home's saved route — only a Post
  // Detail reached via Home/Explore's own feed tabs is allowed to become
  // Home state (see PostCard.tsx and app/post/[id]/page.tsx).
  useEffect(() => {
    if (!post || !isHomeOriginated) return;
    saveHomeRoute(`/post/${post.id}${activeMedia ? `?mediaId=${activeMedia.id}` : ""}`);
  }, [post, activeMedia, isHomeOriginated]);

  if (loading) {
    return <PostDetailSkeleton />;
  }

  if (!post) {
    return (
      <>
        {/* Rendered here too (identical to the block further down) so
            "Report submitted" is still visible for the instant this post
            transitions into its own "not found" state right after being
            reported — that branch below never mounts once post is gone. */}
        {shareFeedback ? (
          <div className="pointer-events-none fixed inset-x-0 top-16 z-30 flex justify-center">
            <span className="rounded-full bg-stone-900 px-3 py-1.5 text-[11px] font-bold text-white shadow-lg">
              {shareFeedback}
            </span>
          </div>
        ) : null}
        <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center bg-[#fbfaf7] px-8 text-center">
          <h1 className="text-lg font-black">Post not found</h1>
          <p className="mt-2 text-sm text-stone-500">It may have been removed.</p>
          <Link href="/" className="mt-5 inline-flex rounded-full bg-stone-900 px-5 py-2.5 text-sm font-bold text-white">
            Back to Explore
          </Link>
        </main>
      </>
    );
  }

  const isOwner = Boolean(user && post.userId && user.id === post.userId);
  // A post "uses per-photo locations" the moment ANY of its media has its own
  // location — derived from data, no stored flag needed (see
  // lib/map/clustering.ts's buildMapItems for the same rule applied on Map).
  const isPerPhotoPost = post.media.some((media) => media.latitude != null && media.longitude != null);
  const viewOnMapTarget: { href: string; label: string } | null =
    activeMedia && activeMedia.latitude != null && activeMedia.longitude != null
      ? { href: `/map?postId=${post.id}&mediaId=${activeMedia.id}`, label: post.locationName || "View on Map" }
      : !isPerPhotoPost && hasValidMapLocation(post)
        ? { href: `/map?postId=${post.id}`, label: post.locationName || "View on Map" }
        : null;
  const isLiked = likeOverride?.liked ?? post.viewerHasLiked;
  const likeCount = likeOverride?.count ?? post.likeCount;
  const isSaved = saveOverride?.saved ?? post.viewerHasSaved;
  const saveCount = saveOverride?.count ?? post.saveCount;
  const isFollowing = followOverride ?? isFollowingFromQuery;
  // Real count from get_post_engagement until the actual comment list has
  // loaded, then the live list length — never flashes 0, stays exact after
  // adding/deleting.
  const displayedCommentCount = commentsLoading ? post.commentCount : comments.length;

  async function handleToggleLike() {
    if (!user) {
      void signInWithGoogle();
      return;
    }
    if (!post) return;
    const wasLiked = isLiked;
    const previousCount = likeCount;
    setLikeOverride({ liked: !wasLiked, count: previousCount + (wasLiked ? -1 : 1) });
    try {
      if (wasLiked) await unlikePost(post.id, user.id);
      else await likePost(post.id, user.id);
    } catch {
      setLikeOverride({ liked: wasLiked, count: previousCount });
    }
  }

  async function handleToggleSave() {
    if (!user) {
      void signInWithGoogle();
      return;
    }
    if (!post) return;
    const wasSaved = isSaved;
    const previousCount = saveCount;
    setSaveOverride({ saved: !wasSaved, count: previousCount + (wasSaved ? -1 : 1) });
    try {
      if (wasSaved) await unsavePost(post.id, user.id);
      else await savePost(post.id, user.id);
    } catch {
      setSaveOverride({ saved: wasSaved, count: previousCount });
    }
  }

  async function handleToggleFollow() {
    if (!user) {
      void signInWithGoogle();
      return;
    }
    if (!post?.userId) return;
    const wasFollowing = isFollowing;
    setFollowOverride(!wasFollowing);
    try {
      if (wasFollowing) await unfollowUser(user.id, post.userId);
      else await followUser(user.id, post.userId);
    } catch {
      setFollowOverride(wasFollowing);
    }
  }

  function scrollToComments() {
    commentsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    commentInputRef.current?.focus();
  }

  // Deleting a top-level comment cascades to its replies at the database
  // level (parent_comment_id ... on delete cascade — see
  // supabase/comment_replies.sql); this mirrors that same cascade in the
  // locally-held list so replies don't linger as orphaned rows until a
  // refetch. Deleting a reply only ever removes that one row either way —
  // nothing else can have a reply's id as its own parentCommentId.
  async function handleDeleteComment(commentId: number) {
    const previous = comments;
    const target = comments.find((comment) => comment.id === commentId);
    const isTopLevel = target?.parentCommentId === null;
    setDeletingCommentId(commentId);
    setComments((prev) =>
      prev.filter((comment) => comment.id !== commentId && !(isTopLevel && comment.parentCommentId === commentId)),
    );
    try {
      await deleteComment(commentId);
    } catch {
      setComments(previous);
    } finally {
      setDeletingCommentId(null);
    }
  }

  function openReportModal(target: { type: "post" } | { type: "comment"; commentId: number }) {
    if (!user) {
      void signInWithGoogle();
      return;
    }
    setReportTarget(target);
    setReportModalKey((key) => key + 1);
    setReportModalOpen(true);
  }

  // Passed to ReportModal as onSubmit — it awaits this, closes itself on
  // success, and shows its own error state if this throws. The actual
  // "hide it" work happens here: for a post, flip the local flag that makes
  // the existing "Post not found" branch take over; for a comment, filter it
  // out of the already-loaded list exactly like handleDeleteComment does.
  // Neither the post nor the comment is deleted or changed for anyone else —
  // this is purely local state for the current viewer, backed by the real
  // server-side hide that RLS applies on every future read.
  async function handleSubmitReport(reason: string) {
    if (reportTarget.type === "post") {
      if (!post) return;
      await reportPost(post.id, reason);
      setLocallyReportedPostId(post.id);
    } else {
      await reportComment(reportTarget.commentId, reason);
      const reportedCommentId = reportTarget.commentId;
      setComments((prev) => prev.filter((comment) => comment.id !== reportedCommentId));
    }
    setShareFeedback("Report submitted");
    setTimeout(() => setShareFeedback(null), 2000);
  }

  async function handleShare() {
    if (!post) return;
    const shareData = { title: getDisplayTitle(post), text: post.caption, url: window.location.href };

    if (typeof navigator.share === "function") {
      try {
        await navigator.share(shareData);
      } catch {
        // User canceled the native share sheet — nothing to do.
      }
      return;
    }

    if (navigator.clipboard) {
      await navigator.clipboard.writeText(window.location.href);
      setShareFeedback("Link copied");
      setTimeout(() => setShareFeedback(null), 2000);
    }
  }

  return (
    <main className="relative mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-24 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      {/* Top bar always renders in full, before the media, for every post — including the viewer's own. */}
      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-stone-100 bg-[#fbfaf7]/95 px-4 py-3 backdrop-blur">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Go back"
          className="grid size-9 shrink-0 place-items-center rounded-full text-2xl leading-none text-stone-700"
        >
          ‹
        </button>

        <PostAuthorIdentity post={post} />

        {!isOwner ? (
          <button
            type="button"
            onClick={handleToggleFollow}
            aria-pressed={isFollowing}
            aria-label={isFollowing ? "Unfollow" : "Follow"}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${
              isFollowing ? "bg-stone-100 text-stone-500" : "bg-stone-900 text-white"
            }`}
          >
            {isFollowing ? "Following" : "Follow"}
          </button>
        ) : null}

        <button
          type="button"
          onClick={handleShare}
          aria-label="Share"
          className="grid size-9 shrink-0 place-items-center rounded-full text-stone-700"
        >
          <ShareIcon />
        </button>
      </div>

      {shareFeedback ? (
        <div className="pointer-events-none fixed inset-x-0 top-16 z-30 flex justify-center">
          <span className="rounded-full bg-stone-900 px-3 py-1.5 text-[11px] font-bold text-white shadow-lg">
            {shareFeedback}
          </span>
        </div>
      ) : null}

      {post.media.length === 0 && post.textTemplate ? (
        <div className="px-5 pt-5">
          <TextPostVisual template={post.textTemplate} text={getDisplayTitle(post)} size="detail" />
        </div>
      ) : (
        <PostMediaGallery
          // PostMediaGallery's inner gallery deliberately seeds its selected
          // photo from initialMediaId ONCE at mount and never reacts to it
          // changing later (see its own doc comment) — normally correct, so
          // an unrelated re-render never yanks the photo the user is
          // actively looking at out from under them. BottomNav's Home tab
          // relies on exactly the opposite for one specific case: restoring
          // Post Detail from Map via a same-pathname router.replace() that
          // only updates the ?mediaId= query, with no route-level remount of
          // its own. Keying on it here forces a real remount — a fresh
          // "seed once" — precisely when, and only when, mediaId actually
          // changes; every other prop/state on this page is untouched.
          key={`${post.id}-${initialMediaId ?? "default"}`}
          media={post.media}
          title={getDisplayTitle(post)}
          initialMediaId={initialMediaId}
          onActiveMediaChange={setActiveMediaOverride}
          viewOnMapTarget={viewOnMapTarget}
        />
      )}

      <div className="px-5 pt-5">
        {post.media.length === 0 && viewOnMapTarget ? (
          <Link
            href={viewOnMapTarget.href}
            className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.14em] text-kavanaka-aqua"
          >
            📍 {viewOnMapTarget.label}
          </Link>
        ) : null}

        {/* The templated-text cover above already shows the title — repeating
            it here would be a literal duplicate, not a supporting headline. */}
        {!post.textTemplate ? (
          <h1 className="mt-1.5 text-xl font-black leading-tight text-stone-900">{getDisplayTitle(post)}</h1>
        ) : null}

        <p
          className={`whitespace-pre-wrap text-stone-600 ${post.textTemplate ? "mt-4" : "mt-3"} ${post.media.length === 0 ? "text-base leading-8" : "text-sm leading-6"}`}
        >
          <LinkifiedText text={post.caption} />
        </p>

        {post.tags.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {post.tags.map((tag) => (
              <Link
                key={tag}
                href={`/tag/${encodeURIComponent(tag)}`}
                className="rounded-full bg-kavanaka-lime/15 px-2.5 py-1 text-[11px] font-semibold text-kavanaka-green"
              >
                #{tag}
              </Link>
            ))}
          </div>
        ) : null}

        <div ref={commentsSectionRef} className="mt-6 border-t border-stone-200 pt-5">
          <h2 className="text-sm font-black text-stone-900">Comments</h2>

          <CommentThread
            postId={post.id}
            comments={comments}
            commentsLoading={commentsLoading}
            currentUserId={user?.id}
            onRequireSignIn={() => void signInWithGoogle()}
            onCommentAdded={(comment) => setComments((prev) => [...prev, comment])}
            onDeleteComment={handleDeleteComment}
            deletingCommentId={deletingCommentId}
            onReportComment={(commentId) => openReportModal({ type: "comment", commentId })}
            commentInputRef={commentInputRef}
          />
        </div>

      </div>

      {isOwner ? (
        <PostManageSheet
          key={`manage-sheet-${manageSheetKey}`}
          open={manageSheetOpen}
          post={post}
          onClose={() => setManageSheetOpen(false)}
          onDeleted={() => router.replace("/me")}
        />
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto flex w-full max-w-md items-center gap-3 border-t border-stone-200 bg-white/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 backdrop-blur">
        {/* Explicit ~48% width (not flex-1) — the input is deliberately
            shorter than "fill remaining space" so the action-icon group
            always has generous, evenly-distributed room, not just enough to
            avoid overlap. min-w-0 kept defensively on both the wrapper and
            the input itself. Shown to owner and non-owner alike — owners
            previously had no quick way to jump to comments from this bar
            (the Manage-post pill occupied this whole slot); relocating
            Manage into the icon row below frees this up for everyone. */}
        <div className="w-[48%] min-w-0 shrink-0">
          <input
            type="text"
            readOnly
            onClick={(event) => {
              event.currentTarget.blur();
              scrollToComments();
            }}
            placeholder="Say something…"
            aria-label="Add a comment"
            className="w-full min-w-0 cursor-pointer rounded-full border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm text-stone-400 outline-none"
          />
        </div>

        {/* Takes the full remaining ~52% (flex-1) and spreads the 4 compact
            icon+count units across it via justify-between, so the last
            action naturally lands near the bar's right edge instead of
            leaving a dead gap. Every button is now a single-row horizontal
            unit (icon beside its count, not stacked above it), so all 4 are
            naturally the same height and items-center aligns them correctly
            against the input pill without needing any special-case offset. */}
        <div className="flex flex-1 items-center justify-between">
          <button
            type="button"
            onClick={handleToggleLike}
            aria-pressed={isLiked}
            aria-label={isLiked ? "Not helpful" : "Helpful"}
            className="flex items-center gap-1 text-[11px] font-bold text-stone-500"
          >
            <span className={isLiked ? "text-red-500" : "text-stone-500"}>
              <ThumbsUpIcon filled={isLiked} />
            </span>
            {likeCount}
          </button>

          <button
            type="button"
            onClick={handleToggleSave}
            aria-pressed={isSaved}
            aria-label={isSaved ? "Unsave" : "Save"}
            className="flex items-center gap-1 text-[11px] font-bold text-stone-500"
          >
            <span className={isSaved ? "text-kavanaka-green" : "text-stone-500"}>
              <SaveIcon filled={isSaved} />
            </span>
            {saveCount}
          </button>

          <button
            type="button"
            onClick={scrollToComments}
            aria-label="Comments"
            className="flex items-center gap-1 text-[11px] font-bold text-stone-500"
          >
            <CommentIcon />
            {displayedCommentCount}
          </button>

          {isOwner ? (
            <button
              type="button"
              onClick={() => {
                setManageSheetKey((key) => key + 1);
                setManageSheetOpen(true);
              }}
              aria-label="Manage post"
              className="flex items-center text-[11px] font-bold text-stone-500"
            >
              <MoreIcon />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => openReportModal({ type: "post" })}
              aria-label="Report post"
              className="flex items-center text-[11px] font-bold text-stone-500"
            >
              <FlagIcon />
            </button>
          )}
        </div>
      </div>

      <ReportModal
        key={`report-modal-${reportModalKey}`}
        open={reportModalOpen}
        targetLabel={reportTarget.type}
        onClose={() => setReportModalOpen(false)}
        onSubmit={handleSubmitReport}
      />
    </main>
  );
}
