"use client";

import { useSyncExternalStore } from "react";
import { FALLBACK_DISPLAY_NAME, getProfilesByUserIds } from "@/lib/profiles";
import { getSystemMessageSummary, SYSTEM_CONVERSATION_ID } from "@/lib/systemMessages";
import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";

/** Mirrors the check constraint in supabase/messaging.sql. */
export const MAX_MESSAGE_LENGTH = 2000;

/** Practical expiry for a message-image signed URL — see
 *  getMessageImageSignedUrl(s) in lib/storage.ts. Not an elaborate refresh
 *  scheduler for v1: a conversation reopened after this window simply
 *  re-signs on load, same as any other fresh page view. */
export const SIGNED_URL_EXPIRES_IN_SECONDS = 24 * 60 * 60;

export type Conversation = {
  id: number;
  /** Absent only for the synthetic System Message row (id ===
   *  SYSTEM_CONVERSATION_ID) — there is no real other participant to name. */
  otherUserId?: string;
  /** Current profile identity for the other participant, resolved via
   *  otherUserId -> profiles — never a stored snapshot, same convention as
   *  post/comment authorship elsewhere in this app. For the System Message
   *  row this is always the literal string "System Message" instead. */
  otherDisplayName: string;
  otherAvatarUrl?: string;
  lastMessageAt: string;
  lastMessageBody: string | null;
  /** Messages from the other participant sent after the signed-in user's own
   *  last_read_at for this conversation — never includes their own sends
   *  (see get_conversations() in supabase/messaging_unread.sql). */
  unreadCount: number;
};

/** A message is exactly one of TEXT (body set, imagePath null) or IMAGE
 *  (imagePath set, body null) — enforced at the DB level by
 *  messages_body_or_image_check (supabase/message_images.sql), never both,
 *  never neither. */
export type DirectMessage = {
  id: number;
  conversationId: number;
  senderUserId: string;
  body: string | null;
  /** Storage path in the private message-images bucket, not a URL — see
   *  getMessageImageSignedUrl(s) in lib/storage.ts for turning this into
   *  something renderable. */
  imagePath: string | null;
  createdAt: string;
};

/** snake_case shape of a get_conversations() row. */
type ConversationRow = {
  id: number;
  other_user_id: string;
  last_message_at: string | null;
  last_message_body: string | null;
  created_at: string;
  unread_count: number;
};

/** snake_case shape of a `messages` row, as returned by Supabase/PostgREST. */
type MessageRow = {
  id: number;
  conversation_id: number;
  sender_user_id: string;
  body: string | null;
  image_path: string | null;
  created_at: string;
};

const MESSAGE_COLUMNS = "id, conversation_id, sender_user_id, body, image_path, created_at";

function rowToMessage(row: MessageRow): DirectMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderUserId: row.sender_user_id,
    body: row.body,
    imagePath: row.image_path,
    createdAt: row.created_at,
  };
}

/**
 * Opens the one conversation between the signed-in user and `otherUserId`,
 * creating it if it doesn't exist yet — see supabase/messaging.sql's
 * get_or_create_conversation for the uniqueness/concurrency guarantee (a
 * client never decides this itself). Throws a plain, user-facing message on
 * failure (not signed in, messaging yourself, a nonexistent user) — never a
 * raw Supabase error string.
 */
export async function getOrCreateConversation(otherUserId: string): Promise<number> {
  if (!isSupabaseConfigured) {
    throw new Error("Messaging isn't available right now.");
  }

  const { data, error } = await supabase.rpc("get_or_create_conversation", { other_user_id: otherUserId });

  if (error || data == null) {
    throw new Error("Couldn't open this conversation. Try again.");
  }

  return data as number;
}

/**
 * Every conversation that has at least one real message, newest activity
 * first — a conversation that was only ever opened (Profile -> Message) but
 * never actually used doesn't appear (see get_conversations() in
 * supabase/messaging.sql). The other participant's current identity is
 * batch-resolved via the existing getProfilesByUserIds, never one query per
 * row and never a stored name/avatar snapshot.
 *
 * Also merges in a single synthetic "System Message" row (id ===
 * SYSTEM_CONVERSATION_ID) when the caller has ever received one — see
 * lib/systemMessages.ts's getSystemMessageSummary(). This is the one place
 * human and system activity are combined into the single sorted list
 * ConversationList renders; System Message participates in that same
 * newest-activity-first ordering like any other row.
 */
