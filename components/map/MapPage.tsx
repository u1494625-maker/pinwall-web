"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type * as LType from "leaflet";
import { getDisplayTitle } from "@/lib/postDisplay";
import { useAllPosts } from "@/lib/posts";
import { buildClusterIndex, getVisibleMapFeatures, type PostClusterIndex } from "@/lib/map/clustering";
import { hasValidMapLocation, readMapViewport, saveMapViewport } from "@/lib/map/viewport";
import type { MapViewport } from "@/lib/map/types";
import type { Post } from "@/types/post";
import PostClusterMarker, { clusterMarkerSizePx } from "./PostClusterMarker";
import PostMapMarker from "./PostMapMarker";

// Neutral starting point when no viewport has been saved yet and there's no post
// to center on — same convention LocationPicker uses for "no location yet".
const FALLBACK_CENTER = { lat: 20, lng: 0 };
const FALLBACK_ZOOM = 2;
const MOVE_DEBOUNCE_MS = 200;
// Matches clustering.ts's Supercluster maxZoom — close enough that a targeted
// post is shown as an individual pin rather than folded into a cluster.
const TARGET_POST_ZOOM = 17;

type LocatedPost = Post & { latitude: number; longitude: number };

function viewportFromMap(map: LType.Map): MapViewport {
  const center = map.getCenter();
  const bounds = map.getBounds();
  return {
    lat: center.lat,
    lng: center.lng,
    zoom: map.getZoom(),
    bounds: {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
    },
  };
}

