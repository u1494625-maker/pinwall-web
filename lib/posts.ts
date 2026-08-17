"use client";

import { useEffect, useState } from "react";
import { FALLBACK_DISPLAY_NAME, getProfilesByUserIds } from "@/lib/profiles";
import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";
import type { MediaType, Post, PostMedia } from "@/types/post";

/** snake_case shape of a `post_media` row, as returned by Supabase/PostgREST. */
type PostMediaRow = {
  id: number;
  media_type: MediaType;
  url: string;
  storage_path: string;
  aspect_ratio: string | null;
  position: number;
  thumbnail_url: string | null;
  latitude: number | null;
  longitude: number | null;
  location_name: string | null;
};

/** snake_case shape of a `posts` row (with nested media), as returned by Supabase/PostgREST. */
type PostRow = {
  id: number;
  created_at: string;
  title: string | null;
  caption: string;
  tags: string[] | null;
  rating: number;
  rating_count: string;
  show_on_map: boolean;
  latitude: number | null;
  longitude: number | null;
  location_name: string | null;
  user_id: string | null;
  post_media: PostMediaRow[] | null;
};

const POST_COLUMNS =
  "id, created_at, title, caption, tags, rating, rating_count, show_on_map, latitude, longitude, location_name, user_id, post_media(*)";

function rowToPostMedia(row: PostMediaRow): PostMedia {
  return {
    id: row.id,
    type: row.media_type,
    url: row.url,
    storagePath: row.storage_path,
    aspectRatio: row.aspect_ratio,
    position: row.position,
    thumbnailUrl: row.thumbnail_url ?? undefined,
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    locationName: row.location_name ?? undefined,
  };
}

