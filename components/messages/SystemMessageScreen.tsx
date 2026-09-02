"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import DemoPhoto from "@/components/DemoPhoto";
import { setCurrentlyOpenConversationId } from "@/lib/messages";
import { formatRelativeDate } from "@/lib/postDisplay";
import {
  getSystemMessages,
  markSystemMessagesRead,
  subscribeToSystemMessages,
  SYSTEM_CONVERSATION_ID,
  type SystemMessage,
} from "@/lib/systemMessages";
import { useAuth } from "@/lib/auth/AuthProvider";

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      aria-label="Go back"
      className="grid size-9 shrink-0 place-items-center rounded-full text-2xl leading-none text-stone-700"
    >
      ‹
    </button>
  );
}

/**
 * The System Message thread — a fixed, non-human conversation surfacing
 * moderation-triggered notices (see remove_reported_content in
 * supabase/system_messages.sql). Deliberately independent of
 * ConversationScreen rather than a shared refactor: there's no participant
 * to fetch, no sender/recipient distinction (every message is always
 * "incoming"), and critically, no composer at all — a small, separate
 * component keeps the working human-DM screen completely untouched.
 */
export default function SystemMessageScreen() {
  const router = useRouter();
  const { user } = useAuth();
  // Stable primitive so a same-user TOKEN_REFRESHED doesn't reload the
  // thread or rebuild its realtime subscription — see both effects below.
  const userId = user?.id ?? null;

  const [messages, setMessages] = useState<SystemMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const scrollEndRef = useRef<HTMLDivElement>(null);
  // Same dedup purpose as ConversationScreen's own ref: guards against a
  // message that arrives both in the initial history load and, moments
  // later, via the Realtime echo of that same insert.
  const knownMessageIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    // Entering this screen immediately marks the whole thread read — no
    // scroll-to-bottom requirement — exactly parallel to ConversationScreen
    // marking a human conversation read on open.
    Promise.all([getSystemMessages(), markSystemMessagesRead()]).then(([history]) => {
      if (cancelled) return;
      history.forEach((message) => knownMessageIdsRef.current.add(message.id));
      setMessages(history);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Lets BottomNav's system-message subscription know not to light the dot
  // while this thread is the one on screen — same sentinel/mechanism
  // ConversationScreen already uses for a human conversation id.
  useEffect(() => {
    setCurrentlyOpenConversationId(SYSTEM_CONVERSATION_ID);
    return () => setCurrentlyOpenConversationId(null);
  }, []);

  useEffect(() => {
    if (!userId) return;

    if (process.env.NODE_ENV !== "production") {
      console.log(`[RT] SystemMessageScreen subscribe user=${userId}`);
    }

    const unsubscribe = subscribeToSystemMessages(userId, (message) => {
      if (knownMessageIdsRef.current.has(message.id)) return;
      knownMessageIdsRef.current.add(message.id);
      setMessages((prev) => [...prev, message]);
      markSystemMessagesRead();
    });

    return () => {
      if (process.env.NODE_ENV !== "production") {
        console.log(`[RT] SystemMessageScreen cleanup user=${userId}`);
      }
      unsubscribe();
    };
  }, [userId]);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-[#fbfaf7] shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-stone-100 bg-[#fbfaf7]/95 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] backdrop-blur">
        <BackButton onBack={() => router.back()} />
        <DemoPhoto src="/system-message-avatar.png" alt="System Message" className="size-9 shrink-0 rounded-full" />
        <span className="truncate text-sm font-black text-stone-900">System Message</span>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((key) => (
              <div key={key} className="h-8 w-2/3 animate-pulse rounded-2xl bg-stone-200" />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <p className="py-16 text-center text-sm text-stone-400">No messages yet.</p>
        ) : (
          messages.map((message) => (
            <div key={message.id} className="flex justify-start">
              <div className="max-w-[80%]">
                <div className="whitespace-pre-line rounded-2xl bg-white px-3.5 py-2 text-sm text-stone-900 shadow-sm">
                  {message.body}
                </div>
                <p className="mt-1 text-left text-[10px] text-stone-400">{formatRelativeDate(message.createdAt)}</p>
              </div>
            </div>
          ))
        )}
        <div ref={scrollEndRef} />
      </div>
    </main>
  );
}
