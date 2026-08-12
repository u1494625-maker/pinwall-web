"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

/**
 * The bottom nav's Home/Map buttons behave like persistent app tabs, not
 * plain links to "/" / "/map" — each remembers whichever route it was last
 * showing (e.g. Home -> a post -> View on Map -> Map -> tapping Home returns
 * to that post, not "/"). This file is the entire mechanism.
 */
export type AppTab = "home" | "map";

const ACTIVE_TAB_KEY = "pinwall_active_tab";
const TAB_ROUTE_KEY_PREFIX = "pinwall_tab_route_";
const DEFAULT_ROUTE: Record<AppTab, string> = { home: "/", map: "/map" };

function isAppTab(value: string | null): value is AppTab {
  return value === "home" || value === "map";
}

// sessionStorage's own "storage" event only fires in *other* tabs, never the
// tab that made the change — same caveat as PinWallHome's useHomeTab — so a
// small same-tab listener set is what makes our own reads update live.
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function getActiveTab(): AppTab {
  try {
    const raw = window.sessionStorage.getItem(ACTIVE_TAB_KEY);
    return isAppTab(raw) ? raw : "home";
  } catch {
    return "home";
  }
}

function setActiveTab(tab: AppTab) {
  try {
    window.sessionStorage.setItem(ACTIVE_TAB_KEY, tab);
  } catch {
    // Ignore storage failures (e.g. private browsing quota).
  }
  notify();
}

/**
 * Whether a stored route string actually belongs to `tab` under the
 * *current* rules. Guards reads, not just writes: a value written by some
 * earlier version of this logic (or corrupted by any other means) can
 * outlive the code that wrote it, since sessionStorage survives dev-server
 * restarts, HMR, and ordinary reloads — it only clears when the tab itself
 * closes. Without this check, a stale invalid value would keep winning
 * indefinitely instead of self-healing.
 */
function isValidRouteForTab(tab: AppTab, route: string): boolean {
  const pathname = route.split("?")[0];
  if (isSharedRoute(pathname)) return true;
  return tabForPathname(pathname) === tab;
}

function getTabRoute(tab: AppTab): string {
  try {
    const stored = window.sessionStorage.getItem(TAB_ROUTE_KEY_PREFIX + tab);
    if (stored === null) return DEFAULT_ROUTE[tab];
    if (!isValidRouteForTab(tab, stored)) {
      window.sessionStorage.removeItem(TAB_ROUTE_KEY_PREFIX + tab);
      return DEFAULT_ROUTE[tab];
    }
    return stored;
  } catch {
    return DEFAULT_ROUTE[tab];
  }
}

function setTabRoute(tab: AppTab, route: string) {
  try {
    window.sessionStorage.setItem(TAB_ROUTE_KEY_PREFIX + tab, route);
  } catch {
    // Ignore storage failures.
  }
  notify();
}

/** Which tab a pathname unambiguously belongs to, or null if it isn't
 *  tab-defining (either shared, like /post/[id], or neutral, like /me). */
function tabForPathname(pathname: string): AppTab | null {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/map")) return "map";
  return null;
}

/**
 * Routes reachable from *either* tab (currently just Post Detail, opened
 * from a Home card or a Map marker alike) — these inherit whichever tab is
 * already active and update its last route, rather than redefining the
 * active tab. Deliberately narrow: neutral routes like /me, /messages,
 * /search, /saved, and /add must NOT be treated this way, or visiting them
 * would silently overwrite whichever tab is currently active with a route
 * that doesn't belong to either tab's stack at all.
 */
function isSharedRoute(pathname: string): boolean {
  return pathname.startsWith("/post/");
}

/**
 * Always-mounted (rendered regardless of whether BottomNav's own visible
 * <nav> is hidden, e.g. on /post/[id]) — keeps activeTab/tabLastRoute in
 * sync with every real navigation, covering Link clicks, router.push, and
 * browser back/forward alike, since all of them update pathname/searchParams
 * the same way.
 *
 * Depends on useSearchParams (not just usePathname) so that a query-only
 * change on the same pathname — e.g. /map?postId=31 -> /map?postId=40 — is
 * still captured as a distinct route; a pathname-only check would conflate
 * the two. useSearchParams requires its own Suspense boundary in production
 * static builds, so this is a separate component the caller wraps rather
 * than a plain hook call inline.
 */
export function TabRouteTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const search = searchParams.toString();
    const fullRoute = search ? `${pathname}?${search}` : pathname;
    const derivedTab = tabForPathname(pathname);

    if (derivedTab) {
      // Tab-defining route (/ or /map*): this *is* the tab now.
      setActiveTab(derivedTab);
      setTabRoute(derivedTab, fullRoute);
    } else if (isSharedRoute(pathname)) {
      // Shared route (/post/[id]): belongs to whichever tab is already
      // active — never redefines the active tab itself.
      setTabRoute(getActiveTab(), fullRoute);
    }
    // Neutral route (/me, /messages, /search, /saved, /add, ...): not part
    // of either tab's stack — leave activeTab and both last-routes alone.
  }, [pathname, searchParams]);

  return null;
}

/** Reactive read of a tab's last remembered route, for rendering the
 *  Home/Map nav links' hrefs. */
export function useTabHref(tab: AppTab): string {
  return useSyncExternalStore(
    subscribe,
    () => getTabRoute(tab),
    () => DEFAULT_ROUTE[tab],
  );
}
