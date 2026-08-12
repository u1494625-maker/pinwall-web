import type Supercluster from "supercluster";
import type { Post } from "@/types/post";
import type { MapCluster } from "./types";

export type PostPointProps = {
  postId: number;
};

export type ClusterAccumulatedProps = {
  postIds: number[];
};

export type PostClusterIndex = Supercluster<PostPointProps, ClusterAccumulatedProps>;

export type MapFeature =
  | { kind: "cluster"; cluster: MapCluster }
  | { kind: "post"; postId: number };

/** Builds an immutable clustering index from every map-eligible post. Rebuild only when the post list changes. */
export async function buildClusterIndex(posts: Post[]): Promise<PostClusterIndex> {
  const SuperclusterCtor = (await import("supercluster")).default;

  const index = new SuperclusterCtor<PostPointProps, ClusterAccumulatedProps>({
    radius: 60,
    maxZoom: 17,
    map: (props): ClusterAccumulatedProps => ({
      postIds: [props.postId],
    }),
    reduce: (accumulated, props) => {
      accumulated.postIds = accumulated.postIds.concat(props.postIds);
    },
  });

  index.load(
    posts.map((post) => ({
      type: "Feature",
      properties: {
        postId: post.id,
      },
      geometry: {
        type: "Point",
        coordinates: [post.longitude as number, post.latitude as number],
      },
    })),
  );

  return index;
}

/** Returns clusters/points for the current viewport, translated into render-ready map features. */
export function getVisibleMapFeatures(
  index: PostClusterIndex,
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

      return {
        kind: "cluster",
        cluster: {
          id: clusterId,
          latitude,
          longitude,
          postCount: feature.properties.point_count,
          postIds: feature.properties.postIds,
          expansionZoom,
        },
      };
    }

    return { kind: "post", postId: feature.properties.postId };
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

/** A post's own cover, but only when it's actually an image — matches the
 *  existing convention (photos and video are never mixed in one post) that
 *  media[0] is the image whenever the post has one at all. */
function usableCoverImageUrl(post: Post): string | undefined {
  const cover = post.media[0];
  return cover?.type === "image" ? cover.url : undefined;
}

/**
 * The cluster's own cover image: the first usable image belonging to
 * whichever member post is geographically closest to the cluster's center,
 * skipping outward past any nearer text/video-only/imageless posts.
 * Undefined only if no member post has a usable image at all — callers
 * should fall back to the existing non-image marker treatment in that case.
 */
export function pickClusterCoverImage(
  center: { latitude: number; longitude: number },
  postIds: number[],
  postsById: Map<number, Post>,
): string | undefined {
  const nearestFirst = postIds
    .map((id) => postsById.get(id))
    .filter((post): post is Post => post != null && post.latitude != null && post.longitude != null)
    .map((post) => ({
      post,
      distanceKm: haversineDistanceKm(center.latitude, center.longitude, post.latitude as number, post.longitude as number),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);

  for (const { post } of nearestFirst) {
    const imageUrl = usableCoverImageUrl(post);
    if (imageUrl) return imageUrl;
  }

  return undefined;
}
