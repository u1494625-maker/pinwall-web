"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ConversationList from "@/components/messages/ConversationList";
import { useAuth } from "@/lib/auth/AuthProvider";
import { markMessagesOpened, setHasUnseenMessages } from "@/lib/messages";
import { getUnreadNotificationCounts, type UnreadNotificationCounts } from "@/lib/notifications";

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="size-5">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function ComposeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
      <path d="M12 21s-6.7-4.35-9.3-8.1C1 10.1 1.6 6.6 4.6 5.2c2.2-1 4.6-.2 5.9 1.6l1.5 2 1.5-2c1.3-1.8 3.7-2.6 5.9-1.6 3 1.4 3.6 4.9 1.9 7.7C18.7 16.65 12 21 12 21Z" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
      <path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

const EMPTY_COUNTS: UnreadNotificationCounts = { likeCount: 0, followCount: 0, commentCount: 0 };

const categories = [
  { countKey: "likeCount", label: "Helpful", href: "/messages/likes", accent: "bg-rose-100 text-rose-500", Icon: HeartIcon },
  {
    countKey: "followCount",
    label: "New followers",
    href: "/messages/followers",
    accent: "bg-blue-100 text-blue-500",
    Icon: PersonIcon,
  },
  { countKey: "commentCount", label: "Comments", href: "/messages/comments", accent: "bg-emerald-100 text-emerald-500", Icon: ChatIcon },
] as const;

export default function MessagesHome() {
  const { user } = useAuth();
  const [counts, setCounts] = useState<UnreadNotificationCounts>(EMPTY_COUNTS);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    getUnreadNotificationCounts().then((result) => {
      if (!cancelled) setCounts(result);
    });

    return () => {
      cancelled = true;
    };
  }, [user]);

  // Entering /messages clears only the global dot signal — never marks any
  // individual conversation's messages as read. Updates the shared store
  // immediately (so BottomNav's dot disappears without waiting on a fresh
  // round trip) alongside the real server-side write.
  useEffect(() => {
    if (!user) return;
    markMessagesOpened();
    setHasUnseenMessages(false);
  }, [user]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-28 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <header className="relative px-5 pb-1 pt-8 text-center">
        <h1 className="text-2xl font-black tracking-tight text-stone-900">Messages</h1>
        <div className="absolute right-5 top-8 flex items-center gap-1 text-stone-500">
          <Link
            href="/search"
            aria-label="Search"
            className="grid size-9 place-items-center rounded-full transition-colors hover:bg-stone-100"
          >
            <SearchIcon />
          </Link>
          <Link
            href="/messages/new"
            aria-label="New message"
            className="grid size-9 place-items-center rounded-full transition-colors hover:bg-stone-100"
          >
            <ComposeIcon />
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-3 px-5 pb-6 pt-5">
        {categories.map(({ countKey, label, href, accent, Icon }) => {
          const count = counts[countKey];
          return (
            <Link key={countKey} href={href} className="flex flex-col items-center gap-2 text-center">
              <span className={`relative grid size-12 place-items-center rounded-2xl ${accent}`}>
                <Icon />
                {count > 0 ? (
                  <span className="absolute -right-1 -top-1 grid min-w-[18px] place-items-center rounded-full bg-orange-500 px-1 text-[10px] font-bold text-white">
                    {count}
                  </span>
                ) : null}
              </span>
              <span className="text-[11px] font-semibold leading-tight text-stone-600">{label}</span>
            </Link>
          );
        })}
      </div>

      <div className="border-t border-stone-100">
        <h2 className="px-5 pb-2 pt-5 text-sm font-black text-stone-900">Messages</h2>
        <ConversationList />
      </div>
    </main>
  );
}