function rowToPost(row: PostRow): Post {
  // Sorted client-side rather than relying on a query-level order modifier for
  // the embedded resource — just as correct, and doesn't depend on getting an
  // exact PostgREST/supabase-js embedded-order syntax right for this version.
  const media = (row.post_media ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(rowToPostMedia);

  return {
    id: row.id,
    title: row.title,
    caption: row.caption,
    tags: row.tags ?? [],
    rating: row.rating,
    ratingCount: row.rating_count,
    showOnMap: row.show_on_map,
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    locationName: row.location_name ?? undefined,
    userId: row.user_id ?? undefined,
    createdAt: row.created_at,
    media,
    // Overwritten by attachAuthorProfiles() right after fetch — this default
    // only matters if that call fails or the post has no owner, in which
    // case a neutral fallback (never a guessed or stale name) is correct.
    authorDisplayName: FALLBACK_DISPLAY_NAME,
    authorAvatarUrl: undefined,
    // Overwritten by attachEngagement() right after fetch — these defaults
    // only matter if that call fails, in which case zero/false is the
    // correct, honest fallback (never a guessed or fake number).
    likeCount: 0,
    saveCount: 0,
    commentCount: 0,
    viewerHasLiked: false,
    viewerHasSaved: false,
  };
}

function warnIfNotConfigured() {
  console.warn(
    "Supabase isn't configured — add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local (see .env.example).",
  );
}

/** snake_case shape of a get_post_engagement row. */
type PostEngagementRow = {
  post_id: number;
  like_count: number;
  save_count: number;
  comment_count: number;
  viewer_has_liked: boolean;
  viewer_has_saved: boolean;
};

/**
 * Attaches real likeCount/saveCount/commentCount/viewerHasLiked/
 * viewerHasSaved to an already-fetched batch of posts via ONE additional RPC
 * call keyed on their ids — never one call per post (no N+1), and never a
 * raw liker/saver ID list shipped to the client (see
 * supabase/interactions.sql and supabase/comments.sql's get_post_engagement
 * for why this is a separate RPC rather than embedded directly in the posts
 * query).
 */
async function attachEngagement(posts: Post[]): Promise<Post[]> {
  if (posts.length === 0) return posts;

  const { data, error } = await supabase.rpc("get_post_engagement", {
    post_ids: posts.map((post) => post.id),
  });

  if (error || !data) {
    console.error("Failed to load post engagement from Supabase:", error?.message);
    return posts;
  }

  const engagementByPostId = new Map<number, PostEngagementRow>(
    (data as PostEngagementRow[]).map((row) => [row.post_id, row]),
  );

  return posts.map((post) => {
    const engagement = engagementByPostId.get(post.id);
    if (!engagement) return post;
    return {
      ...post,
      likeCount: engagement.like_count,
      saveCount: engagement.save_count,
      commentCount: engagement.comment_count,
      viewerHasLiked: engagement.viewer_has_liked,
      viewerHasSaved: engagement.viewer_has_saved,
    };
  });
}

/**
 * Attaches current authorDisplayName/authorAvatarUrl to an already-fetched
 * batch of posts, resolved via userId -> profiles — never the old
 * posts.author snapshot (removed entirely; see
 * supabase/profile_identity_unification.sql). One batched query keyed on the
 * post authors' unique user ids, regardless of how many posts are in the
 * batch — never one request per post (no N+1). Posts with no owner (e.g. a
 * pre-auth post) or whose owner has no profile row simply keep the
 * FALLBACK_DISPLAY_NAME default already set in rowToPost.
 */
async function attachAuthorProfiles(posts: Post[]): Promise<Post[]> {
  const userIds = posts.map((post) => post.userId).filter((id): id is string => Boolean(id));
  if (userIds.length === 0) return posts;

  const profilesByUserId = await getProfilesByUserIds(userIds);

  return posts.map((post) => {
    const profile = post.userId ? profilesByUserId.get(post.userId) : undefined;
    if (!profile) return post;
    return {
      ...post,
      authorDisplayName: profile.displayName ?? FALLBACK_DISPLAY_NAME,
      authorAvatarUrl: profile.avatarUrl ?? undefined,
    };
  });
}

/** Every post in the `posts` table, newest first, with ordered media, real
 *  engagement, and current author identity attached. */
export async function getAllPosts(): Promise<Post[]> {
  if (!isSupabaseConfigured) {
    warnIfNotConfigured();
    return [];
  }

  const { data, error } = await supabase
    .from("posts")
    .select(POST_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to load posts from Supabase:", error.message);
    return [];
  }

  return attachAuthorProfiles(await attachEngagement((data ?? []).map(rowToPost)));
}

/**
 * Posts authored by any of the given user IDs, newest first — used by the
 * Home "Following" feed. Returns [] immediately, with no query at all, when
 * `userIds` is empty (following nobody) rather than relying on how `.in()`
 * with an empty array behaves across client versions.
 */
export async function getPostsByUserIds(userIds: string[]): Promise<Post[]> {
  if (userIds.length === 0) return [];

  if (!isSupabaseConfigured) {
    warnIfNotConfigured();
    return [];
  }

  const { data, error } = await supabase
    .from("posts")
    .select(POST_COLUMNS)
    .in("user_id", userIds)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to load posts from Supabase:", error.message);
    return [];
  }

  return attachAuthorProfiles(await attachEngagement((data ?? []).map(rowToPost)));
}

/** Posts matching any of the given ids, in no particular order — used to
 *  batch-load post previews for a list of items that each reference one post
 *  (e.g. notification rows), never one query per item. Returns [] immediately,
 *  with no query at all, for an empty input. */
export async function getPostsByIds(postIds: number[]): Promise<Post[]> {
  if (postIds.length === 0) return [];

  if (!isSupabaseConfigured) {
    warnIfNotConfigured();
    return [];
  }

  const { data, error } = await supabase.from("posts").select(POST_COLUMNS).in("id", postIds);

  if (error) {
    console.error("Failed to batch-load posts from Supabase:", error.message);
    return [];
  }

  return attachAuthorProfiles(await attachEngagement((data ?? []).map(rowToPost)));
}

export async function getPostById(id: number): Promise<Post | undefined> {
  if (!isSupabaseConfigured) {
    warnIfNotConfigured();
    return undefined;
  }

  const { data, error } = await supabase
    .from("posts")
    .select(POST_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("Failed to load post from Supabase:", error.message);
    return undefined;
  }

  if (!data) return undefined;

  const [post] = await attachAuthorProfiles(await attachEngagement([rowToPost(data)]));
  return post;
}

