"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type * as LType from "leaflet";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getDisplayTitle } from "@/lib/postDisplay";
import { useAllPosts } from "@/lib/posts";
import { buildClusterIndex, buildMapItems, getVisibleMapFeatures, pickClusterCoverImage, type MapItemIndex } from "@/lib/map/clustering";
import { readMapViewport, saveMapViewport } from "@/lib/map/viewport";
import type { MapViewport } from "@/lib/map/types";
import { logMapInteractionEvent } from "@/lib/recommendation/events";
import { postMatchesQuery } from "@/lib/search";
import type { Post } from "@/types/post";
import PostClusterMarker, { clusterMarkerSizePx } from "./PostClusterMarker";
import PostMapMarker from "./PostMapMarker";

// Starting point when no viewport has been saved yet and there's no post to
// center on — a campus-scale view of UC Berkeley (Sather Tower/Sproul Plaza
// area), matching Kavanaka's campus-discovery focus, rather than a neutral
// world view. Only ever used once per session: the mount effect below saves
// whatever it opens at as the new "saved" viewport immediately afterward, so
// this is purely the seed for a first-ever Map visit, not a recurring reset.
const FALLBACK_CENTER = { lat: 37.8719, lng: -122.2585 };
const FALLBACK_ZOOM = 15;
const MOVE_DEBOUNCE_MS = 200;
// Matches clustering.ts's Supercluster maxZoom — close enough that a targeted
// post is shown as an individual pin rather than folded into a cluster.
const TARGET_POST_ZOOM = 17;

type MapTimeFilter = "week" | "month" | "all";

const MAP_TIME_FILTER_OPTIONS: { value: MapTimeFilter; label: string }[] = [
  { value: "week", label: "1 Week" },
  { value: "month", label: "1 Month" },
  { value: "all", label: "All" },
];

/** "All" never excludes anything. "1 Week"/"1 Month" require a real,
 *  parseable createdAt — a post with none is excluded from those two rather
 *  than guessed into either window. "1 Month" is one calendar month back
 *  (e.g. Aug 17 -> Jul 17), not a fixed 30-day approximation. */
