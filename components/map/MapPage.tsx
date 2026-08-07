"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type * as LType from "leaflet";
import DemoPhoto from "@/components/DemoPhoto";
import PostVideoTile from "@/components/PostVideoTile";
import { getDisplayTitle } from "@/lib/postDisplay";
import { useAllPosts } from "@/lib/posts";
import { buildClusterIndex, getVisibleMapFeatures, type PostClusterIndex } from "@/lib/map/clustering";
import { readMapViewport, saveMapViewport } from "@/lib/map/viewport";
import type { Post } from "@/types/post";
import PostClusterMarker from "./PostClusterMarker";
import PostMapMarker from "./PostMapMarker";

const DEFAULT_ZOOM = 13;
const MOVE_DEBOUNCE_MS = 200;

type LocatedPost = Post & { latitude: number; longitude: number };

function computeCentroid(posts: LocatedPost[]) {
  const total = posts.reduce(
    (acc, post) => ({ lat: acc.lat + post.latitude, lng: acc.lng + post.longitude }),
    { lat: 0, lng: 0 },
  );
  return { lat: total.lat / posts.length, lng: total.lng / posts.length };
}

export default function MapPage() {
  const allPosts = useAllPosts();
  const mapPosts = useMemo<LocatedPost[]>(
    () =>
      allPosts.filter(
        (post): post is LocatedPost =>
          Boolean(post.showOnMap) &&
          typeof post.latitude === "number" &&
          typeof post.longitude === "number",
      ),
    [allPosts],
  );
  const hasMapPosts = mapPosts.length > 0;

  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LType.Map | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const markerLayerRef = useRef<LType.LayerGroup | null>(null);
  const clusterIndexRef = useRef<PostClusterIndex | null>(null);
  const postsByIdRef = useRef<Map<number, Post>>(new Map());
  const moveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isMapReady, setIsMapReady] = useState(false);
  const [previewPost, setPreviewPost] = useState<Post | null>(null);

  const updateMarkers = useCallback(() => {
    const map = mapRef.current;
    const leaflet = leafletRef.current;
    const index = clusterIndexRef.current;
    const layer = markerLayerRef.current;
    if (!map || !leaflet || !index || !layer) return;

    const bounds = map.getBounds();
    const bbox: [number, number, number, number] = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ];
    const features = getVisibleMapFeatures(index, bbox, map.getZoom());

    layer.clearLayers();

    for (const feature of features) {
      if (feature.kind === "post") {
        const post = postsByIdRef.current.get(feature.postId);
        if (!post || post.latitude == null || post.longitude == null) continue;

        const icon = leaflet.divIcon({
          html: renderToStaticMarkup(
            <PostMapMarker
              postType={post.postType}
              image={post.image}
              imageAlt={post.imageAlt}
              title={getDisplayTitle(post)}
            />,
          ),
          className: "",
          iconSize: [80, 100],
          iconAnchor: [40, 100],
        });
        leaflet
          .marker([post.latitude, post.longitude], { icon })
          .on("click", () => setPreviewPost(post))
          .addTo(layer);
      } else {
        const { cluster } = feature;
        const icon = leaflet.divIcon({
          html: renderToStaticMarkup(
            <PostClusterMarker
              postCount={cluster.postCount}
              representativeImageUrl={cluster.representativeImageUrl}
            />,
          ),
          className: "",
          iconSize: [64, 64],
          iconAnchor: [32, 32],
        });
        leaflet
          .marker([cluster.latitude, cluster.longitude], { icon })
          .on("click", () => {
            setPreviewPost(null);
            const params = new URLSearchParams({
              postIds: cluster.postIds.join(","),
              lat: String(cluster.latitude),
              lng: String(cluster.longitude),
              count: String(cluster.postCount),
              zoom: String(cluster.expansionZoom),
            });
            router.push(`/map/cluster/${cluster.id}?${params.toString()}`);
          })
          .addTo(layer);
      }
    }
  }, [router]);

  const scheduleUpdate = useCallback(() => {
    if (moveTimeoutRef.current) clearTimeout(moveTimeoutRef.current);
    moveTimeoutRef.current = setTimeout(() => {
      updateMarkers();
      const map = mapRef.current;
      if (map) {
        const center = map.getCenter();
        saveMapViewport({ lat: center.lat, lng: center.lng, zoom: map.getZoom() });
      }
    }, MOVE_DEBOUNCE_MS);
  }, [updateMarkers]);

  // Mount the Leaflet map once there is at least one post to show. Never re-created
  // on data changes — only the marker layer is refreshed (see the effect below).
  useEffect(() => {
    if (!hasMapPosts || !containerRef.current || mapRef.current) return;

    let cancelled = false;

    (async () => {
      const leaflet = await import("leaflet");
      if (cancelled || !containerRef.current) return;

      leafletRef.current = leaflet;

      const savedViewport = readMapViewport();
      const initialCenter = savedViewport ?? { ...computeCentroid(mapPosts), zoom: DEFAULT_ZOOM };

      const map = leaflet.map(containerRef.current, {
        center: [initialCenter.lat, initialCenter.lng],
        zoom: initialCenter.zoom,
        zoomControl: true,
      });

      leaflet
        .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap contributors",
        })
        .addTo(map);

      markerLayerRef.current = leaflet.layerGroup().addTo(map);
      mapRef.current = map;

      map.on("moveend", scheduleUpdate);
      map.on("zoomend", scheduleUpdate);

      setIsMapReady(true);
    })();

    return () => {
      cancelled = true;
      if (moveTimeoutRef.current) clearTimeout(moveTimeoutRef.current);
      mapRef.current?.remove();
      mapRef.current = null;
      setIsMapReady(false);
    };
    // Intentionally only re-runs when the map goes from "nothing to show" to "has posts" —
    // the map instance itself should persist across post-list updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMapPosts]);

  // Rebuild the clustering index only when the underlying post set actually changes,
  // then redraw markers for the current viewport.
  useEffect(() => {
    if (!isMapReady) return;

    let cancelled = false;
    postsByIdRef.current = new Map(mapPosts.map((post) => [post.id, post]));

    buildClusterIndex(mapPosts).then((index) => {
      if (cancelled) return;
      clusterIndexRef.current = index;
      updateMarkers();
    });

    return () => {
      cancelled = true;
    };
  }, [mapPosts, isMapReady, updateMarkers]);

  if (!hasMapPosts) {
    return (
      <main className="mx-auto flex h-screen w-full max-w-md flex-col items-center justify-center bg-[#fbfaf7] px-8 pb-20 text-center shadow-[0_0_50px_rgba(50,40,30,0.08)]">
        <div className="grid size-14 place-items-center rounded-full bg-orange-100 text-2xl">📍</div>
        <h1 className="mt-4 text-lg font-black">No posts on the map yet.</h1>
        <p className="mt-2 text-sm leading-6 text-stone-500">
          Turn on &ldquo;Show this post on the map&rdquo; when you add a spot to see it here.
        </p>
        <Link
          href="/add"
          className="mt-5 inline-flex rounded-full bg-stone-900 px-5 py-2.5 text-sm font-bold text-white"
        >
          + Add a Spot
        </Link>
      </main>
    );
  }

  return (
    <main className="relative mx-auto h-screen w-full max-w-md overflow-hidden bg-stone-200 pb-20 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <div ref={containerRef} className="h-full w-full" />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 p-4">
        <div className="rounded-2xl bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-600">Explore the map</p>
          <h1 className="mt-0.5 text-lg font-black">Posts near you</h1>
          <p className="mt-0.5 text-xs text-stone-500">Drag or pinch to explore. Tap a pin to preview.</p>
        </div>
      </div>

      {previewPost ? (
        <article className="absolute inset-x-3 bottom-24 z-20 flex gap-3 rounded-2xl bg-white/95 p-3 shadow-xl backdrop-blur">
          <button
            type="button"
            onClick={() => setPreviewPost(null)}
            aria-label="Close preview"
            className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-stone-900/80 text-xs text-white"
          >
            ×
          </button>
          {previewPost.postType === "video" && previewPost.image ? (
            <PostVideoTile src={previewPost.image} className="h-20 w-24 shrink-0 rounded-xl" />
          ) : previewPost.postType === "image" && previewPost.image ? (
            <DemoPhoto
              src={previewPost.image}
              alt={previewPost.imageAlt ?? ""}
              className="h-20 w-24 shrink-0 rounded-xl"
            />
          ) : null}
          <div className="min-w-0 py-1 pr-4">
            {previewPost.locationName ? (
              <p className="truncate text-[10px] font-bold uppercase tracking-[0.14em] text-orange-600">
                {previewPost.locationName}
              </p>
            ) : null}
            <h2 className="mt-0.5 truncate text-sm font-black">{getDisplayTitle(previewPost)}</h2>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-stone-500">{previewPost.caption}</p>
            <Link
              href={`/post/${previewPost.id}`}
              className="mt-2 inline-flex rounded-full bg-stone-900 px-3 py-1.5 text-[11px] font-bold text-white"
            >
              View post
            </Link>
          </div>
        </article>
      ) : null}
    </main>
  );
}
