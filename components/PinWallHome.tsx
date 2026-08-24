"use client";

import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import LoginScreen from "./auth/LoginScreen";
import CategoryChips from "./CategoryChips";
import ExploreRefreshButton from "./ExploreRefreshButton";
import MasonryFeed, { FeedSkeleton } from "./MasonryFeed";
import TopBar from "./TopBar";
import { useAuth } from "@/lib/auth/AuthProvider";
import { saveHomeRoute } from "@/lib/homeRoute";
import { useFollowedUserIds } from "@/lib/interactions";
import { filterPostsInBounds, useSavedMapViewport } from "@/lib/map/viewport";
import { getPostsByUserIds, useAllPostsState } from "@/lib/posts";
import { useExploreFeed } from "@/lib/recommendation/useExploreFeed";
import type { Post } from "@/types/post";

type HomeTab = "Following" | "Explore" | "Maps";

const HOME_TAB_KEY = "pinwall_home_tab";
const VALID_HOME_TABS: readonly HomeTab[] = ["Following", "Explore", "Maps"];
const DEFAULT_HOME_TAB: HomeTab = "Explore";

function isValidHomeTab(value: string | null): value is HomeTab {
  return value !== null && (VALID_HOME_TABS as readonly string[]).includes(value);
}

// sessionStorage's own "storage" event only fires in *other* tabs, never the tab that
// made the change — so selecting a tab wouldn't otherwise update this same mount.
// This small same-tab listener set is what makes clicking a tab feel immediate.
const homeTabListeners = new Set<() => void>();

function saveHomeTab(tab: HomeTab) {
  try {
    window.sessionStorage.setItem(HOME_TAB_KEY, tab);
  } catch {
    // Ignore storage failures (e.g. private browsing quota) — same as lib/map/viewport.ts.
  }
  homeTabListeners.forEach((listener) => listener());
}

function getHomeTabSnapshot(): string {
  try {
    return window.sessionStorage.getItem(HOME_TAB_KEY) ?? "";
  } catch {
    return "";
  }
}

function getServerHomeTabSnapshot(): string {
  return "";
}

