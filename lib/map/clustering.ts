import type Supercluster from "supercluster";
import type { Post } from "@/types/post";
import type { MapCluster } from "./types";

export type PostPointProps = {
  postId: number;
  /** The post's cover image URL — only ever set when the cover is an image (never video/text). */
  coverImageUrl: string | undefined;
};

export type ClusterAccumulatedProps = {
  postIds: number[];
  /** Only ever sourced from an actual image post in the cluster — never a video URL, never null. */
  representativeImageUrl: string | undefined;
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
      representativeImageUrl: props.coverImageUrl,
    }),
    reduce: (accumulated, props) => {
      accumulated.postIds = accumulated.postIds.concat(props.postIds);
      // Prefer keeping whichever representative image was found first; only fill it
      // in from a later point if the cluster didn't already have one.
      if (!accumulated.representativeImageUrl && props.representativeImageUrl) {
        accumulated.representativeImageUrl = props.representativeImageUrl;
      }
    },
  });

  index.load(
    posts.map((post) => ({
      type: "Feature",
      properties: {
        postId: post.id,
        coverImageUrl: post.media[0]?.type === "image" ? post.media[0].url : undefined,
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
          representativeImageUrl: feature.properties.representativeImageUrl,
          expansionZoom,
        },
      };
    }

    return { kind: "post", postId: feature.properties.postId };
  });
}