function isWithinMapTimeFilter(createdAt: string | undefined, filter: MapTimeFilter): boolean {
  if (filter === "all") return true;
  if (!createdAt) return false;

  const createdMs = new Date(createdAt).getTime();
  if (Number.isNaN(createdMs)) return false;

  const cutoff = new Date();
  if (filter === "week") {
    cutoff.setDate(cutoff.getDate() - 7);
  } else {
    cutoff.setMonth(cutoff.getMonth() - 1);
  }
  return createdMs >= cutoff.getTime();
}

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
  const { user } = useAuth();
  // Read inside the marker click handler (bound once, imperatively, inside
  // updateMarkers below) instead of adding `user` to updateMarkers's own
  // dependency array — the auth session object can get a new reference on a
  // background token refresh even for the same signed-in user, and
  // updateMarkers changing identity would retrigger the marker-layer
  // rebuild effect further down, which has no reason to run just because a
  // token refreshed. Same ref-around-a-Leaflet-handler pattern this file
  // already uses for highlightedItemRef/suppressNextViewportSaveRef.
  const currentUserIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    currentUserIdRef.current = user?.id;
  }, [user]);

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

  const [timeFilter, setTimeFilter] = useState<MapTimeFilter>("month");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // Only ever goes false -> true, for the rest of this page's life — mirrors
  // hasResolvedTargetRef's own "once per page life" reset boundary below.
  // While it's still false AND we arrived via a postId deep link, the target
  // post is kept visible even if it falls outside the active time/keyword
  // filters; the moment the user actually touches a filter control (a time
  // pill, or typing into search), that exception stops being applied on
  // every subsequent render, with no effect on the filters' own values
  // (they already show/apply whatever was actually selected/typed).
  const [hasManuallyChangedFilter, setHasManuallyChangedFilter] = useState(false);
  const targetExceptionActive = targetPostId !== null && !hasManuallyChangedFilter;

  function handleSelectTimeFilter(value: MapTimeFilter) {
    setTimeFilter(value);
    setHasManuallyChangedFilter(true);
  }

  function handleSearchQueryChange(value: string) {
    setSearchQuery(value);
    setHasManuallyChangedFilter(true);
  }

  function closeSearch() {
    setSearchQuery("");
    setIsSearchOpen(false);
  }

  // The actual source list clustering/markers are built from — every other
  // Map eligibility rule (show_on_map, valid coordinates, RLS/moderation
  // visibility) is already baked into what useAllPosts() returns and what
  // buildMapItems selects. Time and keyword combine with AND: both filters
  // apply to the same source list, in one pass, before anything downstream
  // (clustering, marker generation, cluster-feed postIds) ever sees it —
  // postMatchesQuery already treats a blank query as "matches everything,"
  // so no separate branch is needed for "search is empty."
  const filteredPosts = useMemo(() => {
    const withinFilter = allPosts
      .filter((post) => isWithinMapTimeFilter(post.createdAt, timeFilter))
      .filter((post) => postMatchesQuery(post, searchQuery));
    if (!targetExceptionActive) return withinFilter;
    if (withinFilter.some((post) => post.id === targetPostId)) return withinFilter;

    const targetPost = allPosts.find((post) => post.id === targetPostId);
    return targetPost ? [...withinFilter, targetPost] : withinFilter;
  }, [allPosts, timeFilter, searchQuery, targetExceptionActive, targetPostId]);

  // Every located point built from the FILTERED list — this is what actually
  // drives clustering/markers, and what cluster.postIds (and therefore any
  // area/cluster feed opened from a tapped cluster) is derived from. See
  // buildMapItems for the per-photo-vs-post-level precedence rule.
  const mapItems = useMemo(() => buildMapItems(filteredPosts), [filteredPosts]);

  // Unfiltered — used ONLY to resolve a postId deep-link's target location.
  // The active time filter must never prevent "View on Map" from finding and
  // centering on the exact post it was asked to show.
  const allMapItems = useMemo(() => buildMapItems(allPosts), [allPosts]);

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

        // Templated text post (no media at all) — a legacy text post (no
        // textTemplate) leaves this undefined and PostMapMarker falls back
        // to its existing pencil placeholder.
        const textTemplate = !cover && post.textTemplate ? post.textTemplate : undefined;

        const icon = leaflet.divIcon({
          html: renderToStaticMarkup(
            <PostMapMarker
              cover={cover}
              title={getDisplayTitle(post)}
              highlighted={
                highlightedItemRef.current?.postId === postId && highlightedItemRef.current?.mediaId === mediaId
              }
              textTemplate={textTemplate}
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
            // Direct single-marker -> PostDetail open only — a cluster ->
            // cluster-feed -> PostCard open goes through PostCard's own
            // detail_click instrumentation instead (see the plan's
            // Decisions on why this isn't split into a separate signal).
            const userId = currentUserIdRef.current;
            if (userId) {
              logMapInteractionEvent(userId, postId);
            }
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

  // Rebuild the clustering index only when the underlying (already time-
  // filtered) post set actually changes, then redraw markers for the current
  // viewport. postsByIdRef is built from every FILTERED post, not just ones
  // with a post-level location — a per-photo post deliberately has no
  // post-level location at all (see MediaPostEditor), so filtering here by
  // location would silently drop its own markers. Every id mapItems can ever
  // reference is guaranteed to be in filteredPosts already, since mapItems is
  // itself derived from it.
  useEffect(() => {
    if (!isMapReady) return;

    let cancelled = false;
    postsByIdRef.current = new Map(filteredPosts.map((post) => [post.id, post]));

    buildClusterIndex(mapItems).then((index) => {
      if (cancelled) return;
      clusterIndexRef.current = index;
      updateMarkers();
    });

    return () => {
      cancelled = true;
    };
  }, [filteredPosts, mapItems, isMapReady, updateMarkers]);

  // Resolve a "View on Map" target once posts are available: center on the
  // exact item (a specific photo, or the post-level location), zoom in
  // close, and mark it highlighted — without touching the ambient viewport
  // (see the mount effect and scheduleUpdate above for how that separation
  // is kept). When mediaId is absent (a legacy /map?postId= link), matches
  // the post's legacy item if it still has one, or — for a post that has
  // since become per-photo-located — falls back to its first located photo
  // (media[0]-first convention, same as pickClusterCoverImage/PostCard's own
  // cover-selection precedent), so a stale link still lands somewhere
  // sensible rather than resolving to nothing. Deliberately reads the
  // UNFILTERED allMapItems, not mapItems — finding and centering on the
  // requested post can never depend on the active time filter (the target
  // exception above keeps its marker visible too, for as long as the filter
  // hasn't been manually touched).
  useEffect(() => {
    if (!isMapReady || targetPostId === null || hasResolvedTargetRef.current) return;

    const map = mapRef.current;
    if (!map) return;

    const target = allMapItems.find(
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
  }, [isMapReady, allMapItems, allPosts.length, targetPostId, targetMediaId, updateMarkers]);

  return (
    <main className="relative mx-auto h-dvh w-full max-w-md overflow-hidden bg-stone-200 pb-20 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <div ref={containerRef} className="h-full w-full" />

      {/* Full-width, non-interactive overlay spanning the map's own column
          (Leaflet's zoom control lives outside this entirely, at its native
          top-left position — untouched). The time-filter pills and the
          search control are each independently absolutely-positioned within
          it (time-filter horizontally centered on the column, search pinned
          right) rather than flex siblings in one row — that older layout
          made the time-filter's position depend on the search control (and
          collide with Leaflet's own top-left zoom control); this way each
          control's position is independent and neither can push the other. */}
      <div className="pointer-events-none absolute inset-x-0 top-3 z-[1000] px-3">
        <div className="pointer-events-auto absolute left-1/2 top-0 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-white/95 p-1 shadow-[0_4px_16px_rgba(50,40,30,0.18)] backdrop-blur">
          {MAP_TIME_FILTER_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => handleSelectTimeFilter(option.value)}
              aria-pressed={timeFilter === option.value}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-bold transition-colors ${
                timeFilter === option.value ? "bg-stone-900 text-white" : "text-stone-500"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Keyword search — a second, independent filter dimension from the
            time pills, combined with AND (see filteredPosts). Compact and
            collapsible on purpose: it must never cover much map area, and an
            empty query is exactly equivalent to not searching at all. */}
        {isSearchOpen ? (
          <div className="pointer-events-auto absolute right-0 top-0 flex min-w-0 shrink items-center gap-1 rounded-full bg-white/95 py-1.5 pl-3 pr-1.5 shadow-[0_4px_16px_rgba(50,40,30,0.18)] backdrop-blur">
            <input
              autoFocus
              type="text"
              value={searchQuery}
              onChange={(event) => handleSearchQueryChange(event.target.value)}
              placeholder="Search posts…"
              aria-label="Search map posts"
              className="w-20 min-w-0 bg-transparent text-[12px] text-stone-900 outline-none placeholder:text-stone-400"
            />
            <button
              type="button"
              onClick={closeSearch}
              aria-label="Clear search"
              className="grid size-6 shrink-0 place-items-center rounded-full text-stone-500"
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsSearchOpen(true)}
            aria-label="Search map"
            className="pointer-events-auto absolute right-0 top-0 grid size-10 shrink-0 place-items-center rounded-full bg-white/95 text-kavanaka-aqua shadow-[0_4px_16px_rgba(50,40,30,0.18)] backdrop-blur"
          >
            ⌕
          </button>
        )}
      </div>
    </main>
  );
}
