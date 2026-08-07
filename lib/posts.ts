"use client";

import { useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";
import type { Post, PostType } from "@/types/post";

/** snake_case shape of a `posts` row, as returned by Supabase/PostgREST. */
type PostRow = {
  id: number;
  created_at: string;
  post_type: PostType;
  image: string | null;
  image_alt: string | null;
  image_aspect: string | null;
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
};

const POST_COLUMNS =
  "id, created_at, post_type, image, image_alt, image_aspect, title, caption, tags, author, rating, rating_count, show_on_map, latitude, longitude, location_name, user_id";

function rowToPost(row: PostRow): Post {
  return {
    id: row.id,
    postType: row.post_type,
    image: row.image,
    imageAlt: row.image_alt,
    imageAspect: row.image_aspect,
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
  };
}

function warnIfNotConfigured() {
  console.warn(
    "Supabase isn't configured — add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local (see .env.example).",
  );
}

/** Every post in the `posts` table, newest first. */
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

  return (data ?? []).map(rowToPost);
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

  return data ? rowToPost(data) : undefined;
}

export async function addPost(input: Omit<Post, "id">): Promise<Post> {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase isn't configured — add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local.",
    );
  }

  const { data, error } = await supabase
    .from("posts")
    .insert({
      post_type: input.postType,
      image: input.image,
      image_alt: input.imageAlt,
      image_aspect: input.imageAspect,
      title: input.title,
      caption: input.caption,
      tags: input.tags,
      author: input.author,
      rating: input.rating,
      rating_count: input.ratingCount,
      show_on_map: input.showOnMap,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      location_name: input.locationName ?? null,
      user_id: input.userId ?? null,
    })
    .select(POST_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create post.");
  }

  return rowToPost(data);
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
