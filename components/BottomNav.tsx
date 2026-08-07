"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import AddPostActionSheet, { type AddPostChoice } from "./add/AddPostActionSheet";
import DemoPhoto from "./DemoPhoto";
import { useAuth } from "@/lib/auth/AuthProvider";

const navItems = [
  { href: "/", label: "Home" },
  { href: "/map", label: "Map" },
  { href: "/add", label: "Add", icon: "+" },
  { href: "/messages", label: "Messages" },
  { href: "/me", label: "Me" },
];

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  if (pathname === "/search") {
    return null;
  }

  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;
  const displayName = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? undefined;

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
          const isMeItem = item.href === "/me";

          const content = isAddButton ? (
            <span
              aria-hidden="true"
              className="grid size-12 place-items-center rounded-full bg-orange-500 text-2xl text-white shadow-lg shadow-orange-200"
            >
              {item.icon}
            </span>
          ) : isMeItem && user ? (
            <span className="flex flex-col items-center gap-0.5">
              {avatarUrl ? (
                <DemoPhoto src={avatarUrl} alt="" className="size-6 rounded-full" />
              ) : (
                <span className="grid size-6 place-items-center rounded-full bg-stone-200 text-[10px] font-black text-stone-600">
                  {(displayName ?? "?").charAt(0).toUpperCase()}
                </span>
              )}
              <span className="max-w-[3.25rem] truncate text-[10px] font-bold leading-none">
                {displayName ?? "Me"}
              </span>
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
          if (isAddButton && user) {
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
