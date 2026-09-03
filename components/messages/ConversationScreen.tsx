"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import DemoPhoto from "@/components/DemoPhoto";
import MessageImageFullscreen from "@/components/messages/MessageImageFullscreen";
import { useAuth } from "@/lib/auth/AuthProvider";
import { convertHeicToJpeg, isHeicFile } from "@/lib/heic";
import { MAX_IMAGE_SOURCE_BYTES, prepareImageForUpload } from "@/lib/imageOptimization";
import {
  getConversationParticipants,
  getMessages,
  markConversationRead,
  MAX_MESSAGE_LENGTH,
  sendImageMessage,
  sendTextMessage,
  setCurrentlyOpenConversationId,
  SIGNED_URL_EXPIRES_IN_SECONDS,
  subscribeToConversationMessages,
  type DirectMessage,
} from "@/lib/messages";
import { formatRelativeDate } from "@/lib/postDisplay";
import { FALLBACK_DISPLAY_NAME, getProfile, type Profile } from "@/lib/profiles";
import {
  ALLOWED_IMAGE_TYPES,
  deleteMessageImage,
  getMessageImageSignedUrl,
  getMessageImageSignedUrls,
  uploadMessageImage,
} from "@/lib/storage";

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

/**
 * One image bubble's three states: still signing (pulsing placeholder),
 * signed and shown, or signing attempted-and-failed ("Photo unavailable" —
 * the message row itself always exists regardless, see lib/messages.ts).
 * A plain <img>, not DemoPhoto: a chat bubble needs to size itself from the
 * image's own natural aspect ratio (capped, never distorted, never
 * cropped-to-square), which DemoPhoto's CSS background-image approach can't
 * do without a pre-known aspect ratio the way this component's fixed-box
 * callers (avatar, pending-image thumbnail) have.
 */
function MessageImageBubble({
  signedUrl,
  attempted,
  onOpen,
}: {
  signedUrl: string | undefined;
  attempted: boolean;
  onOpen: (url: string) => void;
}) {
  if (signedUrl) {
    return (
      <button type="button" onClick={() => onOpen(signedUrl)} aria-label="Open photo" className="block overflow-hidden rounded-2xl">
        {/* eslint-disable-next-line @next/next/no-img-element -- signed URL, natural-aspect chat bubble; see doc comment above */}
        <img src={signedUrl} alt="" className="max-h-72 w-auto max-w-[240px] rounded-2xl object-cover" />
      </button>
    );
  }

  if (attempted) {
    return (
      <div className="grid h-32 w-40 place-items-center rounded-2xl bg-stone-100 text-center text-[11px] font-semibold text-stone-400">
        Photo unavailable
      </div>
    );
  }

  return <div className="h-32 w-40 animate-pulse rounded-2xl bg-stone-200" />;
}