function subscribeToHomeTab(onStoreChange: () => void) {
  homeTabListeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    homeTabListeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

/**
 * The currently selected Home tab, persisted per-browser-session. Deterministic and
 * hydration-safe: getServerHomeTabSnapshot always returns "" (-> Explore) for both the
 * server render and the client's first hydration pass — React's useSyncExternalStore
 * contract guarantees that match — then reconciles to the real stored tab right after,
 * same pattern as lib/map/viewport.ts's useSavedMapViewport.
 */
function useHomeTab(): HomeTab {
  const raw = useSyncExternalStore(subscribeToHomeTab, getHomeTabSnapshot, getServerHomeTabSnapshot);
  return isValidHomeTab(raw) ? raw : DEFAULT_HOME_TAB;
}

// Remembers each tab's own scroll position across a full PinWallHome remount
// (e.g. Home -> Post Detail -> Map -> Home are separate routes, so this
// component unmounts and remounts) — same sessionStorage-per-tab idiom as
// useHomeTab above, just for scroll offset instead of the selected tab.
const HOME_SCROLL_KEY_PREFIX = "pinwall_home_scroll_";

function saveHomeScrollY(tab: HomeTab, y: number) {
  try {
    window.sessionStorage.setItem(HOME_SCROLL_KEY_PREFIX + tab, String(y));
  } catch {
    // Ignore storage failures (e.g. private browsing quota) — same as saveHomeTab above.
  }
}

function readHomeScrollY(tab: HomeTab): number {
  try {
    return Number(window.sessionStorage.getItem(HOME_SCROLL_KEY_PREFIX + tab)) || 0;
  } catch {
    return 0;
  }
}

// React warns if useLayoutEffect runs during server rendering ("does nothing
// on the server") — PinWallHome IS server-rendered (it's the / page), so the
// scroll-restore effect below uses this client-only-on-mount indirection
// instead of calling useLayoutEffect directly.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// Module-level, same reasoning as lib/posts.ts's cachedAllPosts: the
// Following feed is fetched separately (it depends on the viewer's follow
// list, not just post ids), so it needs its own instant-hydrate-then-
// revalidate cache to avoid its own loading flash on remount.
let cachedFollowingPosts: Post[] | null = null;

export default function PinWallHome() {
  const selectedTab = useHomeTab();
  const { user, loading } = useAuth();
  const { posts, loading: postsLoading } = useAllPostsState();
  const savedViewport = useSavedMapViewport();
  // Explore only — Following/Maps below deliberately keep using `posts`
  // (unranked, chronological/bounds-filtered) unchanged.
  const {
    posts: exploreFeedPosts,
    loading: exploreLoading,
    refreshing: exploreRefreshing,
    refresh: refreshExplore,
  } = useExploreFeed(posts, postsLoading);

  // This IS the root of the Home tab's own navigation stack — mounting here
  // means the user has genuinely returned to Explore (as opposed to just
  // switching to another tab, e.g. Map, with a Post Detail still open
  // underneath). Recording "/" here is what keeps BottomNav's remembered
  // Home route from going stale after a real Back navigation — see
  // lib/homeRoute.ts's own doc comment.
  useEffect(() => {
    saveHomeRoute("/");
  }, []);

  function handleSelectTab(tab: string) {
    if (isValidHomeTab(tab)) {
      saveHomeTab(tab);
    }
  }

  const isFollowingTab = selectedTab === "Following";
  const isMapsTab = selectedTab === "Maps";

  const mapsFeedPosts = useMemo(
    () => (savedViewport?.bounds ? filterPostsInBounds(posts, savedViewport.bounds) : []),
    [posts, savedViewport],
  );

  // Following feed: posts authored by users the signed-in viewer follows.
  // Self-follows are impossible (DB-enforced), so the viewer's own posts
  // never appear here without needing a separate exclusion check.
  const { ids: followedUserIds, loading: followedLoading } = useFollowedUserIds();
  const [followingPosts, setFollowingPosts] = useState<Post[]>(() => cachedFollowingPosts ?? []);
  const [followingPostsLoading, setFollowingPostsLoading] = useState(() => cachedFollowingPosts === null);

  useEffect(() => {
    if (!isFollowingTab || followedLoading) return;
    let cancelled = false;

    async function loadFollowingPosts() {
      const result = await getPostsByUserIds(followedUserIds);
      cachedFollowingPosts = result;
      if (!cancelled) {
        setFollowingPosts(result);
        setFollowingPostsLoading(false);
      }
    }

    loadFollowingPosts();

    return () => {
      cancelled = true;
    };
  }, [isFollowingTab, followedUserIds, followedLoading]);

  // Restores this tab's last scroll position before paint, so returning to
  // Home (e.g. Home -> Post Detail -> Map -> Home, or just switching tabs and
  // back) lands where the user left off instead of snapping to the top —
  // reliable without waiting on images, since every card's height is already
  // known synchronously from its media's aspect ratio (see
  // PostCard/DemoPhoto). Saving is done on this same effect's cleanup rather
  // than a live "scroll" event listener: `window` is one global object
  // shared across the whole SPA session, so a listener can still fire (and
  // record a stale reading, often 0) if a scroll event lands in the gap
  // after the destination page starts existing but before React finishes
  // detaching Home's listener — a race that plain event-listener cleanup
  // cannot reliably win. A layout-effect cleanup has no such gap: it runs
  // synchronously, as part of the same commit, while the DOM is still
  // genuinely Home's own — right as this tab is about to be replaced, by a
  // tab switch or by the whole component unmounting for a route change.
  useIsomorphicLayoutEffect(() => {
    window.scrollTo(0, readHomeScrollY(selectedTab));
    return () => {
      saveHomeScrollY(selectedTab, window.scrollY);
    };
  }, [selectedTab]);

  // Following requires a signed-in user. Reuse the same auth state/loading
  // shape RequireAuth uses elsewhere, so this behaves consistently — no
  // redirect, no flash of the wrong content while the session is resolving.
  if (isFollowingTab && loading) {
    return <main className="min-h-screen bg-[#fbfaf7]" />;
  }

  if (isFollowingTab && !user) {
    return <LoginScreen />;
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-28 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <TopBar>
        <CategoryChips selectedTab={selectedTab} onSelectTab={handleSelectTab} />
      </TopBar>

      {selectedTab === "Explore" ? (
        <ExploreRefreshButton onRefresh={refreshExplore} refreshing={exploreRefreshing} />
      ) : null}

      {isFollowingTab ? (
        followedLoading || followingPostsLoading ? (
          <FeedSkeleton />
        ) : followingPosts.length > 0 ? (
          <MasonryFeed posts={followingPosts} homeOriginated />
        ) : (
          <div className="px-6 py-20 text-center">
            <p className="text-sm text-stone-500">Posts from people you follow will appear here.</p>
          </div>
        )
      ) : isMapsTab ? (
        savedViewport?.bounds ? (
          postsLoading ? (
            <FeedSkeleton />
          ) : mapsFeedPosts.length > 0 ? (
            <>
              <div className="flex items-center justify-end px-4 pb-1 pt-3">
                <Link href="/map" className="text-xs font-bold text-kavanaka-aqua">
                  Change area ›
                </Link>
              </div>
              <MasonryFeed posts={mapsFeedPosts} homeOriginated />
              <p className="px-6 pb-10 pt-6 text-center text-xs text-stone-400">
                That&apos;s all the posts in your selected area.
              </p>
            </>
          ) : (
            <div className="mx-4 rounded-3xl border border-dashed border-stone-300 bg-white px-6 py-14 text-center">
              <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-kavanaka-aqua/15 text-2xl">📍</div>
              <h2 className="text-lg font-bold">No posts in this area yet</h2>
              <p className="mt-2 text-sm text-stone-500">Try exploring a different part of the map.</p>
              <Link href="/map" className="mt-5 inline-flex rounded-full bg-stone-900 px-5 py-2.5 text-sm font-bold text-white">
                Explore another area
              </Link>
            </div>
          )
        ) : (
          <div className="mx-4 rounded-3xl border border-dashed border-stone-300 bg-white px-6 py-14 text-center">
            <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-kavanaka-aqua/15 text-2xl">📍</div>
            <h2 className="text-lg font-bold">No area selected</h2>
            <p className="mt-2 text-sm text-stone-500">Choose an area on the Map to explore posts here.</p>
            <Link href="/map" className="mt-5 inline-flex rounded-full bg-stone-900 px-5 py-2.5 text-sm font-bold text-white">
              Open Map
            </Link>
          </div>
        )
      ) : exploreLoading ? (
        <FeedSkeleton />
      ) : (
        <MasonryFeed posts={exploreFeedPosts} homeOriginated />
      )}
    </main>
  );
}
