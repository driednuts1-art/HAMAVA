import { apiFetch } from "@/lib/api-client";
import type { PresenceValue } from "@/lib/queries/discovery";

// Mirrors backend/src/modules/chat/* exactly (verified by reading the real
// code) — docs/requirements.md Feature 17 §1/§6.2/§6.4/§6.6.

export interface ConversationSummary {
  matchId: string;
  otherUser: {
    id: string;
    displayName: string | null;
    verified: boolean;
    primaryPhotoId: string | null;
    primaryPhotoUrl: string | null;
    // Feature 27 (FR-485/FR-486): null when the symmetric privacy rule hides it.
    presence: PresenceValue | null;
  };
  lastMessage: { content: string; sentAt: string; senderId: string } | null;
  unreadCount: number;
}

export function getConversations(): Promise<ConversationSummary[]> {
  return apiFetch<ConversationSummary[]>("/v1/chat/conversations");
}

export interface Message {
  id: string;
  matchId: string;
  senderId: string;
  content: string;
  sentAt: string;
  readAt: string | null;
  clientIdempotencyKey: string;
}

export interface MessageHistoryPage {
  messages: Message[];
  nextCursor: string | null;
}

// FR-321: newest-first — the opposite direction from the deck's cursor.
export function getMessageHistory(
  matchId: string,
  cursor?: string,
  limit = 30,
): Promise<MessageHistoryPage> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return apiFetch<MessageHistoryPage>(
    `/v1/chat/conversations/${matchId}/messages?${params.toString()}`,
  );
}

// FR-323: clientIdempotencyKey is generated once per compose action by the
// caller and reused verbatim on retry — never regenerated here.
export function sendMessage(
  matchId: string,
  content: string,
  clientIdempotencyKey: string,
): Promise<Message> {
  return apiFetch<Message>(`/v1/chat/conversations/${matchId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, clientIdempotencyKey }),
  });
}

export function markConversationRead(matchId: string): Promise<void> {
  return apiFetch<void>(`/v1/chat/conversations/${matchId}/read`, {
    method: "POST",
  });
}

export function blockConversationPartner(matchId: string): Promise<void> {
  return apiFetch<void>(`/v1/chat/conversations/${matchId}/block`, {
    method: "POST",
  });
}

// Real backend enum (backend/prisma/schema.prisma ReportReasonCategory) —
// kept in sync manually, same convention as lib/queries/matches.ts's enums.
export type ReportReasonCategory =
  | "SPAM"
  | "FAKE_PROFILE"
  | "HARASSMENT"
  | "SCAM_OR_FINANCIAL"
  | "OTHER";

export function reportConversationPartner(
  matchId: string,
  category: ReportReasonCategory,
  reason?: string,
  messageId?: string,
): Promise<unknown> {
  return apiFetch(`/v1/chat/conversations/${matchId}/report`, {
    method: "POST",
    body: JSON.stringify({
      category,
      ...(reason ? { reason } : {}),
      ...(messageId ? { messageId } : {}),
    }),
  });
}
