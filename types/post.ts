import type { TextTemplateId } from "@/lib/textTemplates";

export type MediaType = "image" | "video";

export type PostMedia = {
  id: number;
  type: MediaType;
  url: string;
  /** Storage object path — kept alongside the public URL so deletion never has
   *  to re-derive it, and so the code has no dependency on Supabase's public
   *  URL format staying stable. */
  storagePath: string;
  aspectRatio: string | null;
  position: number;
  /** User-selected cover image for a video item — required for every video
   *  published under the current model, used for static previews (e.g. the
   *  Map marker). Undefined for images. Never used for playback. */
  thumbnailUrl?: string;
  /** Storage object path for thumbnailUrl (post-image bucket) — kept
   *  alongside the URL so a video's cover can be reliably deleted/replaced,
   *  same reasoning as storagePath above. Undefined for images and for a
   *  video row published before this column existed. */
  thumbnailStoragePath?: string;
  /** Optional per-photo map location, independent of the post's own
   *  showOnMap/latitude/longitude — see lib/map/clustering.ts's
   *  buildMapItems for the precedence rule between the two. Image items
   *  only; never set on video. */
  latitude?: number;
  longitude?: number;
  locationName?: string;
};

export type Post = {
  id: number;
  /** Optional — text posts, and photo/video posts without one, may omit it. */
  title: string | null;
  caption: string;
  tags: string[];
  rating: number;
  ratingCount: string;
  showOnMap: boolean;
  latitude?: number;
  longitude?: number;
  locationName?: string;
  userId?: string;
  createdAt?: string;
  /** Current profile identity for this post's owner, resolved via userId ->
   *  profiles (never a stored snapshot) — see lib/posts.ts's
   *  attachAuthorProfiles. authorDisplayName is always a renderable string
   *  (falls back to FALLBACK_DISPLAY_NAME when there's no owner/profile);
   *  authorAvatarUrl is undefined whenever there's no avatar to show, in
   *  which case UI falls back to an initial-letter circle. */
  authorDisplayName: string;
  authorAvatarUrl?: string;
  /** Ordered by position; media[0] is always the cover. Empty for text posts. */
  media: PostMedia[];
  /** Set only on a templated text post (media is empty); undefined for a
   *  media post and for a text post published before Phase 6A. Chosen once
   *  at publish time — the same template applies to every visual page a
   *  long caption paginates into (see lib/textPagination.ts). */
  textTemplate?: TextTemplateId;
  /** Real aggregates from post_likes/post_saves/comments, fetched via the
   *  get_post_engagement RPC — never a raw liker/saver ID list. */
  likeCount: number;
  saveCount: number;
  commentCount: number;
  /** Whether the currently signed-in viewer has liked/saved this post.
   *  Always false for a signed-out viewer. */
  viewerHasLiked: boolean;
  viewerHasSaved: boolean;
};
