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
};

export type Post = {
  id: number;
  /** Optional — text posts, and photo/video posts without one, may omit it. */
  title: string | null;
  caption: string;
  tags: string[];
  author: string;
  rating: number;
  ratingCount: string;
  showOnMap: boolean;
  latitude?: number;
  longitude?: number;
  locationName?: string;
  userId?: string;
  createdAt?: string;
  /** Ordered by position; media[0] is always the cover. Empty for text posts. */
  media: PostMedia[];
  /** Real aggregates from post_likes/post_saves, fetched via the
   *  get_post_engagement RPC — never a raw liker/saver ID list. */
  likeCount: number;
  saveCount: number;
  /** Whether the currently signed-in viewer has liked/saved this post.
   *  Always false for a signed-out viewer. */
  viewerHasLiked: boolean;
  viewerHasSaved: boolean;
};
