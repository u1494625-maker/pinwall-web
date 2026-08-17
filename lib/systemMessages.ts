"use client";

import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";

/** Reserved conversation id representing the System Message thread in the
 *  merged Messages list (see getConversations() in lib/messages.ts) — real
 *  conversation ids are always >= 1 (Postgres `generated always as
 *  identity` starts at 1), so 0 can never collide with a real one. */
export const SYSTEM_CONVERSATION_ID = 0;

export type SystemMessage = {
  id: number;
  kind: "report_removed_reporter" | "report_removed_author";
  targetType: "post" | "comment";
  targetId: number;
  contentPreview: string;
  /** The complete, final text to render as-is — composed once, server-side,
   *  at creation time (see remove_reported_content in
   *  supabase/system_messages.sql). Never reconstructed from a template. */
  body: string;
  createdAt: string;
};

export type SystemMessageSummary = {
  lastMessageAt: string;
  lastMessageBody: string | null;
  unreadCount: number;
};

/** snake_case shape of a `system_messages` row, as returned by Supabase/PostgREST. */
type SystemMessageRow = {
  id: number;
  kind: "report_removed_reporter" | "report_removed_author";
  target_type: "post" | "comment";
  target_id: number;
  content_preview: string;
  body: string;
  created_at: string;
};

/** snake_case shape of a get_system_message_summary() row. */
type SystemMessageSummaryRow = {
  last_message_at: string;
  last_message_body: string | null;
  unread_count: number;
};

const SYSTEM_MESSAGE_COLUMNS = "id, kind, target_type, target_id, content_preview, body, created_at";

function rowToSystemMessage(row: SystemMessageRow): SystemMessage {
  return {
    id: row.id,
    kind: row.kind,
    targetType: row.target_type,
    targetId: row.target_id,
    contentPreview: row.content_preview,
    body: row.body,
    createdAt: row.created_at,
  };
}

/**
 * This user's System Message summary — undefined if they've never received
 * one, matching get_conversations()'s own "no activity, don't appear in the
 * list" convention. lib/messages.ts's getConversations() is the only
 * caller, merging this in as one synthetic list row.
 */
export async function getSystemMessageSummary(): Promise<SystemMessageSummary | undefined> {
  if (!isSupabaseConfigured) return undefined;

  const { data, error } = await supabase.rpc("get_system_message_summary");

  if (error) {
    console.error("Failed to load system message summary from Supabase:", error.message);
    return undefined;
  }

  const row = ((data ?? []) as SystemMessageSummaryRow[])[0];
  if (!row) return undefined;

  return {
    lastMessageAt: row.last_message_at,
    lastMessageBody: row.last_message_body,
    unreadCount: row.unread_count,
  };
}

/** Full chronological history of this user's own System Message thread. RLS
 *  scopes reads to the caller's own recipient_user_id automatically — same
 *  pattern as getMessages() in lib/messages.ts, no explicit filter needed. */
export async function getSystemMessages(): Promise<SystemMessage[]> {
  if (!isSupabaseConfigured) return [];

  const { data, error } = await supabase
    .from("system_messages")
    .select(SYSTEM_MESSAGE_COLUMNS)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to load system messages from Supabase:", error.message);
    return [];
  }

  return (data ?? []).map(rowToSystemMessage);
}

/** Marks this user's entire System Message thread read — exactly parallel to
 *  markConversationRead for a human conversation. Never touches the global
 *  dot signal (message_inbox_state) or any human conversation's read state. */
export async function markSystemMessagesRead(): Promise<void> {
  if (!isSupabaseConfigured) return;

  const { error } = await supabase.rpc("mark_system_messages_read");

  if (error) {
    console.error("Failed to mark system messages read:", error.message);
  }
}

/**
 * Live updates for the signed-in user's own System Message thread, scoped
 * by userId — used by SystemMessageScreen to show a new message immediately
 * and mark it read. Filtered server-side by recipient_user_id, though RLS
 * remains the actual security backstop regardless of what filter a caller
 * requests, same principle as subscribeToConversationMessages's
 * conversation_id filter in lib/messages.ts.
 */
export function subscribeToSystemMessages(userId: string, onInsert: (message: SystemMessage) => void): () => void {
  if (!isSupabaseConfigured) return () => {};

  const channel = supabase
    .channel(`system-messages-${userId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "system_messages", filter: `recipient_user_id=eq.${userId}` },
      (payload) => onInsert(rowToSystemMessage(payload.new as SystemMessageRow)),
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Same underlying subscription as subscribeToSystemMessages, under its own
 * channel name so it can coexist with a simultaneously-open
 * SystemMessageScreen without conflict — used only by BottomNav's "new
 * system message" dot signal, mirroring subscribeToIncomingMessages's role
 * for human DMs.
 */
export function subscribeToIncomingSystemMessages(
  userId: string,
  onInsert: (message: SystemMessage) => void,
): () => void {
  if (!isSupabaseConfigured) return () => {};

  const channel = supabase
    .channel(`global-system-message-inbox-${userId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "system_messages", filter: `recipient_user_id=eq.${userId}` },
      (payload) => onInsert(rowToSystemMessage(payload.new as SystemMessageRow)),
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
