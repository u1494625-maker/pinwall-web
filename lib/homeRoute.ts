const HOME_ROUTE_KEY = "pinwall_home_route";

/**
 * Remembers the last URL (pathname + search) visited within the Home tab's
 * own navigation stack — the Explore/Following/Maps feed itself ("/"), or an
 * open Post Detail reached from it ("/post/<id>", optionally with
 * "?mediaId=..." for whichever photo was on screen). Read by BottomNav's
 * Home tab so switching away to Map (or any other tab) and back restores
 * exactly where the user left off, the same way a native app's tab bar keeps
 * each tab's own stack independent — same sessionStorage idiom as
 * lib/map/viewport.ts's saved viewport, PinWallHome's saved tab/scroll.
 *
 * PinWallHome's own mount effect keeps overwriting this with "/", and a Post
 * Detail reached via one of Home's own feed tabs (Explore/Following/Maps —
 * see PostCard.tsx's homeOriginated prop) keeps overwriting it with its own
 * URL, so it never goes stale. A Post Detail reached from anywhere else (Me,
 * a profile, Map, Search, a tag) deliberately does NOT write here, so it can
 * never overwrite Home's saved state — see PostDetail.tsx's isHomeOriginated
 * gate.
 */
export function saveHomeRoute(pathAndSearch: string) {
  try {
    window.sessionStorage.setItem(HOME_ROUTE_KEY, pathAndSearch);
  } catch {
    // Ignore storage failures (e.g. private browsing quota) — same as lib/map/viewport.ts.
  }
}

/** Defaults to "/" — both when nothing has been saved yet (fresh session)
 *  and on any storage-read failure, so the Home tab always has a safe target. */
export function readHomeRoute(): string {
  try {
    return window.sessionStorage.getItem(HOME_ROUTE_KEY) || "/";
  } catch {
    return "/";
  }
}
