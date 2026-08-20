"use client";

import type { RefObject } from "react";
import { useState } from "react";
import DemoPhoto from "@/components/DemoPhoto";
import { addComment, type Comment } from "@/lib/comments";
import { formatRelativeDate } from "@/lib/postDisplay";
import { FALLBACK_DISPLAY_NAME } from "@/lib/profiles";

type ReplyTarget = {
  commentId: number;
  authorDisplayName: string;
};

type CommentThreadProps = {
  postId: number;
  comments: Comment[];
  commentsLoading: boolean;
  /** Undefined when signed out — every "is this my own comment" / "am I
   *  signed in" check in this component is driven off this one value. */
  currentUserId: string | undefined;
  /** Same trigger every other signed-out action in PostDetail already uses
   *  (Like, Save, Follow, Report) — no new auth flow. */
  onRequireSignIn: () => void;
  /** Appends a newly-created comment/reply to PostDetail's own comments
   *  state — this component never holds the list itself. */
  onCommentAdded: (comment: Comment) => void;
  onDeleteComment: (commentId: number) => void;
  deletingCommentId: number | null;
  onReportComment: (commentId: number) => void;
  commentInputRef: RefObject<HTMLInputElement | null>;
};

/** Outlined trash can — delete a comment/reply. */
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

/** Outlined flag — report a comment/reply. */
function FlagIcon() {
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
      <path d="M5 21V4" />
      <path d="M5 4h13l-3 4.5L18 13H5" />
    </svg>
  );
}