const POST_MEDIA_COLUMNS =
  "id, media_type, url, storage_path, aspect_ratio, position, thumbnail_url, latitude, longitude, location_name";

/**
 * Admin-only, explicitly moderation-triggered fetch of one post regardless
 * of moderation_status — see get_post_for_moderation in
 * supabase/moderation_history.sql. The RPC itself re-checks
 * is_current_user_admin() on every call, unconditionally; that is the real
 * security boundary, not anything the caller does. getPostById has no
 * awareness of this at all and stays exactly as it was — this exists solely
 * for PostDetail's own explicit ?moderate=1 fallback (see PostDetail.tsx),
 * not for EditPostForm or any other ordinary consumer.
 *
 * The RPC returns the bare `public.posts` row (not `setof`, so PostgREST
 * responds with a single object, not an array — same reasoning as
 * add_comment in lib/comments.ts, so no `.single()` here) — unlike every
 * other fetch in this file, it has no nested post_media(*) embed, since
 * that's a PostgREST REST-query feature a plain RPC composite return can't
 * include. post_media's own RLS ("Public can read post media", using (true))
 * is already unconditional regardless of the parent post's moderation_status
 * — ordinary reads never notice this because the parent post being filtered
 * out already prevents the embedded query from running at all; fetching it
 * here as a separate, always-permitted query is exactly as safe as that
 * embed already is for any visible post. Reuses the exact same
 * rowToPost/rowToPostMedia/attachEngagement/attachAuthorProfiles pipeline as
 * every other fetch — no separate Post-shape conversion.
 */
export async function getPostForModeration(id: number): Promise<Post | undefined> {
  if (!isSupabaseConfigured) {
    warnIfNotConfigured();
    return undefined;
  }

  const { data, error } = await supabase.rpc("get_post_for_moderation", { p_post_id: id });

  if (error || !data) {
    console.error("Failed to load post for moderation from Supabase:", error?.message);
    return undefined;
  }

  const { data: mediaRows, error: mediaError } = await supabase
    .from("post_media")
    .select(POST_MEDIA_COLUMNS)
    .eq("post_id", id)
    .order("position", { ascending: true });

  if (mediaError) {
    console.error("Failed to load post media for moderation from Supabase:", mediaError.message);
  }

  const row: PostRow = { ...(data as PostRow), post_media: (mediaRows as PostMediaRow[] | null) ?? [] };
  const [post] = await attachAuthorProfiles(await attachEngagement([rowToPost(row)]));
  return post;
}

export type NewPostMediaInput = {
  type: MediaType;
  url: string;
  storagePath: string;
  aspectRatio: string | null;
  position: number;
  /** Cover-frame thumbnail for a video item — omitted for images and for a
   *  video whose thumbnail generation failed (see MediaPostEditor). */
  thumbnailUrl?: string;
  /** Optional per-photo location — image items only, see PostMedia. */
  latitude?: number;
  longitude?: number;
  locationName?: string;
};

export type NewPostInput = {
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
  /** Empty for text posts. media[0] (position 0) is the cover. */
  media: NewPostMediaInput[];
};

/**
 * Creates a post and its media rows in one atomic step via the
 * create_post_with_media RPC (supabase/post_media.sql) — a plain client-side
 * insert-into-posts-then-insert-into-post_media would leave a window where a
 * public, publicly-readable post exists with zero or partial media rows.
 * Returns the new post's id.
 */
export async function addPost(input: NewPostInput): Promise<number> {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase isn't configured — add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local.",
    );
  }

  const { data, error } = await supabase.rpc("create_post_with_media", {
    post_input: {
      title: input.title,
      caption: input.caption,
      tags: input.tags,
      rating: input.rating,
      ratingCount: input.ratingCount,
      showOnMap: input.showOnMap,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      locationName: input.locationName ?? null,
      userId: input.userId ?? null,
    },
    media_input: input.media.map((item) => ({
      type: item.type,
      url: item.url,
      storagePath: item.storagePath,
      aspectRatio: item.aspectRatio,
      position: item.position,
      thumbnailUrl: item.thumbnailUrl ?? null,
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null,
      locationName: item.locationName ?? null,
    })),
  });

  if (error || data == null) {
    throw new Error(error?.message ?? "Failed to create post.");
  }

  return data as number;
}

