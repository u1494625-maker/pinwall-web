import type Supercluster from "supercluster";
import type { Post, PostMedia } from "@/types/post";
import { hasValidMapLocation } from "./viewport";
import type { MapCluster, MapClusterItemRef } from "./types";

/** A single located point on the Map: either a specific photo's own
 *  location (`mediaId` set) or a legacy post-level location (`mediaId`
 *  null). See buildMapItems for the precedence rule between the two. */
export type MapItem = {
  postId: number;
  mediaId: number | null;
  latitude: number;
  longitude: number;
};

type MapItemPointProps = {
  postId: number;
  mediaId: number | null;
};

type ClusterAccumulatedProps = {
  items: MapItemPointProps[];
};

export type MapItemIndex = Supercluster<MapItemPointProps, ClusterAccumulatedProps>;

export type MapFeature =
  | { kind: "cluster"; cluster: MapCluster }
  | { kind: "item"; postId: number; mediaId: number | null };

/**
 * Precedence rule between a post's own location and its individual photos'
 * locations: if ANY media in the post has its own valid coordinates, every
 * such media becomes its own map item and the post-level location is
 * ignored entirely (never both, to avoid duplicating one post on the map).
 * Otherwise, exactly one legacy item comes from the post-level location, if
 * the post has one — unchanged behavior for every post published before
 * per-photo locations existed.
 */
export function buildMapItems(posts: Post[]): MapItem[] {
  const items: MapItem[] = [];

  for (const post of posts) {
    const locatedMedia = post.media.filter(
      (media): media is PostMedia & { latitude: number; longitude: number } =>
        media.latitude != null && media.longitude != null,
    );

    if (locatedMedia.length > 0) {
      for (const media of locatedMedia) {
        items.push({ postId: post.id, mediaId: media.id, latitude: media.latitude, longitude: media.longitude });
      }
    } else if (hasValidMapLocation(post)) {
      items.push({ postId: post.id, mediaId: null, latitude: post.latitude, longitude: post.longitude });
    }
  }

  return items;
}

/** Builds an immutable clustering index from every map-eligible item. Rebuild only when the item list changes. */
export async function buildClusterIndex(items: MapItem[]): Promise<MapItemIndex> {
  const SuperclusterCtor = (await import("supercluster")).default;

  const index = new SuperclusterCtor<MapItemPointProps, ClusterAccumulatedProps>({
    radius: 60,
    maxZoom: 17,
    map: (props): ClusterAccumulatedProps => ({
      items: [props],
    }),
    reduce: (accumulated, props) => {
      accumulated.items = accumulated.items.concat(props.items);
    },
  });

  index.load(
    items.map((item) => ({
      type: "Feature",
      properties: {
        postId: item.postId,
        mediaId: item.mediaId,
      },
      geometry: {
        type: "Point",
        coordinates: [item.longitude, item.latitude],
      },
    })),
  );

  return index;
}

/** Returns clusters/points for the current viewport, translated into render-ready map features. */
export function getVisibleMapFeatures(
  index: MapItemIndex,
  bbox: [number, number, number, number],
  zoom: number,
): MapFeature[] {
  const roundedZoom = Math.round(zoom);

  return index.getClusters(bbox, roundedZoom).map((feature): MapFeature => {
    const [longitude, latitude] = feature.geometry.coordinates;

    if ("cluster" in feature.properties) {
      const clusterId = feature.properties.cluster_id;
      let expansionZoom = roundedZoom + 1;
      try {
        expansionZoom = index.getClusterExpansionZoom(clusterId);
      } catch {
        // Keep the fallback if the index can't resolve an expansion zoom.
      }

      const items: MapClusterItemRef[] = feature.properties.items;
      // Deduped — a post with two located photos bundled into the same
      // cluster must still produce exactly one card in the cluster feed.
      const postIds = Array.from(new Set(items.map((item) => item.postId)));

      return {
        kind: "cluster",
        cluster: {
          id: clusterId,
          latitude,
          longitude,
          itemCount: feature.properties.point_count,
          items,
          postIds,
          expansionZoom,
        },
      };
    }

    return { kind: "item", postId: feature.properties.postId, mediaId: feature.properties.mediaId };
  });
}

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance between two lat/lng points, in kilometers. */
function haversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** A media item's own image, but only when it's actually an image — matches
 *  the existing convention (photos and video are never mixed in one post)
 *  that media[0] is the image whenever the post has one at all. */
function usableImageUrl(media: PostMedia | undefined): string | undefined {
  return media?.type === "image" ? media.url : undefined;
}

/**
 * The cluster's own cover image: the first usable image belonging to
 * whichever member item is geographically closest to the cluster's center,
 * skipping outward past any nearer text/video-only/imageless items. For a
 * media-level item this is that specific photo; for a legacy post-level
 * item (mediaId null) this is the post's own media[0], exactly as before.
 * Undefined only if no member item has a usable image at all — callers
 * should fall back to the existing non-image marker treatment in that case.
 */
export function pickClusterCoverImage(
  center: { latitude: number; longitude: number },
  items: MapClusterItemRef[],
  postsById: Map<number, Post>,
): string | undefined {
  const nearestFirst = items
    .map((item) => {
      const post = postsById.get(item.postId);
      if (!post) return null;

      const media = item.mediaId != null ? post.media.find((candidate) => candidate.id === item.mediaId) : post.media[0];
      const lat = item.mediaId != null ? media?.latitude : post.latitude;
      const lng = item.mediaId != null ? media?.longitude : post.longitude;
      if (lat == null || lng == null) return null;

      return { media, distanceKm: haversineDistanceKm(center.latitude, center.longitude, lat, lng) };
    })
    .filter((entry): entry is { media: PostMedia | undefined; distanceKm: number } => entry !== null)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  for (const { media } of nearestFirst) {
    const imageUrl = usableImageUrl(media);
    if (imageUrl) return imageUrl;
  }

  return undefined;
}
