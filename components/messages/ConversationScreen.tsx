"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import DemoPhoto from "@/components/DemoPhoto";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  getConversationParticipants,
  getMessages,
  markConversationRead,
  MAX_MESSAGE_LENGTH,
  sendMessage,
  setCurrentlyOpenConversationId,
  subscribeToConversationMessages,
  type DirectMessage,
} from "@/lib/messages";
import { formatRelativeDate } from "@/lib/postDisplay";
import { FALLBACK_DISPLAY_NAME, getProfile, type Profile } from "@/lib/profiles";

type ConversationScreenProps = {
  conversationId: number;
};

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

export default function ConversationScreen({ conversationId }: ConversationScreenProps) {
  const router = useRouter();
  const { user } = useAuth();

  const [otherProfile, setOtherProfile] = useState<Profile | undefined>(undefined);
  const [headerLoading, setHeaderLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);

  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const scrollEndRef = useRef<HTMLDivElement>(null);
  // Guards against the same message appearing twice when a locally-sent
  // message's own insert result and its Realtime echo both arrive — whichever
  // of the two reaches this component second is dropped, regardless of which
  // one wins that race.
  const knownMessageIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!user) return;
    const myId = user.id;
    let cancelled = false;

    async function load() {
      // An invalid route param (e.g. /messages/not-a-number) is treated the
      // same as a real id that doesn't resolve to anything — never sent to
      // Supabase, which would otherwise error on the malformed value rather
      // than cleanly returning "no rows".
      if (!Number.isFinite(conversationId)) {
        setNotFound(true);
        setHeaderLoading(false);
        setMessagesLoading(false);
        return;
      }

      const participants = await getConversationParticipants(conversationId);
      if (cancelled) return;

      if (!participants) {
        setNotFound(true);
        setHeaderLoading(false);
        setMessagesLoading(false);
        return;
      }

      const otherUserId = participants.userAId === myId ? participants.userBId : participants.userAId;
      // Entering the conversation immediately marks everything existing as
      // read — no scroll-to-bottom requirement — fired alongside the other
      // two fetches rather than after them, since it doesn't affect what's
      // rendered.
      const [profile, history] = await Promise.all([
        getProfile(otherUserId),
        getMessages(conversationId),
        markConversationRead(conversationId),
      ]);
      if (cancelled) return;

      setOtherProfile(profile);
      setHeaderLoading(false);
      history.forEach((message) => knownMessageIdsRef.current.add(message.id));
      setMessages(history);
      setMessagesLoading(false);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [user, conversationId]);

  // Lets BottomNav's own global realtime handler know not to light the dot
  // for a message in exactly this conversation — it's already being shown
  // and marked read live below, right on this screen.
  useEffect(() => {
    setCurrentlyOpenConversationId(conversationId);
    return () => setCurrentlyOpenConversationId(null);
  }, [conversationId]);

  useEffect(() => {
    const unsubscribe = subscribeToConversationMessages(conversationId, (message) => {
      if (knownMessageIdsRef.current.has(message.id)) return;
      knownMessageIdsRef.current.add(message.id);
      setMessages((prev) => [...prev, message]);
      // A message arriving from the other participant while this exact
      // conversation is open is treated as read immediately — never left to
      // accumulate as unread just because it arrived after the initial load.
      if (user && message.senderUserId !== user.id) {
        markConversationRead(conversationId);
      }
    });

    return unsubscribe;
  }, [conversationId, user]);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const trimmedDraft = draft.trim();

  async function handleSend() {
    if (!user || trimmedDraft.length === 0 || isSending) return;

    setIsSending(true);
    setSendError(null);
    try {
      const sent = await sendMessage(conversationId, user.id, trimmedDraft);
      if (!knownMessageIdsRef.current.has(sent.id)) {
        knownMessageIdsRef.current.add(sent.id);
        setMessages((prev) => [...prev, sent]);
      }
      setDraft("");
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Couldn't send that message. Try again.");
    } finally {
      setIsSending(false);
    }
  }

  if (notFound) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center bg-[#fbfaf7] px-8 text-center">
        <h1 className="text-lg font-black text-stone-900">Conversation not found</h1>
        <p className="mt-2 text-sm text-stone-500">It may not exist, or you may not have access to it.</p>
        <Link href="/messages" className="mt-5 inline-flex rounded-full bg-stone-900 px-5 py-2.5 text-sm font-bold text-white">
          Back to Messages
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-[#fbfaf7] shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-stone-100 bg-[#fbfaf7]/95 px-4 py-3 backdrop-blur">
        <BackButton onBack={() => router.back()} />
        {headerLoading ? (
          <div className="h-8 w-32 animate-pulse rounded bg-stone-200" />
        ) : otherProfile ? (
          <Link href={`/profile/${otherProfile.id}`} className="flex min-w-0 flex-1 items-center gap-2.5">
            {otherProfile.avatarUrl ? (
              <DemoPhoto src={otherProfile.avatarUrl} alt="" className="size-9 shrink-0 rounded-full" />
            ) : (
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-stone-200 text-sm font-black text-stone-600">
                {(otherProfile.displayName ?? FALLBACK_DISPLAY_NAME).charAt(0).toUpperCase()}
              </span>
            )}
            <span className="truncate text-sm font-black text-stone-900">
              {otherProfile.displayName ?? FALLBACK_DISPLAY_NAME}
            </span>
          </Link>
        ) : (
          <span className="text-sm font-black text-stone-900">{FALLBACK_DISPLAY_NAME}</span>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 pb-28">
        {messagesLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((key) => (
              <div key={key} className="h-8 w-2/3 animate-pulse rounded-2xl bg-stone-200" />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <p className="py-16 text-center text-sm text-stone-400">No messages yet.</p>
        ) : (
          messages.map((message) => {
            const isMine = message.senderUserId === user?.id;
            return (
              <div key={message.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                <div className="max-w-[75%]">
                  <div
                    className={`rounded-2xl px-3.5 py-2 text-sm ${
                      isMine ? "bg-kavanaka-lime text-kavanaka-ink" : "bg-white text-stone-900 shadow-sm"
                    }`}
                  >
                    {message.body}
                  </div>
                  <p className={`mt-1 text-[10px] text-stone-400 ${isMine ? "text-right" : "text-left"}`}>
                    {formatRelativeDate(message.createdAt)}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={scrollEndRef} />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-md border-t border-stone-100 bg-[#fbfaf7]/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur">
        {sendError ? <p className="mb-2 text-center text-xs font-semibold text-red-600">{sendError}</p> : null}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, MAX_MESSAGE_LENGTH))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
            placeholder="Message…"
            rows={1}
            maxLength={MAX_MESSAGE_LENGTH}
            aria-label="Message"
            className="max-h-28 flex-1 resize-none rounded-2xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-900 outline-none placeholder:text-stone-400"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={trimmedDraft.length === 0 || isSending}
            className="shrink-0 rounded-full bg-kavanaka-lime px-4 py-2.5 text-sm font-bold text-kavanaka-ink disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </main>
  );
}
