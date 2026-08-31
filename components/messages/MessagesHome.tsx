"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ConversationList from "@/components/messages/ConversationList";
import { useAuth } from "@/lib/auth/AuthProvider";
import { markMessagesOpened, setHasUnseenMessages } from "@/lib/messages";
import { getUnreadNotificationCounts, type UnreadNotificationCounts } from "@/lib/notifications";

function ThumbsUpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-8">
      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-8">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-8">
      <path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

const EMPTY_COUNTS: UnreadNotificationCounts = { likeCount: 0, followCount: 0, commentCount: 0 };

const categories = [
  { countKey: "likeCount", label: "Helpful", href: "/messages/likes", accent: "bg-kavanaka-lime/20 text-kavanaka-green", Icon: ThumbsUpIcon },
  {
    countKey: "followCount",
    label: "New followers",
    href: "/messages/followers",
    accent: "bg-kavanaka-green/15 text-kavanaka-green",
    Icon: PersonIcon,
  },
  { countKey: "commentCount", label: "Comments", href: "/messages/comments", accent: "bg-kavanaka-aqua/15 text-kavanaka-aqua", Icon: ChatIcon },
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
      <div className="grid grid-cols-3 gap-3 px-5 pb-6 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        {categories.map(({ countKey, label, href, accent, Icon }) => {
          const count = counts[countKey];
          return (
            <Link key={countKey} href={href} className="flex flex-col items-center gap-2 text-center">
              <span className={`relative grid size-16 place-items-center rounded-2xl ${accent}`}>
                <Icon />
                {count > 0 ? (
                  <span className="absolute -right-1 -top-1 grid min-w-[18px] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                    {count}
                  </span>
                ) : null}
              </span>
              <span className="text-sm font-bold leading-tight text-stone-600">{label}</span>
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
