"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import AddPostActionSheet, { type AddPostChoice } from "./add/AddPostActionSheet";
import { useAuth } from "@/lib/auth/AuthProvider";
import { readHomeRoute } from "@/lib/homeRoute";
import {
  getCurrentlyOpenConversationId,
  hasNewMessagesSinceLastOpen,
  setHasUnseenMessages,
  subscribeToIncomingMessages,
  useHasUnseenMessages,
} from "@/lib/messages";
import {
  getUnreadNotificationCounts,
  setUnseenNotificationCategoriesFromCounts,
  setUnseenNotificationCategory,
  subscribeToIncomingNotifications,
  useHasUnseenNotifications,
} from "@/lib/notifications";
import { subscribeToIncomingSystemMessages, SYSTEM_CONVERSATION_ID } from "@/lib/systemMessages";

const navItems = [
  { href: "/", label: "Home" },
  { href: "/map", label: "Map" },
  { href: "/add", label: "Add", icon: "+" },
  { href: "/messages", label: "Messages" },
  { href: "/me", label: "Me" },
];

// AuthProvider's `user` starts identical on server and client (always null), but
// Supabase's session restore resolves in an effect shortly after mount — if
// BottomNav's own first render ever happened later than that (confirmed to occur
// when this was Suspense-wrapped; verified via a real reproduced hydration error),
// it would read an already-updated `user` while the frozen server HTML still shows
// the pre-restore value. Gating on this hydration flag — always false on both the
// server and BottomNav's own first render, no matter when that render happens —
// makes the two guaranteed to match regardless; only a later, ordinary re-render
// (never a hydration comparison) reveals the button. Kept as a standing safeguard
// even without the Suspense wrapper. Never gets a subscribe callback: it only ever
// needs to flip once, from the fixed server value to "we're running on the client".
function subscribeNever() {
  return () => {};
}
function getIsHydrated() {
  return true;
}
function getIsHydratedServerSnapshot() {
  return false;
}

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  // Stable primitive so a same-user TOKEN_REFRESHED (which gives `user` a new
  // object reference without changing who's signed in) doesn't retrigger the
  // subscription effect below — see the effect's own comment.
  const userId = user?.id ?? null;
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const isHydrated = useSyncExternalStore(subscribeNever, getIsHydrated, getIsHydratedServerSnapshot);
  const hasUnseenMessages = useHasUnseenMessages();
  const hasUnseenNotifications = useHasUnseenNotifications();

  // Set only by the Home button's onClick below, in the one case a plain
  // replace can't handle: restoring a Post Detail that was reached from Map
  // via "View Map" (a real push). The entry directly below Map is already
  // that exact Post Detail — but missing whatever photo was selected, since
  // that only ever lived in React state, never the URL, and a fresh remount
  // loses it. A `replace()` can only ever rewrite the CURRENT top entry, so
  // reaching that lower entry's content requires first popping Map off with
  // a real `back()`, then, once we've actually landed on it (detected here
  // by pathname), `replace()`-ing it with the exact remembered URL. Doing
  // only a replace (no back) leaves the original, mediaId-less Post Detail
  // entry sitting between the restored one and Explore — back would need
  // two presses to reach Explore instead of one. Doing only a back (no
  // replace) reaches the right post, but on whichever photo it originally
  // opened on, not the one the user had actually selected.
  const pendingHomeReplaceRef = useRef<{ target: string; expiresAt: number } | null>(null);

  useEffect(() => {
    const pending = pendingHomeReplaceRef.current;
    if (!pending) return;
    if (Date.now() > pending.expiresAt) {
      pendingHomeReplaceRef.current = null;
      return;
    }
    const targetBasePath = pending.target.split("?")[0];
    if (pathname === targetBasePath) {
      pendingHomeReplaceRef.current = null;
      router.replace(pending.target, { scroll: false });
    }
  }, [pathname, router]);

  // Deliberately runs before the pathname-based early return below (hooks
  // must always run in the same order) — this component stays mounted on
  // every route even when it renders null, which is exactly what's needed
  // here: a message in a different conversation must still light the dot
  // while the user is inside /messages/[conversationId] itself, where
  // BottomNav is hidden. One-time fetch for the initial state, then three
  // long-lived Realtime subscriptions (human DMs, system messages,
  // notifications) — no polling. hasNewMessagesSinceLastOpen() already
  // accounts for both DM/System sources against the same
  // message_inbox_state.last_opened_at (see supabase/system_messages.sql);
  // getUnreadNotificationCounts() is the separate, independent initial value
  // for the Likes/Followers/Comments portion of the dot (see
  // lib/notifications.ts — a deliberately separate store, never merged into
  // hasUnseenMessages, so clearing one can never clobber the other).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    if (process.env.NODE_ENV !== "production") {
      console.log(`[RT] BottomNav subscribe user=${userId}`);
    }

    hasNewMessagesSinceLastOpen().then((result) => {
      if (!cancelled) setHasUnseenMessages(result);
    });

    getUnreadNotificationCounts().then((counts) => {
      if (!cancelled) setUnseenNotificationCategoriesFromCounts(counts);
    });

    const unsubscribeMessages = subscribeToIncomingMessages((message) => {
      if (message.senderUserId === userId) return;
      // The exact conversation currently on screen is already being shown
      // and marked read live by ConversationScreen — don't also light the
      // dot for it.
      if (message.conversationId === getCurrentlyOpenConversationId()) return;
      setHasUnseenMessages(true);
    });

    const unsubscribeSystemMessages = subscribeToIncomingSystemMessages(userId, () => {
      // Every event this subscription delivers is, by construction, a
      // message addressed to this user — no sender to exclude, unlike the
      // human-DM case above. Same suppression sentinel as ConversationScreen
      // uses, just for the System Message thread's reserved id.
      if (getCurrentlyOpenConversationId() === SYSTEM_CONVERSATION_ID) return;
      setHasUnseenMessages(true);
    });

    // One subscription, not three — the single handler branches on the
    // inserted row's own type. No self-exclusion needed here: the database
    // never creates a notification where the actor is also the recipient.
    const unsubscribeNotifications = subscribeToIncomingNotifications(userId, (notification) => {
      setUnseenNotificationCategory(notification.type, true);
    });

    return () => {
      cancelled = true;
      if (process.env.NODE_ENV !== "production") {
        console.log(`[RT] BottomNav cleanup user=${userId}`);
      }
      unsubscribeMessages();
      unsubscribeSystemMessages();
      unsubscribeNotifications();
    };
  }, [userId]);

  if (
    pathname === "/search" ||
    pathname.startsWith("/post/") ||
    pathname.startsWith("/add") ||
    pathname.startsWith("/profile/") ||
    pathname.startsWith("/me/edit") ||
    pathname.startsWith("/messages/") ||
    pathname.startsWith("/admin")
  ) {
    return null;
  }

  function handleChoose(choice: AddPostChoice) {
    setIsSheetOpen(false);
    if (choice === "album") router.push("/add/media?source=album");
    else if (choice === "camera") router.push("/add/media?source=camera");
    else router.push("/add/text");
  }

  return (
    <>
      <nav
        aria-label="Main navigation"
        className="fixed inset-x-0 bottom-0 z-30 mx-auto flex h-20 w-full max-w-md items-center border-t border-stone-200 bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_rgba(50,40,30,0.08)] backdrop-blur"
      >
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const isAddButton = item.href === "/add";
          const isMessagesButton = item.href === "/messages";
          const isHomeButton = item.href === "/";

          const content = isAddButton ? (
            <span
              aria-hidden="true"
              className="grid size-13 place-items-center rounded-full bg-kavanaka-lime text-2xl text-kavanaka-ink shadow-md shadow-kavanaka-lime/40"
            >
              {item.icon}
            </span>
          ) : isMessagesButton ? (
            // No isHydrated gate needed here (unlike the Add button below) —
            // hasUnseenMessages starts false on both the server and the
            // first client render (useSyncExternalStore's server snapshot),
            // so there's no hydration mismatch to guard against; it only
            // ever flips true later, from a real client-side effect.
            <span className="relative inline-block">
              {item.label}
              {hasUnseenMessages || hasUnseenNotifications ? (
                <span aria-hidden="true" className="absolute -right-2 -top-0.5 size-2 rounded-full bg-red-500" />
              ) : null}
            </span>
          ) : (
            item.label
          );

          const sharedClassName = `flex h-full w-1/5 items-center justify-center text-sm font-bold tracking-tight ${
            isActive ? "text-kavanaka-green" : "text-stone-500"
          }`;

          // Logged in: the "+" opens the creation sheet instead of navigating.
          // Logged out: it stays a plain link to /add, whose own RequireAuth
          // already shows LoginScreen — same behavior as before this change.
          // isHydrated is required here, not just `user` — see the comment above.
          if (isAddButton && isHydrated && user) {
            return (
              <button
                key={item.href}
                type="button"
                aria-label="Add"
                onClick={() => setIsSheetOpen(true)}
                className={sharedClassName}
              >
                {content}
              </button>
            );
          }

          // Home is a button, not a plain Link — it must land on whichever
          // URL is currently remembered as "the Home tab's own state" (see
          // lib/homeRoute.ts), not unconditionally "/", and it must REPLACE
          // the current history entry rather than push a new one. Replacing
          // is what makes switching tabs behave like a native app: it
          // collapses whatever tab you're leaving (e.g. Map) out of the back
          // stack instead of stacking on top of it, so a restored Post
          // Detail's own Back button goes straight to the Explore feed
          // underneath it, not back through Map. scroll:false for the same
          // reason the old Link below it needed one — Next's default
          // navigate-time scroll would otherwise fight PinWallHome's own
          // synchronous scroll-restore effect when landing back on "/".
          //
          // From Map specifically, a plain replace isn't enough: the entry
          // directly below Map is already the right Post Detail (pushed by
          // "View Map"), so replacing Map alone would leave that original,
          // mediaId-less entry sitting between the restored page and Explore
          // — Back would need two presses to reach Explore instead of one.
          // back() first (popping Map, landing on that real entry), then a
          // deferred replace once we've actually arrived (see the effect
          // above), reaches the exact same end state in one press.
          if (isHomeButton) {
            return (
              <button
                key={item.href}
                type="button"
                aria-label="Home"
                aria-current={isActive ? "page" : undefined}
                onClick={() => {
                  const target = readHomeRoute();
                  if (pathname === "/map" && target.startsWith("/post/")) {
                    pendingHomeReplaceRef.current = { target, expiresAt: Date.now() + 3000 };
                    router.back();
                    return;
                  }
                  router.replace(target, { scroll: false });
                }}
                className={sharedClassName}
              >
                {content}
              </button>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={isAddButton ? "Add" : undefined}
              aria-current={isActive ? "page" : undefined}
              className={sharedClassName}
            >
              {content}
            </Link>
          );
        })}
      </nav>

      <AddPostActionSheet open={isSheetOpen} onClose={() => setIsSheetOpen(false)} onChoose={handleChoose} />
    </>
  );
}