export async function getConversations(): Promise<Conversation[]> {
  if (!isSupabaseConfigured) return [];

  // Independent of the RPC and profile lookup below — depends on neither's
  // result — so it's started immediately rather than serialized behind them.
  // getSystemMessageSummary() never rejects (it catches its own Supabase
  // errors internally and resolves to undefined, same convention as every
  // other read in this file), so leaving this promise unawaited on the
  // early return below carries no unhandled-rejection risk.
  const systemSummaryPromise = getSystemMessageSummary();

  const { data, error } = await supabase.rpc("get_conversations");

  if (error) {
    console.error("Failed to load conversations from Supabase:", error.message);
    return [];
  }

  const rows = (data ?? []) as ConversationRow[];
  const profilesByUserId = await getProfilesByUserIds(rows.map((row) => row.other_user_id));

  const conversations: Conversation[] = rows.map((row) => {
    const profile = profilesByUserId.get(row.other_user_id);
    return {
      id: row.id,
      otherUserId: row.other_user_id,
      otherDisplayName: profile?.displayName ?? FALLBACK_DISPLAY_NAME,
      otherAvatarUrl: profile?.avatarUrl ?? undefined,
      // Never null here: get_conversations() only returns rows that already
      // have a first message.
      lastMessageAt: row.last_message_at as string,
      lastMessageBody: row.last_message_body,
      unreadCount: row.unread_count,
    };
  });

  const systemSummary = await systemSummaryPromise;
  if (systemSummary) {
    conversations.push({
      id: SYSTEM_CONVERSATION_ID,
      otherDisplayName: "System Message",
      lastMessageAt: systemSummary.lastMessageAt,
      lastMessageBody: systemSummary.lastMessageBody,
      unreadCount: systemSummary.unreadCount,
    });
  }

  return conversations.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
}

/** snake_case shape of a `conversations` row's two participant columns. */
type ConversationParticipantsRow = { user_a_id: string; user_b_id: string };

/**
 * The two participant ids for one conversation, fetched directly by id —
 * not via getConversations(), which deliberately excludes a conversation
 * with no messages yet, but the conversation screen still needs to show its
 * header (Profile -> Message opens an empty conversation before either side
 * has said anything). RLS already scopes this to conversations the caller
 * participates in; undefined for anything else — a nonexistent id and a real
 * conversation the caller isn't part of are indistinguishable from the
 * client's point of view, which is the correct, secure behavior (never leak
 * which case it was).
 */
export async function getConversationParticipants(
  conversationId: number,
): Promise<{ userAId: string; userBId: string } | undefined> {
  if (!isSupabaseConfigured) return undefined;

  const { data, error } = await supabase
    .from("conversations")
    .select("user_a_id, user_b_id")
    .eq("id", conversationId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load conversation from Supabase:", error.message);
    return undefined;
  }

  if (!data) return undefined;

  const row = data as ConversationParticipantsRow;
  return { userAId: row.user_a_id, userBId: row.user_b_id };
}

/** Full chronological history for one conversation. RLS silently returns
 *  nothing for a conversation the caller isn't part of, rather than an
 *  error — callers treat an empty result the same as "no messages yet". */
export async function getMessages(conversationId: number): Promise<DirectMessage[]> {
  if (!isSupabaseConfigured) return [];

  const { data, error } = await supabase
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to load messages from Supabase:", error.message);
    return [];
  }

  return (data ?? []).map(rowToMessage);
}

/** Inserts a text message as `senderUserId` — RLS independently verifies
 *  this against auth.uid() and conversation participancy, so this can never
 *  send as someone else or into a conversation the caller isn't part of, no
 *  matter what's passed here. Throws a plain message on failure. */
export async function sendTextMessage(conversationId: number, senderUserId: string, body: string): Promise<DirectMessage> {
  if (!isSupabaseConfigured) {
    throw new Error("Messaging isn't available right now.");
  }

  const { data, error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, sender_user_id: senderUserId, body })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error("Couldn't send that message. Try again.");
  }

  return rowToMessage(data);
}

/** Inserts an image message as `senderUserId` — `imagePath` must already
 *  point at a real object the caller just uploaded (see uploadMessageImage
 *  in lib/storage.ts); this only ever records the reference. Same RLS
 *  guarantees as sendTextMessage above (sender identity + participancy +
 *  not-blocked, all independently re-verified server-side). Throws a plain
 *  message on failure — callers are responsible for best-effort deleting the
 *  now-orphaned uploaded object when this throws (see ConversationScreen). */
export async function sendImageMessage(
  conversationId: number,
  senderUserId: string,
  imagePath: string,
): Promise<DirectMessage> {
  if (!isSupabaseConfigured) {
    throw new Error("Messaging isn't available right now.");
  }

  const { data, error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, sender_user_id: senderUserId, image_path: imagePath })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error("Couldn't send that photo. Try again.");
  }

  return rowToMessage(data);
}

/**
 * Live updates for one open conversation — appends every new message
 * inserted into it (from either participant) via `onInsert`. The caller is
 * responsible for de-duplicating against a message it already added itself
 * from sendMessage's own return value (see ConversationScreen), since a
 * message the viewer just sent will also arrive back through this same
 * subscription. Returns an unsubscribe function; safe to call unconditionally
 * on unmount even if the subscription never fully connected.
 */