export default function MapPage() {
  const allPosts = useAllPosts();
  const mapPosts = useMemo<LocatedPost[]>(
    () => allPosts.filter(hasValidMapLocation),
    [allPosts],
  );

  const router = useRouter();
  const searchParams = useSearchParams();
  const rawTargetPostId = searchParams.get("postId");
  const targetPostId = useMemo(() => {
    const parsed = rawTargetPostId === null ? NaN : Number(rawTargetPostId);
    return Number.isFinite(parsed) ? parsed : null;
  }, [rawTargetPostId]);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LType.Map | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const markerLayerRef = useRef<LType.LayerGroup | null>(null);
  const clusterIndexRef = useRef<PostClusterIndex | null>(null);
  const postsByIdRef = useRef<Map<number, Post>>(new Map());
  const moveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Which post's marker should render highlighted (the "View on Map" deep-link
  // target only, now that clicking a marker navigates straight to Post Detail
  // instead of opening a preview) — read by updateMarkers via ref (not React
  // state) because it's called from Leaflet event handlers bound once at
  // mount, which would otherwise close over a stale value.
  const highlightedPostIdRef = useRef<number | null>(null);
  // Set right before a one-shot programmatic camera move (View on Map targeting)
  // so the very next debounced save skips persisting it as the ambient viewport.
  const suppressNextViewportSaveRef = useRef(false);
  // Guards the target-post effect below so it applies at most once per page life.
  const hasResolvedTargetRef = useRef(false);
  // Lets a marker's own click handler (defined inside updateMarkers, below)
  // trigger a fresh redraw without updateMarkers referencing itself.
  const updateMarkersRef = useRef<() => void>(() => {});

  const [isMapReady, setIsMapReady] = useState(false);

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
              cover={post.media[0]}
              title={getDisplayTitle(post)}
              highlighted={highlightedPostIdRef.current === post.id}
            />,
          ),
          className: "",
          // Anchored to the bottom-center of the fixed-size photo/pin bubble only — the
          // caption label below it is variable-height and renders outside this box.
          iconSize: [80, 80],
          iconAnchor: [40, 80],
        });
        leaflet
          .marker([post.latitude, post.longitude], { icon })
          .on("click", () => {
            router.push(`/post/${post.id}`);
          })
          .addTo(layer);
      } else {
        const { cluster } = feature;
        // Matches this cluster's actual rendered bubble size (48/56/64px) — not a fixed
        // constant — so the anchor stays centered regardless of postCount.
        const size = clusterMarkerSizePx(cluster.postCount);
        const icon = leaflet.divIcon({
          html: renderToStaticMarkup(
            <PostClusterMarker
              postCount={cluster.postCount}
              representativeImageUrl={cluster.representativeImageUrl}
            />,
          ),
          className: "",
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });
        leaflet
          .marker([cluster.latitude, cluster.longitude], { icon })
          .on("click", () => {
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

  useEffect(() => {
    updateMarkersRef.current = updateMarkers;
  }, [updateMarkers]);

  const scheduleUpdate = useCallback(() => {
    if (moveTimeoutRef.current) clearTimeout(moveTimeoutRef.current);
    moveTimeoutRef.current = setTimeout(() => {
      updateMarkers();
      const map = mapRef.current;
      if (!map) return;

      // The one-shot "View on Map" camera move fires this same moveend/zoomend
      // path — skip persisting just that move as the ambient viewport. Any pan
      // or zoom after this point runs with the flag already consumed, so it
      // saves normally.
      if (suppressNextViewportSaveRef.current) {
        suppressNextViewportSaveRef.current = false;
        return;
      }

      saveMapViewport(viewportFromMap(map));
    }, MOVE_DEBOUNCE_MS);
  }, [updateMarkers]);

  // Mount the Leaflet map on first render regardless of post count — Map is an
  // area-selection tool independent of whether there's anything to show yet.
  // Never re-created on data changes — only the marker layer is refreshed (see
  // the effect below).
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let cancelled = false;

    (async () => {
      const leaflet = await import("leaflet");
      if (cancelled || !containerRef.current) return;

      leafletRef.current = leaflet;

      const savedViewport = readMapViewport();
      const initialCenter = savedViewport ?? { ...FALLBACK_CENTER, zoom: FALLBACK_ZOOM };

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

      // Opening Map and seeing its initial area counts as selecting one — save it
      // right away rather than waiting for the user to pan/zoom first. Skipped
      // when arriving via a targeted post link: the resolution effect below
      // either applies the post's location (without saving) or, once posts have
      // loaded and no valid target is found, performs this save itself instead.
      if (targetPostId === null) {
        saveMapViewport(viewportFromMap(map));
      }
    })();

    return () => {
      cancelled = true;
      if (moveTimeoutRef.current) clearTimeout(moveTimeoutRef.current);
      mapRef.current?.remove();
      mapRef.current = null;
      setIsMapReady(false);
    };
    // Mount once; the map instance persists across post-list updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Resolve a "View on Map" target once posts are available: center on the
  // post, zoom in close, and mark it highlighted — without touching the
  // ambient viewport (see the mount effect and scheduleUpdate above for how
  // that separation is kept).
  useEffect(() => {
    if (!isMapReady || targetPostId === null || hasResolvedTargetRef.current) return;

    const map = mapRef.current;
    if (!map) return;

    const target = mapPosts.find((post) => post.id === targetPostId);

    if (target) {
      hasResolvedTargetRef.current = true;
      suppressNextViewportSaveRef.current = true;
      // Apply the highlight once the camera actually settles (Leaflet fires
      // moveend whether or not the move animates), rather than eagerly inside
      // this effect body.
      map.once("moveend", () => {
        highlightedPostIdRef.current = target.id;
        updateMarkersRef.current();
      });
      map.setView([target.latitude, target.longitude], TARGET_POST_ZOOM);
      return;
    }

    // No matching, located post — postId may be invalid, missing, or point at a
    // post without a location, or posts simply haven't finished loading yet.
    // Only give up once posts have actually loaded (allPosts.length > 0); at
    // that point this behaves exactly like a plain /map visit and establishes
    // the ambient viewport from wherever the map already is.
    if (allPosts.length > 0) {
      hasResolvedTargetRef.current = true;
      saveMapViewport(viewportFromMap(map));
    }
  }, [isMapReady, mapPosts, allPosts.length, targetPostId, updateMarkers]);

  return (
    <main className="relative mx-auto h-dvh w-full max-w-md overflow-hidden bg-stone-200 pb-20 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <div ref={containerRef} className="h-full w-full" />
    </main>
  );
}
