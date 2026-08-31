import Link from "next/link";
import DemoPhoto from "@/components/DemoPhoto";
import PostVideoTile from "@/components/PostVideoTile";
import { formatRelativeDate, getDisplayTitle } from "@/lib/postDisplay";
import type { Post, PostMedia } from "@/types/post";

type SelectedPostPreviewProps = {
  post: Post;
  /** Same cover-resolution the marker itself used (post-level cover, or a
   *  specific per-photo-located image) — kept in sync by the caller. */
  cover: PostMedia | undefined;
};

function LocationPinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-3 shrink-0">
      <path d="M12 22s7-7.58 7-12.5A7 7 0 0 0 5 9.5C5 14.42 12 22 12 22Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}

function ThumbsUpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-3 shrink-0">
      <path d="M7 22V10M2 13v7a2 2 0 0 0 2 2h12.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14V5a3 3 0 0 0-3-3l-4 9v2" />
    </svg>
  );
}

/**
 * Bottom-of-map preview for the currently selected marker (see
 * PostMapMarker's own doc comment) — replaces permanently attaching a title
 * label to the pin itself. The whole card is one Link straight into the
 * existing Post Detail page; nothing here duplicates PostDetail's own logic,
 * this is read-only summary info sourced entirely from the already-fetched
 * Post object.
 */
export default function SelectedPostPreview({ post, cover }: SelectedPostPreviewProps) {
  const relativeTime = post.createdAt ? formatRelativeDate(post.createdAt) : undefined;

  return (
    <Link
      href={`/post/${post.id}`}
      className="pointer-events-auto absolute inset-x-3 bottom-24 z-[1000] flex items-center gap-3 rounded-2xl bg-white/95 p-2.5 shadow-[0_4px_20px_rgba(50,40,30,0.25)] backdrop-blur"
    >
      <div className="size-14 shrink-0 overflow-hidden rounded-xl bg-stone-100">
        {cover?.type === "image" ? (
          <DemoPhoto src={cover.url} alt="" className="size-full object-cover" />
        ) : cover?.type === "video" ? (
          <PostVideoTile src={cover.url} className="size-full" />
        ) : (
          <div className="grid size-full place-items-center bg-kavanaka-aqua/15 text-lg text-kavanaka-aqua">✎</div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <h3 className="line-clamp-2 text-[13px] font-bold leading-snug text-stone-900">{getDisplayTitle(post)}</h3>
        {post.locationName || relativeTime ? (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-stone-500">
            {post.locationName ? (
              <span className="flex min-w-0 items-center gap-0.5 truncate">
                <LocationPinIcon />
                <span className="truncate">{post.locationName}</span>
              </span>
            ) : null}
            {post.locationName && relativeTime ? <span className="shrink-0">·</span> : null}
            {relativeTime ? <span className="shrink-0">{relativeTime}</span> : null}
          </div>
        ) : null}
      </div>

      <span className="flex shrink-0 items-center gap-0.5 self-start pt-0.5 text-[12px] font-semibold text-stone-500">
        <ThumbsUpIcon />
        {post.likeCount}
      </span>
    </Link>
  );
}
