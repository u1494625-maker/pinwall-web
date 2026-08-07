import { useMemo, useSyncExternalStore } from "react";
import type { Post } from "@/types/post";
import type { MapBounds, MapViewport } from "./types";

const VIEWPORT_KEY = "pinwall_map_viewport";

export function saveMapViewport(viewport: MapViewport) {
  try {
    window.sessionStorage.setItem(VIEWPORT_KEY, JSON.stringify(viewport));
  } catch {
    // Ignore storage failures (e.g. private browsing quota).
  }
}

function isValidBounds(value: unknown): value is MapBounds {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as MapBounds).west === "number" &&
    typeof (value as MapBounds).south === "number" &&
    typeof (value as MapBounds).east === "number" &&
    typeof (value as MapBounds).north === "number"
  );
}

function parseMapViewport(raw: string | null): MapViewport | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.lat === "number" &&
      typeof parsed?.lng === "number" &&
      typeof parsed?.zoom === "number" &&
      (parsed?.bounds === undefined || isValidBounds(parsed?.bounds))
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function readMapViewport(): MapViewport | null {
  try {
    return parseMapViewport(window.sessionStorage.getItem(VIEWPORT_KEY));
  } catch {
    return null;
  }
}

function getMapViewportSnapshot(): string {
  try {
    return window.sessionStorage.getItem(VIEWPORT_KEY) ?? "";
  } catch {
    return "";
  }
}

function getServerMapViewportSnapshot(): string {
  return "";
}

function subscribeToMapViewport(onStoreChange: () => void) {
  // Only fires for changes made in *other* tabs — Map and Home are never both
  // mounted at once in this tab, so nothing needs to dispatch same-tab updates.
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

/**
 * Reactive read of the saved Map viewport, sourced from sessionStorage via
 * useSyncExternalStore — the same pattern PostCard's useSavedPostIds() uses for
 * localStorage. Keeping the raw string as the snapshot (rather than the parsed
 * object) avoids returning a new object reference on every render, which would
 * otherwise make useSyncExternalStore think the store changes on every read.
 */
export function useSavedMapViewport(): MapViewport | null {
  const raw = useSyncExternalStore(
    subscribeToMapViewport,
    getMapViewportSnapshot,
    getServerMapViewportSnapshot,
  );

  return useMemo(() => parseMapViewport(raw || null), [raw]);
}

/** Whether a post has everything needed to place it on the map (and show "View on Map"). */
export function hasValidMapLocation(
  post: Post,
): post is Post & { latitude: number; longitude: number } {
  return post.showOnMap && typeof post.latitude === "number" && typeof post.longitude === "number";
}

function isPostInBounds(post: Post, bounds: MapBounds): boolean {
  return (
    hasValidMapLocation(post) &&
    post.latitude >= bounds.south &&
    post.latitude <= bounds.north &&
    post.longitude >= bounds.west &&
    post.longitude <= bounds.east
  );
}

/** Every location-enabled post (image, video, or text) that falls inside the given bounds. */
export function filterPostsInBounds(posts: Post[], bounds: MapBounds): Post[] {
  return posts.filter((post) => isPostInBounds(post, bounds));
}
