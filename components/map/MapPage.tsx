"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type * as LType from "leaflet";
import { getDisplayTitle } from "@/lib/postDisplay";
import { useAllPosts } from "@/lib/posts";
import { buildClusterIndex, buildMapItems, getVisibleMapFeatures, pickClusterCoverImage, type MapItemIndex } from "@/lib/map/clustering";
import { readMapViewport, saveMapViewport } from "@/lib/map/viewport";
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
  // Every located point on the Map — a specific photo's own location when a
  // post uses per-photo locations, or one legacy post-level point otherwise.
  // See buildMapItems for the exact precedence rule.
  const mapItems = useMemo(() => buildMapItems(allPosts), [allPosts]);

  const router = useRouter();
  const searchParams = useSearchParams();
  const rawTargetPostId = searchParams.get("postId");
  const targetPostId = useMemo(() => {
    const parsed = rawTargetPostId === null ? NaN : Number(rawTargetPostId);
    return Number.isFinite(parsed) ? parsed : null;
  }, [rawTargetPostId]);
  const rawTargetMediaId = searchParams.get("mediaId");
  const targetMediaId = useMemo(() => {
    const parsed = rawTargetMediaId === null ? NaN : Number(rawTargetMediaId);
    return Number.isFinite(parsed) ? parsed : null;
  }, [rawTargetMediaId]);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LType.Map | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const markerLayerRef = useRef<LType.LayerGroup | null>(null);
  const clusterIndexRef = useRef<MapItemIndex | null>(null);
  const postsByIdRef = useRef<Map<number, Post>>(new Map());
  const moveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Which item's marker should render highlighted (the "View on Map" deep-link
  // target only, now that clicking a marker navigates straight to Post Detail
  // instead of opening a preview) — read by updateMarkers via ref (not React
  // state) because it's called from Leaflet event handlers bound once at
  // mount, which would otherwise close over a stale value. Keyed by both
  // postId and mediaId so highlighting one photo never also highlights
  // another photo belonging to the same post.
  const highlightedItemRef = useRef<{ postId: number; mediaId: number | null } | null>(null);
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
      if (feature.kind === "item") {
        const { postId, mediaId } = feature;
        const post = postsByIdRef.current.get(postId);
        if (!post) continue;

        // Which photo this specific marker represents: that exact photo for a
        // per-photo-located item, or the post's own cover for a legacy item.
        const cover = mediaId != null ? post.media.find((media) => media.id === mediaId) : post.media[0];
        const latitude = mediaId != null ? cover?.latitude : post.latitude;
        const longitude = mediaId != null ? cover?.longitude : post.longitude;
        if (latitude == null || longitude == null) continue;

        const icon = leaflet.divIcon({
          html: renderToStaticMarkup(
            <PostMapMarker
              cover={cover}
              title={getDisplayTitle(post)}
              highlighted={
                highlightedItemRef.current?.postId === postId && highlightedItemRef.current?.mediaId === mediaId
              }
            />,
          ),
          className: "",
          // Anchored to the bottom-center of the fixed-size photo/pin bubble only — the
          // caption label below it is variable-height and renders outside this box.
          iconSize: [80, 80],
          iconAnchor: [40, 80],
        });
        leaflet
          .marker([latitude, longitude], { icon })
          .on("click", () => {
            router.push(mediaId != null ? `/post/${postId}?mediaId=${mediaId}` : `/post/${postId}`);
          })
          .addTo(layer);
      } else {
        const { cluster } = feature;
        // Nearest-to-center member item with a usable image, skipping outward
        // past any nearer text/video-only items — undefined (falls back to
        // the plain orange marker) only if the whole cluster has no image.
        const representativeImageUrl = pickClusterCoverImage(
          { latitude: cluster.latitude, longitude: cluster.longitude },
          cluster.items,
          postsByIdRef.current,
        );
        // Image-bearing clusters render at the exact same box/anchor as a single
        // PostMapMarker (see its own iconSize/iconAnchor above) so a location
        // doesn't visually jump when it crosses the clustered/unclustered
        // threshold while zooming. The no-image fallback keeps its own
        // itemCount-based bubble size (48/56/64px), centered as before.
        const fallbackSize = clusterMarkerSizePx(cluster.itemCount);
        const iconSize: [number, number] = representativeImageUrl ? [80, 80] : [fallbackSize, fallbackSize];
        const iconAnchor: [number, number] = representativeImageUrl
          ? [40, 80]
          : [fallbackSize / 2, fallbackSize / 2];
        const icon = leaflet.divIcon({
          html: renderToStaticMarkup(
            <PostClusterMarker
              itemCount={cluster.itemCount}
              representativeImageUrl={representativeImageUrl}
            />,
          ),
          className: "",
          iconSize,
          iconAnchor,
        });
        leaflet
          .marker([cluster.latitude, cluster.longitude], { icon })
          .on("click", () => {
            const params = new URLSearchParams({
              postIds: cluster.postIds.join(","),
              lat: String(cluster.latitude),
              lng: String(cluster.longitude),
              count: String(cluster.itemCount),
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
  // then redraw markers for the current viewport. postsByIdRef is built from
  // EVERY post, not just ones with a post-level location — a per-photo post
  // deliberately has no post-level location at all (see MediaPostEditor), so
  // filtering here would silently drop its own markers.
  useEffect(() => {
    if (!isMapReady) return;

    let cancelled = false;
    postsByIdRef.current = new Map(allPosts.map((post) => [post.id, post]));

    buildClusterIndex(mapItems).then((index) => {
      if (cancelled) return;
      clusterIndexRef.current = index;
      updateMarkers();
    });

    return () => {
      cancelled = true;
    };
  }, [allPosts, mapItems, isMapReady, updateMarkers]);

  // Resolve a "View on Map" target once posts are available: center on the
  // exact item (a specific photo, or the post-level location), zoom in
  // close, and mark it highlighted — without touching the ambient viewport
  // (see the mount effect and scheduleUpdate above for how that separation
  // is kept). When mediaId is absent (a legacy /map?postId= link), matches
  // the post's legacy item if it still has one, or — for a post that has
  // since become per-photo-located — falls back to its first located photo
  // (media[0]-first convention, same as pickClusterCoverImage/PostCard's own
  // cover-selection precedent), so a stale link still lands somewhere
  // sensible rather than resolving to nothing.
  useEffect(() => {
    if (!isMapReady || targetPostId === null || hasResolvedTargetRef.current) return;

    const map = mapRef.current;
    if (!map) return;

    const target = mapItems.find(
      (item) => item.postId === targetPostId && (targetMediaId === null || item.mediaId === targetMediaId),
    );

    if (target) {
      hasResolvedTargetRef.current = true;
      suppressNextViewportSaveRef.current = true;
      // Apply the highlight once the camera actually settles (Leaflet fires
      // moveend whether or not the move animates), rather than eagerly inside
      // this effect body.
      map.once("moveend", () => {
        highlightedItemRef.current = { postId: target.postId, mediaId: target.mediaId };
        updateMarkersRef.current();
      });
      map.setView([target.latitude, target.longitude], TARGET_POST_ZOOM);
      return;
    }

    // No matching, located item — postId/mediaId may be invalid, missing, or
    // point at a post without a location, or posts simply haven't finished
    // loading yet. Only give up once posts have actually loaded
    // (allPosts.length > 0); at that point this behaves exactly like a plain
    // /map visit and establishes the ambient viewport from wherever the map
    // already is.
    if (allPosts.length > 0) {
      hasResolvedTargetRef.current = true;
      saveMapViewport(viewportFromMap(map));
    }
  }, [isMapReady, mapItems, allPosts.length, targetPostId, targetMediaId, updateMarkers]);

  return (
    <main className="relative mx-auto h-dvh w-full max-w-md overflow-hidden bg-stone-200 pb-20 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <div ref={containerRef} className="h-full w-full" />
    </main>
  );
}