export default function ConversationScreen({ conversationId }: ConversationScreenProps) {
  const router = useRouter();
  const { user } = useAuth();
  // Stable primitive so a same-user TOKEN_REFRESHED doesn't reload the
  // conversation or rebuild its realtime subscription — see both effects
  // below that key on this instead of the raw `user` object.
  const userId = user?.id ?? null;

  const [otherProfile, setOtherProfile] = useState<Profile | undefined>(undefined);
  const [headerLoading, setHeaderLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);

  const [draft, setDraft] = useState("");
  const [pendingImage, setPendingImage] = useState<{ file: File; previewUrl: string } | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Keyed by imagePath (the DB-stored Storage path), never persisted — see
  // getMessageImageSignedUrl(s) in lib/storage.ts. `signedUrlAttempted`
  // tracks "we tried," independent of success, so a failed sign renders
  // "Photo unavailable" instead of an endless loading placeholder.
  const [signedImageUrls, setSignedImageUrls] = useState<Map<string, string>>(new Map());
  const [signedUrlAttempted, setSignedUrlAttempted] = useState<Set<string>>(new Set());
  const [fullscreenImageUrl, setFullscreenImageUrl] = useState<string | null>(null);

  const scrollEndRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  // Guards against the same message appearing twice when a locally-sent
  // message's own insert result and its Realtime echo both arrive — whichever
  // of the two reaches this component second is dropped, regardless of which
  // one wins that race.
  const knownMessageIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!userId) return;
    const myId = userId;
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

      // Signing is decoupled from the render above — text messages (the
      // common case) never wait on it, and one slow or failed signed URL can
      // never hold up the rest of the conversation from appearing.
      const imagePaths = history.map((message) => message.imagePath).filter((path): path is string => path !== null);
      if (imagePaths.length > 0) {
        const signed = await getMessageImageSignedUrls(imagePaths, SIGNED_URL_EXPIRES_IN_SECONDS);
        if (cancelled) return;
        setSignedImageUrls((prev) => new Map([...prev, ...signed]));
        setSignedUrlAttempted((prev) => new Set([...prev, ...imagePaths]));
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [userId, conversationId]);

  // Lets BottomNav's own global realtime handler know not to light the dot
  // for a message in exactly this conversation — it's already being shown
  // and marked read live below, right on this screen.
  useEffect(() => {
    setCurrentlyOpenConversationId(conversationId);
    return () => setCurrentlyOpenConversationId(null);
  }, [conversationId]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[RT] ConversationScreen subscribe user=${userId} conversation=${conversationId}`);
    }

    const unsubscribe = subscribeToConversationMessages(conversationId, (message) => {
      if (knownMessageIdsRef.current.has(message.id)) return;
      knownMessageIdsRef.current.add(message.id);
      setMessages((prev) => [...prev, message]);

      if (message.imagePath) {
        const imagePath = message.imagePath;
        getMessageImageSignedUrl(imagePath, SIGNED_URL_EXPIRES_IN_SECONDS).then((signedUrl) => {
          setSignedUrlAttempted((prev) => new Set(prev).add(imagePath));
          if (signedUrl) {
            setSignedImageUrls((prev) => new Map(prev).set(imagePath, signedUrl));
          }
        });
      }

      // A message arriving from the other participant while this exact
      // conversation is open is treated as read immediately — never left to
      // accumulate as unread just because it arrived after the initial load.
      if (userId && message.senderUserId !== userId) {
        markConversationRead(conversationId);
      }
    });

    return () => {
      if (process.env.NODE_ENV !== "production") {
        console.log(`[RT] ConversationScreen cleanup user=${userId} conversation=${conversationId}`);
      }
      unsubscribe();
    };
  }, [conversationId, userId]);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const trimmedDraft = draft.trim();

  function handleImageSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset immediately so picking the exact same file again still fires
    // onChange — same convention as MediaComposerFields' own file inputs.
    event.target.value = "";
    if (!file) return;

    const isAllowedType = isHeicFile(file) || ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number]);
    if (!isAllowedType) {
      setSendError("That file type isn't supported. Choose a JPEG, PNG, WebP, AVIF, or HEIC photo.");
      return;
    }
    if (file.size > MAX_IMAGE_SOURCE_BYTES) {
      setSendError("That photo is too large. Choose a smaller one.");
      return;
    }

    setSendError(null);
    setPendingImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return { file, previewUrl: URL.createObjectURL(file) };
    });
  }

  function cancelPendingImage() {
    setPendingImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
    setSendError(null);
  }

  async function handleSendImage(senderUserId: string, image: { file: File; previewUrl: string }) {
    setIsSending(true);
    setSendError(null);
    let uploadedPath: string | null = null;
    try {
      const wasHeic = isHeicFile(image.file);
      const converted = wasHeic ? await convertHeicToJpeg(image.file) : image.file;
      const { file: optimized } = await prepareImageForUpload(converted, wasHeic);

      const { path } = await uploadMessageImage(optimized, senderUserId, conversationId);
      uploadedPath = path;

      const sent = await sendImageMessage(conversationId, senderUserId, path);
      if (!knownMessageIdsRef.current.has(sent.id)) {
        knownMessageIdsRef.current.add(sent.id);
        setMessages((prev) => [...prev, sent]);
      }

      const signedUrl = await getMessageImageSignedUrl(path, SIGNED_URL_EXPIRES_IN_SECONDS);
      setSignedUrlAttempted((prev) => new Set(prev).add(path));
      if (signedUrl) {
        setSignedImageUrls((prev) => new Map(prev).set(path, signedUrl));
      }

      URL.revokeObjectURL(image.previewUrl);
      setPendingImage(null);
    } catch (err) {
      // The insert failed after a successful upload — the object is now
      // orphaned; best-effort clean it up. Whether or not that succeeds, the
      // original send error below is what actually gets shown, and the
      // pending image is kept (not cleared) so the user can just retry.
      if (uploadedPath) {
        deleteMessageImage(uploadedPath).catch(() => {});
      }
      setSendError(err instanceof Error ? err.message : "Couldn't send that photo. Try again.");
    } finally {
      setIsSending(false);
    }
  }

  async function handleSendText(senderUserId: string) {
    setIsSending(true);
    setSendError(null);
    try {
      const sent = await sendTextMessage(conversationId, senderUserId, trimmedDraft);
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

  function handleSend() {
    if (!user || isSending) return;
    if (pendingImage) {
      handleSendImage(user.id, pendingImage);
      return;
    }
    if (trimmedDraft.length === 0) return;
    handleSendText(user.id);
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
      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-stone-100 bg-[#fbfaf7]/95 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] backdrop-blur">
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
                  {message.imagePath ? (
                    <MessageImageBubble
                      signedUrl={signedImageUrls.get(message.imagePath)}
                      attempted={signedUrlAttempted.has(message.imagePath)}
                      onOpen={setFullscreenImageUrl}
                    />
                  ) : (
                    <div
                      className={`rounded-2xl px-3.5 py-2 text-sm ${
                        isMine ? "bg-kavanaka-lime text-kavanaka-ink" : "bg-white text-stone-900 shadow-sm"
                      }`}
                    >
                      {message.body}
                    </div>
                  )}
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

        {pendingImage ? (
          <div className="mb-2 flex items-center gap-2 rounded-2xl bg-white px-2.5 py-2 shadow-sm">
            <DemoPhoto src={pendingImage.previewUrl} alt="" className="size-12 shrink-0 rounded-xl" />
            <p className="flex-1 truncate text-xs font-semibold text-stone-500">Photo ready to send</p>
            <button
              type="button"
              onClick={cancelPendingImage}
              aria-label="Remove photo"
              className="grid size-7 shrink-0 place-items-center rounded-full bg-stone-100 text-sm font-bold text-stone-600"
            >
              ×
            </button>
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          <input
            ref={imageInputRef}
            type="file"
            accept={`${ALLOWED_IMAGE_TYPES.join(",")},image/heic,image/heif,.heic,.heif`}
            onChange={handleImageSelected}
            className="hidden"
          />
          <button
            type="button"
            // .click() called directly inside this gesture handler — required
            // for the hidden-input-triggered file picker to open inside
            // Capacitor's WKWebView (see MediaComposerFields for the same
            // established pattern).
            onClick={() => imageInputRef.current?.click()}
            disabled={pendingImage !== null}
            aria-label="Attach a photo"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-stone-100 text-stone-600 disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-5">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"
              />
              <circle cx="12" cy="13.5" r="3.25" />
            </svg>
          </button>
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
            // Mutually exclusive with a pending image — the least confusing
            // option: text stays visible but inert, and reactivates on its
            // own the moment the image is cancelled, never force-cleared.
            disabled={pendingImage !== null}
            aria-label="Message"
            className="max-h-28 min-w-0 flex-1 resize-none rounded-2xl border border-stone-200 bg-white px-3.5 py-2.5 text-[16px] text-stone-900 outline-none placeholder:text-stone-400 disabled:opacity-40 md:text-sm"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={(pendingImage === null && trimmedDraft.length === 0) || isSending}
            className="shrink-0 rounded-full bg-kavanaka-lime px-4 py-2.5 text-sm font-bold text-kavanaka-ink disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>

      <MessageImageFullscreen imageUrl={fullscreenImageUrl} onClose={() => setFullscreenImageUrl(null)} />
    </main>
  );
}