export function subscribeToConversationMessages(
  conversationId: number,
  onInsert: (message: DirectMessage) => void,
): () => void {
  if (!isSupabaseConfigured) return () => {};

  const channel = supabase
    .channel(`conversation-${conversationId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
      (payload) => onInsert(rowToMessage(payload.new as MessageRow)),
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Marks every existing message from the other participant as read,
 * immediately — no scroll-to-bottom requirement. Also called again whenever
 * a new message arrives via Realtime while this exact conversation is open
 * (see ConversationScreen), so it never accumulates unread while actively
 * being viewed. Never touches the global "have I opened Messages" signal
 * (mark_messages_opened/message_inbox_state below) — these are two
 * deliberately separate concepts.
 */
export async function markConversationRead(conversationId: number): Promise<void> {
  if (!isSupabaseConfigured) return;

  const { error } = await supabase.rpc("mark_conversation_read", { p_conversation_id: conversationId });

  if (error) {
    console.error("Failed to mark conversation read:", error.message);
  }
}

/**
 * Global, unfiltered subscription to every new message insert. Realtime
 * enforces the same RLS as REST for authenticated clients, so despite having
 * no filter, this only ever delivers messages in conversations the caller is
 * actually a participant in — there is no separate authorization check
 * needed client-side. Used only for the BottomNav "new DM activity" dot;
 * coexists with ConversationScreen's own per-conversation subscription
 * without conflict (distinct channel names, both fully supported at once).
 */
export function subscribeToIncomingMessages(onInsert: (message: DirectMessage) => void): () => void {
  if (!isSupabaseConfigured) return () => {};

  const channel = supabase
    .channel("global-message-inbox")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload) => onInsert(rowToMessage(payload.new as MessageRow)),
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/** Real, one-time check of "has any other user sent me a DM since I last
 *  opened /messages" — the initial value for the BottomNav dot on mount,
 *  before Realtime has had a chance to report anything live. */
export async function hasNewMessagesSinceLastOpen(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  const { data, error } = await supabase.rpc("has_new_messages_since_last_open");

  if (error) {
    console.error("Failed to check for new messages:", error.message);
    return false;
  }

  return Boolean(data);
}

/** Clears the global dot signal only — never marks any individual
 *  conversation read. Call once when the /messages root page mounts. */
export async function markMessagesOpened(): Promise<void> {
  if (!isSupabaseConfigured) return;

  const { error } = await supabase.rpc("mark_messages_opened");

  if (error) {
    console.error("Failed to mark messages opened:", error.message);
  }
}

// ============================================================================
// Shared, same-tab reactive state for the BottomNav dot
// ============================================================================
// Two independent, mutable module-level values notified via the same
// mechanism this codebase already uses elsewhere (see lib/map/viewport.ts's
// useSyncExternalStore-backed store) for "two sibling components need to
// share client-only state without prop drilling or a new Context provider."
//
// This is intentionally NOT persisted to sessionStorage/localStorage — the
// source of truth for "should the dot be on" is always the server
// (hasNewMessagesSinceLastOpen, re-checked fresh on every real page load);
// this store only relays same-tab updates between BottomNav (which renders
// the dot) and MessagesHome/ConversationScreen (which change what it should
// show) while the tab stays open.

let hasUnseenMessages = false;
const unseenMessagesListeners = new Set<() => void>();

function notifyUnseenMessagesListeners() {
  unseenMessagesListeners.forEach((listener) => listener());
}

/** Flips the shared dot state and notifies every subscribed BottomNav
 *  instance. A no-op if the value isn't actually changing, so this is safe
 *  to call from a Realtime handler on every qualifying event without
 *  spamming re-renders. */
export function setHasUnseenMessages(value: boolean) {
  if (hasUnseenMessages === value) return;
  hasUnseenMessages = value;
  notifyUnseenMessagesListeners();
}

/** Reactive read of the shared dot state — false on both the server and the
 *  first client render (matches this store's always-false starting value),
 *  only ever changing after a real client-side check or Realtime event. */
export function useHasUnseenMessages(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      unseenMessagesListeners.add(onChange);
      return () => unseenMessagesListeners.delete(onChange);
    },
    () => hasUnseenMessages,
    () => false,
  );
}

// The conversation id currently open on screen, if any — consulted
// (imperatively, not reactively) by BottomNav's global subscription handler
// to decide whether an incoming message for that exact conversation should
// be suppressed from lighting the dot (it's already being shown/marked read
// live by the open ConversationScreen). Plain mutable state, not a
// useSyncExternalStore value: nothing ever needs to re-render off of this by
// itself, it's only ever read at the moment a Realtime event arrives.
//
// Also reused, unchanged, for the System Message thread: SystemMessageScreen
// sets this to SYSTEM_CONVERSATION_ID on mount/unmount, letting BottomNav's
// system-message subscription apply the exact same suppression check rather
// than inventing a second "currently open" concept.
let currentlyOpenConversationId: number | null = null;

/** Called by ConversationScreen (and SystemMessageScreen, with
 *  SYSTEM_CONVERSATION_ID) on mount/unmount — never call this from anywhere
 *  else. */
export function setCurrentlyOpenConversationId(conversationId: number | null) {
  currentlyOpenConversationId = conversationId;
}

export function getCurrentlyOpenConversationId(): number | null {
  return currentlyOpenConversationId;
}
