"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import PostMediaGallery from "@/components/PostMediaGallery";
import PostManageSheet from "@/components/post/PostManageSheet";
import { useAuth } from "@/lib/auth/AuthProvider";
import { addComment, deleteComment, getCommentsForPost, type Comment } from "@/lib/comments";
import { followUser, likePost, savePost, unfollowUser, unlikePost, unsavePost, useIsFollowing } from "@/lib/interactions";
import { hasValidMapLocation } from "@/lib/map/viewport";
import { getDisplayTitle } from "@/lib/postDisplay";
import { useAllPostsState } from "@/lib/posts";
import type { Post } from "@/types/post";

type PostDetailProps = {
  postId: number;
};

function formatRelativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return "Just now";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(then);
}

/** Avatar + name, linking to the author's public profile — real userId only,
 *  never derived from the display-only author string. Degrades to plain,
 *  unlinked text for posts with no owner (e.g. authored before auth existed). */
function PostAuthorIdentity({ post }: { post: Post }) {
  const content = (
    <>
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-stone-200 text-sm font-black text-stone-600">
        {post.author.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-stone-900">{post.author}</p>
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

/** Outlined circle with three dots — Comment. */
function CommentIcon() {
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
      <circle cx="12" cy="12" r="9" />
      <circle cx="8.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Outlined heart — Like. `filled` swaps to a solid fill for the liked state. */
function LikeIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path d="M12 21s-6.5-4.35-9.5-8.3C.5 9.5 1.8 5.5 5.5 5c2-.27 3.5.9 4.5 2.3C11 5.9 12.5 4.73 14.5 5c3.7.5 5 4.5 3 7.7C18.5 16.65 12 21 12 21Z" />
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
      className="size-5"
    >
      <path d="M12 2.5l2.9 6.26 6.9.74-5.2 4.53 1.5 6.97L12 17.27l-6.1 3.73 1.5-6.97-5.2-4.53 6.9-.74L12 2.5Z" />
    </svg>
  );
}

/** Outlined trash can — delete a comment. */
function DeleteIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      <path d="M4 7h16" />
      <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
      <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
      <circle cx="5" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="19" cy="12" r="1.75" />
    </svg>
  );
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

export default function PostDetail({ postId }: PostDetailProps) {
  const router = useRouter();
  const { user, signInWithGoogle } = useAuth();
  const { posts, loading } = useAllPostsState();
  const post = posts.find((candidate) => candidate.id === postId);
  const { isFollowing: isFollowingFromQuery } = useIsFollowing(post?.userId);
  const commentsSectionRef = useRef<HTMLDivElement>(null);
  const commentInputRef = useRef<HTMLInputElement>(null);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
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
  const [commentInput, setCommentInput] = useState("");
  const [isPostingComment, setIsPostingComment] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<number | null>(null);

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

  if (loading) {
    return <PostDetailSkeleton />;
  }

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

  const isOwner = Boolean(user && post.userId && user.id === post.userId);
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

  async function handleSubmitComment() {
    if (!user) {
      void signInWithGoogle();
      return;
    }
    if (!post) return;
    const trimmed = commentInput.trim();
    if (!trimmed || isPostingComment) return;

    const authorName = (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "Anonymous";

    setIsPostingComment(true);
    try {
      const newComment = await addComment(post.id, user.id, authorName, trimmed);
      setComments((prev) => [...prev, newComment]);
      setCommentInput("");
    } catch {
      // Leave the typed text in place so the user can retry.
    } finally {
      setIsPostingComment(false);
    }
  }

  async function handleDeleteComment(commentId: number) {
    const previous = comments;
    setDeletingCommentId(commentId);
    setComments((prev) => prev.filter((comment) => comment.id !== commentId));
    try {
      await deleteComment(commentId);
    } catch {
      setComments(previous);
    } finally {
      setDeletingCommentId(null);
    }
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

      <PostMediaGallery media={post.media} title={getDisplayTitle(post)} />

      <div className="px-5 pt-5">
        {hasValidMapLocation(post) ? (
          <Link
            href={`/map?postId=${post.id}`}
            className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.14em] text-orange-600"
          >
            📍 {post.locationName || "View on Map"}
          </Link>
        ) : null}

        <h1 className="mt-1.5 text-xl font-black leading-tight text-stone-900">{getDisplayTitle(post)}</h1>

        <p
          className={`mt-3 text-stone-600 ${post.media.length === 0 ? "text-base leading-8" : "text-sm leading-6"}`}
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

        <div ref={commentsSectionRef} className="mt-6 border-t border-stone-200 pt-5">
          <h2 className="text-sm font-black text-stone-900">Comments</h2>

          {commentsLoading ? (
            <p className="mt-4 text-center text-xs text-stone-400">Loading comments…</p>
          ) : comments.length === 0 ? (
            <p className="mt-4 text-center text-xs text-stone-400">Be the first to comment.</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {comments.map((comment) => (
                <li key={comment.id} className="flex items-start gap-2.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-stone-200 text-xs font-black text-stone-600">
                    {comment.author.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-stone-900">{comment.author}</p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-stone-700">{comment.body}</p>
                    <p className="mt-1 text-[11px] text-stone-400">{formatRelativeDate(comment.createdAt)}</p>
                  </div>
                  {user && user.id === comment.userId ? (
                    <button
                      type="button"
                      onClick={() => handleDeleteComment(comment.id)}
                      disabled={deletingCommentId === comment.id}
                      aria-label="Delete comment"
                      className="shrink-0 rounded-full p-1.5 text-stone-400 disabled:opacity-50"
                    >
                      <DeleteIcon />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmitComment();
            }}
            className="mt-4 flex items-center gap-2"
          >
            <input
              ref={commentInputRef}
              type="text"
              value={commentInput}
              onChange={(event) => setCommentInput(event.target.value)}
              placeholder={user ? "Add a comment…" : "Sign in to comment"}
              aria-label="Add a comment"
              className="flex-1 rounded-full border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm text-stone-900 outline-none placeholder:text-stone-400"
            />
            <button
              type="submit"
              disabled={isPostingComment || (Boolean(user) && !commentInput.trim())}
              className="shrink-0 rounded-full bg-stone-900 px-4 py-2.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400"
            >
              Send
            </button>
          </form>
        </div>

      </div>

      {isOwner ? (
        <PostManageSheet
          key={manageSheetKey}
          open={manageSheetOpen}
          post={post}
          onClose={() => setManageSheetOpen(false)}
          onDeleted={() => router.replace("/me")}
        />
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto flex w-full max-w-md items-center gap-2 border-t border-stone-200 bg-white/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 backdrop-blur">
        {isOwner ? (
          <button
            type="button"
            onClick={() => {
              setManageSheetKey((key) => key + 1);
              setManageSheetOpen(true);
            }}
            aria-label="Manage post"
            className="flex flex-1 items-center gap-1.5 rounded-full bg-stone-100 px-4 py-2.5 text-sm font-bold text-stone-600"
          >
            <MoreIcon />
            Manage post
          </button>
        ) : (
          <input
            type="text"
            readOnly
            onClick={(event) => {
              event.currentTarget.blur();
              scrollToComments();
            }}
            placeholder="Say something…"
            aria-label="Add a comment"
            className="flex-1 cursor-pointer rounded-full border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm text-stone-400 outline-none"
          />
        )}

        <button
          type="button"
          onClick={handleToggleLike}
          aria-pressed={isLiked}
          aria-label={isLiked ? "Unlike" : "Like"}
          className="flex shrink-0 flex-col items-center gap-0.5 py-1 text-[11px] font-bold text-stone-500"
        >
          <span className={isLiked ? "text-red-500" : "text-stone-500"}>
            <LikeIcon filled={isLiked} />
          </span>
          {likeCount}
        </button>

        <button
          type="button"
          onClick={handleToggleSave}
          aria-pressed={isSaved}
          aria-label={isSaved ? "Unsave" : "Save"}
          className="flex shrink-0 flex-col items-center gap-0.5 py-1 text-[11px] font-bold text-stone-500"
        >
          <span className={isSaved ? "text-orange-500" : "text-stone-500"}>
            <SaveIcon filled={isSaved} />
          </span>
          {saveCount}
        </button>

        <button
          type="button"
          onClick={scrollToComments}
          aria-label="Comments"
          className="flex shrink-0 flex-col items-center gap-0.5 py-1 text-[11px] font-bold text-stone-500"
        >
          <CommentIcon />
          {displayedCommentCount}
        </button>
      </div>
    </main>
  );
}