function CommentRow({
  comment,
  isReply,
  currentUserId,
  deletingCommentId,
  onReply,
  onDelete,
  onReportComment,
}: {
  comment: Comment;
  isReply: boolean;
  currentUserId: string | undefined;
  deletingCommentId: number | null;
  onReply: (comment: Comment) => void;
  onDelete: (commentId: number) => void;
  onReportComment: (commentId: number) => void;
}) {
  const isMine = currentUserId != null && comment.userId === currentUserId;

  return (
    <li className={`flex items-start gap-2.5 ${isReply ? "ml-8" : ""}`}>
      {comment.authorAvatarUrl ? (
        <DemoPhoto src={comment.authorAvatarUrl} alt="" className="size-8 shrink-0 rounded-full" />
      ) : (
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-stone-200 text-xs font-black text-stone-600">
          {comment.authorDisplayName.charAt(0).toUpperCase()}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-stone-900">
          {comment.authorDisplayName}
          {/* parentCommentId, not replyToUserId, decides whether this row is
              a reply — see lib/comments.ts. Falls back to
              FALLBACK_DISPLAY_NAME defensively even though
              attachCommentAuthorProfiles/the optimistic-append path already
              guarantee a real string here. */}
          {comment.parentCommentId !== null ? (
            <span className="ml-1 font-normal text-stone-400">→ {comment.replyToDisplayName ?? FALLBACK_DISPLAY_NAME}</span>
          ) : null}
        </p>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-stone-700">{comment.body}</p>
        <div className="mt-1 flex items-center gap-3">
          <span className="text-[11px] text-stone-400">{formatRelativeDate(comment.createdAt)}</span>
          {!isMine ? (
            <button type="button" onClick={() => onReply(comment)} className="text-[11px]! leading-[1.5]! text-stone-500">
              Reply
            </button>
          ) : null}
        </div>
      </div>
      {isMine ? (
        <button
          type="button"
          onClick={() => onDelete(comment.id)}
          disabled={deletingCommentId === comment.id}
          aria-label="Delete comment"
          className="shrink-0 rounded-full p-1.5 text-stone-400 disabled:opacity-50"
        >
          <DeleteIcon />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onReportComment(comment.id)}
          aria-label="Report comment"
          className="shrink-0 rounded-full p-1.5 text-stone-400"
        >
          <FlagIcon />
        </button>
      )}
    </li>
  );
}

/**
 * One-level comment threading for Post Detail: top-level comments oldest to
 * newest, each followed immediately by its own replies (also oldest to
 * newest), indented once. Grouping is done client-side from the single flat,
 * already-sorted list PostDetail already fetches (getCommentsForPost) — no
 * extra query, no N+1: filtering an already-ordered array preserves relative
 * order, so both the top-level list and each parent's reply list come out
 * correctly ordered for free.
 *
 * Replying to a reply is fully supported from the UI's point of view (tap
 * Reply on any row, top-level or reply) — the "one level only" rule is
 * enforced server-side (add_comment flattens to the true root; see
 * supabase/comment_replies.sql), not by anything in this component. This
 * component only ever sends whatever id was tapped.
 */
export default function CommentThread({
  postId,
  comments,
  commentsLoading,
  currentUserId,
  onRequireSignIn,
  onCommentAdded,
  onDeleteComment,
  deletingCommentId,
  onReportComment,
  commentInputRef,
}: CommentThreadProps) {
  const [commentInput, setCommentInput] = useState("");
  const [isPostingComment, setIsPostingComment] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);

  const topLevelComments = comments.filter((comment) => comment.parentCommentId === null);
  const repliesByParentId = new Map<number, Comment[]>();
  comments.forEach((comment) => {
    if (comment.parentCommentId === null) return;
    const existing = repliesByParentId.get(comment.parentCommentId);
    if (existing) existing.push(comment);
    else repliesByParentId.set(comment.parentCommentId, [comment]);
  });

  function handleReplyClick(comment: Comment) {
    if (!currentUserId) {
      onRequireSignIn();
      return;
    }
    setReplyTarget({ commentId: comment.id, authorDisplayName: comment.authorDisplayName });
    commentInputRef.current?.focus();
  }

  function cancelReply() {
    setReplyTarget(null);
  }

  async function handleSubmit() {
    if (!currentUserId) {
      onRequireSignIn();
      return;
    }
    const trimmed = commentInput.trim();
    if (!trimmed || isPostingComment) return;

    setIsPostingComment(true);
    try {
      const created = await addComment(postId, trimmed, replyTarget?.commentId);
      // The RPC's own returned row never carries a resolved reply-target
      // name (see addComment in lib/comments.ts) — this component already
      // knows it synchronously from the "Replying to X" state that drove
      // this exact submission.
      const finalComment = replyTarget ? { ...created, replyToDisplayName: replyTarget.authorDisplayName } : created;
      onCommentAdded(finalComment);
      setCommentInput("");
      setReplyTarget(null);
    } catch {
      // Leave the typed text (and reply target) in place so the user can retry.
    } finally {
      setIsPostingComment(false);
    }
  }

  const placeholder = replyTarget ? `Reply to ${replyTarget.authorDisplayName}…` : currentUserId ? "Add a comment…" : "Sign in to comment";

  return (
    <>
      {commentsLoading ? (
        <p className="mt-4 text-center text-xs text-stone-400">Loading comments…</p>
      ) : comments.length === 0 ? (
        <p className="mt-4 text-center text-xs text-stone-400">Be the first to comment.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {topLevelComments.map((comment) => (
            <li key={comment.id}>
              <ul className="space-y-4">
                <CommentRow
                  comment={comment}
                  isReply={false}
                  currentUserId={currentUserId}
                  deletingCommentId={deletingCommentId}
                  onReply={handleReplyClick}
                  onDelete={onDeleteComment}
                  onReportComment={onReportComment}
                />
                {(repliesByParentId.get(comment.id) ?? []).map((reply) => (
                  <CommentRow
                    key={reply.id}
                    comment={reply}
                    isReply
                    currentUserId={currentUserId}
                    deletingCommentId={deletingCommentId}
                    onReply={handleReplyClick}
                    onDelete={onDeleteComment}
                    onReportComment={onReportComment}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
        className="mt-4"
      >
        {replyTarget ? (
          <div className="mb-2 flex items-center gap-1.5 text-xs text-stone-500">
            <span>
              Replying to <strong className="font-bold text-stone-700">{replyTarget.authorDisplayName}</strong>
            </span>
            <button
              type="button"
              onClick={cancelReply}
              aria-label="Cancel reply"
              className="grid size-4 place-items-center rounded-full text-stone-400"
            >
              ×
            </button>
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <input
            ref={commentInputRef}
            type="text"
            value={commentInput}
            onChange={(event) => setCommentInput(event.target.value)}
            placeholder={placeholder}
            aria-label={replyTarget ? `Reply to ${replyTarget.authorDisplayName}` : "Add a comment"}
            className="min-w-0 flex-1 rounded-full border border-stone-200 bg-stone-50 px-4 py-2.5 text-[16px] text-stone-900 outline-none placeholder:text-stone-400 md:text-sm"
          />
          <button
            type="submit"
            disabled={isPostingComment || (Boolean(currentUserId) && !commentInput.trim())}
            className="shrink-0 rounded-full bg-stone-900 px-4 py-2.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400"
          >
            Send
          </button>
        </div>
      </form>
    </>
  );
}