/** Deletes a post row only — callers are responsible for any Storage cleanup.
 *  post_media rows are removed automatically via `on delete cascade`. */
export async function deletePost(id: number): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase isn't configured — add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local.",
    );
  }

  const { data, error } = await supabase.from("posts").delete().eq("id", id).select("id");

  if (error) {
    throw new Error(error.message);
  }

  if (!data || data.length === 0) {
    throw new Error("Post could not be deleted — it may not exist, or you may not own it.");
  }
}

/** The subset of a post's fields Phase 1 of Edit is allowed to change. */
export type PostEditableFields = {
  title: string | null;
  caption: string;
  tags: string[];
  showOnMap: boolean;
  latitude: number | null;
  longitude: number | null;
};

/** Updates only the approved editable fields on a post row — never media/user_id/etc. */
export async function updatePost(id: number, fields: PostEditableFields): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase isn't configured — add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local.",
    );
  }

  const { data, error } = await supabase
    .from("posts")
    .update({
      title: fields.title,
      caption: fields.caption,
      tags: fields.tags,
      show_on_map: fields.showOnMap,
      latitude: fields.latitude,
      longitude: fields.longitude,
    })
    .eq("id", id)
    .select("id");

  if (error) {
    throw new Error(error.message);
  }

  if (!data || data.length === 0) {
    throw new Error("Post could not be updated — it may not exist, or you may not own it.");
  }
}

/**
 * Last successful getAllPosts() result, kept in module scope (not React
 * state) so it survives every consumer unmounting — e.g. navigating
 * Home -> Post Detail -> Map and back, which are separate routes and fully
 * remount PinWallHome. useAllPostsState hydrates from this synchronously on
 * mount (no loading-skeleton flash on a repeat visit within the same
 * session) while still kicking off a fresh fetch every mount, exactly as
 * before, to stay eventually consistent — this only changes what's shown
 * while that fetch is in flight, never the end result.
 */
let cachedAllPosts: Post[] | null = null;

// A cold first request can occasionally hang indefinitely (network-level
// stall, not something getAllPosts()'s own {error} handling ever sees) and
// never settle at all — a plain .catch() does nothing for a promise that
// never rejects. Racing it against this timeout guarantees the hook always
// moves on. The retry gives a stuck/failed first attempt exactly one more
// chance (matching what already happens by accident whenever some other
// page's own successful fetch has warmed cachedAllPosts first) — never more.
const POSTS_FETCH_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out loading posts")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Fetches every post on mount, exposing loading state alongside the data so
 * callers can distinguish "still loading" from "genuinely empty" — `posts`
 * alone is `[]` in both cases until this resolves.
 */
export function useAllPostsState(): { posts: Post[]; loading: boolean } {
  const [posts, setPosts] = useState<Post[]>(() => cachedAllPosts ?? []);
  const [loading, setLoading] = useState(() => cachedAllPosts === null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let result: Post[];
      try {
        result = await withTimeout(getAllPosts(), POSTS_FETCH_TIMEOUT_MS);
      } catch {
        // First attempt timed out or rejected — one immediate retry, no more.
        // Skipped entirely once this effect has already been cleaned up
        // (e.g. React StrictMode's dev-only double-invoke), so a torn-down
        // instance never fires a second request nobody will use.
        if (cancelled) return;
        try {
          result = await withTimeout(getAllPosts(), POSTS_FETCH_TIMEOUT_MS);
        } catch {
          // Both attempts failed — stop loading and keep whatever was
          // already showing (cached posts if any, otherwise the initial []).
          if (!cancelled) setLoading(false);
          return;
        }
      }

      if (cancelled) return;
      cachedAllPosts = result;
      setPosts(result);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { posts, loading };
}

/** Fetches every post on mount. Returns [] until the request resolves. */
export function useAllPosts(): Post[] {
  return useAllPostsState().posts;
}
