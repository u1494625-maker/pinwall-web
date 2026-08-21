import { useMemo, useSyncExternalStore } from "react";
import type { Post, PostMedia } from "@/types/post";
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
 * useSyncExternalStore — the same pattern PinWallHome's useHomeTab() uses for
 * its own sessionStorage-backed tab state. Keeping the raw string as the
 * snapshot (rather than the parsed object) avoids returning a new object
 * reference on every render, which would otherwise make useSyncExternalStore
 * think the store changes on every read.
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

function isPointInBounds(lat: number, lng: number, bounds: MapBounds): boolean {
  return lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east;
}

/**
 * Every point this post could actually be plotted at on the Map: each
 * per-photo location if any of its media has one, otherwise its single
 * post-level location (if valid) — same precedence rule as
 * lib/map/clustering.ts's buildMapItems, duplicated here rather than
 * imported (clustering.ts already imports hasValidMapLocation from this
 * file, so importing back from it would be circular). Keeping the two in
 * sync matters: this is "does this post have a marker anywhere," so it must
 * agree with whichever points actually render as markers there.
 */
function postMapPoints(post: Post): { lat: number; lng: number }[] {
  const locatedMedia = post.media.filter(
    (media): media is PostMedia & { latitude: number; longitude: number } =>
      media.latitude != null && media.longitude != null,
  );
  if (locatedMedia.length > 0) {
    return locatedMedia.map((media) => ({ lat: media.latitude, lng: media.longitude }));
  }
  if (hasValidMapLocation(post)) {
    return [{ lat: post.latitude, lng: post.longitude }];
  }
  return [];
}

/** A post qualifies the moment ANY one of its map points falls inside the
 *  given bounds — a multi-location post must not require every one of its
 *  photos to be simultaneously visible, only at least one. */
function isPostInBounds(post: Post, bounds: MapBounds): boolean {
  return postMapPoints(post).some((point) => isPointInBounds(point.lat, point.lng, bounds));
}

/** Every location-enabled post (image, video, or text) with at least one map
 *  point inside the given bounds — each qualifying post appears exactly
 *  once, with its full original media list, regardless of how many of its
 *  own points are visible. */
export function filterPostsInBounds(posts: Post[], bounds: MapBounds): Post[] {
  return posts.filter((post) => isPostInBounds(post, bounds));
}
