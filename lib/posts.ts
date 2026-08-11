"use client";

import { useEffect, useState } from "react";
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
};

/** snake_case shape of a `posts` row (with nested media), as returned by Supabase/PostgREST. */
type PostRow = {
  id: number;
  created_at: string;
  title: string | null;
  caption: string;
  tags: string[] | null;
  author: string;
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
  "id, created_at, title, caption, tags, author, rating, rating_count, show_on_map, latitude, longitude, location_name, user_id, post_media(*)";

function rowToPostMedia(row: PostMediaRow): PostMedia {
  return {
    id: row.id,
    type: row.media_type,
    url: row.url,
    storagePath: row.storage_path,
    aspectRatio: row.aspect_ratio,
    position: row.position,
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
    author: row.author,
    rating: row.rating,
    ratingCount: row.rating_count,
    showOnMap: row.show_on_map,
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    locationName: row.location_name ?? undefined,
    userId: row.user_id ?? undefined,
    createdAt: row.created_at,
    media,
    // Overwritten by attachEngagement() right after fetch — these defaults
    // only matter if that call fails, in which case zero/false is the
    // correct, honest fallback (never a guessed or fake number).
    likeCount: 0,
    saveCount: 0,
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
  viewer_has_liked: boolean;
  viewer_has_saved: boolean;
};

/**
 * Attaches real likeCount/saveCount/viewerHasLiked/viewerHasSaved to an
 * already-fetched batch of posts via ONE additional RPC call keyed on their
 * ids — never one call per post (no N+1), and never a raw liker/saver ID
 * list shipped to the client (see supabase/interactions.sql's
 * get_post_engagement for why this is a separate RPC rather than embedded
 * directly in the posts query).
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
      viewerHasLiked: engagement.viewer_has_liked,
      viewerHasSaved: engagement.viewer_has_saved,
    };
  });
}

/** Every post in the `posts` table, newest first, with ordered media and real engagement attached. */
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

  return attachEngagement((data ?? []).map(rowToPost));
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

  return attachEngagement((data ?? []).map(rowToPost));
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

  const [post] = await attachEngagement([rowToPost(data)]);
  return post;
}

export type NewPostMediaInput = {
  type: MediaType;
  url: string;
  storagePath: string;
  aspectRatio: string | null;
  position: number;
};

export type NewPostInput = {
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
      author: input.author,
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
 * Fetches every post on mount, exposing loading state alongside the data so
 * callers can distinguish "still loading" from "genuinely empty" — `posts`
 * alone is `[]` in both cases until this resolves.
 */
export function useAllPostsState(): { posts: Post[]; loading: boolean } {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    getAllPosts().then((result) => {
      if (!cancelled) {
        setPosts(result);
        setLoading(false);
      }
    });

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
