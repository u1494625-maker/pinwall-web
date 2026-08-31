"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import DemoPhoto from "@/components/DemoPhoto";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getConversations, type Conversation } from "@/lib/messages";
import { formatRelativeDate } from "@/lib/postDisplay";
import { SYSTEM_CONVERSATION_ID } from "@/lib/systemMessages";

function ChatBubbleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-6">
      <path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

function ConversationRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <div className="size-14 shrink-0 animate-pulse rounded-full bg-stone-200" />
      <div className="h-3.5 flex-1 animate-pulse rounded bg-stone-200" />
    </div>
  );
}

/** Real 1-to-1 conversation list, newest activity first — mounted below the
 *  Phase 2 notification tiles on the Messages home. Each row's own unread
 *  count comes straight from get_conversations(); this list never marks
 *  anything read itself — opening a conversation (ConversationScreen) is
 *  the only thing that does that. */
export default function ConversationList() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    getConversations().then((result) => {
      if (!cancelled) {
        setConversations(result);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading) {
    return (
      <div>
        {[0, 1, 2].map((key) => (
          <ConversationRowSkeleton key={key} />
        ))}
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="px-6 py-14 text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-kavanaka-aqua/15 text-kavanaka-aqua">
          <ChatBubbleIcon />
        </div>
        <h2 className="text-base font-bold text-stone-900">No messages yet</h2>
        <p className="mt-1.5 text-sm text-stone-500">
          Start a conversation from someone&apos;s profile, or explore posts to find people to talk to.
        </p>
        <Link href="/" className="mt-5 inline-flex rounded-full bg-stone-900 px-5 py-2.5 text-sm font-bold text-white">
          Explore
        </Link>
      </div>
    );
  }

  return (
    <div>
      {conversations.map((conversation) => {
        const isSystem = conversation.id === SYSTEM_CONVERSATION_ID;
        const href = isSystem ? "/messages/system" : `/messages/${conversation.id}`;

        return (
          <Link key={conversation.id} href={href} className="flex items-center gap-3 px-4 py-3.5">
            {isSystem ? (
              <DemoPhoto src="/system-message-avatar.png" alt="System Message" className="size-14 shrink-0 rounded-full" />
            ) : conversation.otherAvatarUrl ? (
              <DemoPhoto src={conversation.otherAvatarUrl} alt="" className="size-14 shrink-0 rounded-full" />
            ) : (
              <span className="grid size-14 shrink-0 place-items-center rounded-full bg-stone-200 text-lg font-black text-stone-600">
                {conversation.otherDisplayName.charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="truncate text-[15px] font-bold text-stone-900">{conversation.otherDisplayName}</h2>
              <time className="shrink-0 text-[11px] font-medium text-stone-400">
                {formatRelativeDate(conversation.lastMessageAt)}
              </time>
            </div>
            <div className="mt-1 flex items-start justify-between gap-3">
              <p className="min-w-0 flex-1 truncate text-[13px] text-stone-500">{conversation.lastMessageBody}</p>
              {conversation.unreadCount > 0 ? (
                <span className="grid min-w-[20px] shrink-0 place-items-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
                </span>
              ) : null}
            </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
