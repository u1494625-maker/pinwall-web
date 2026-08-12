"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import AddPostActionSheet, { type AddPostChoice } from "./add/AddPostActionSheet";
import { useAuth } from "@/lib/auth/AuthProvider";

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
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const isHydrated = useSyncExternalStore(subscribeNever, getIsHydrated, getIsHydratedServerSnapshot);

  if (
    pathname === "/search" ||
    pathname.startsWith("/post/") ||
    pathname.startsWith("/add") ||
    pathname.startsWith("/profile/")
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

          const content = isAddButton ? (
            <span
              aria-hidden="true"
              className="grid size-12 place-items-center rounded-full bg-orange-500 text-2xl text-white shadow-lg shadow-orange-200"
            >
              {item.icon}
            </span>
          ) : (
            item.label
          );

          const sharedClassName = `flex h-full w-1/5 items-center justify-center text-sm font-bold tracking-tight ${
            isActive ? "text-orange-600" : "text-stone-500"
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

          return (
            <Link
              key={item.href}
              href={item.href}
              // Home restores its own last scroll position (see
              // PinWallHome's useIsomorphicLayoutEffect) — Next's default
              // Link behavior scrolls the destination page's root into view
              // whenever it isn't already visible, which fires in a parent
              // component's componentDidMount after that effect and would
              // silently overwrite it back to the top.
              scroll={item.href === "/" ? false : undefined}
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
