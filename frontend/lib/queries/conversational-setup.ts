import { apiFetch } from "@/lib/api-client";
import type { Gender, RelationshipGoal, UpdateProfileInput } from "@/lib/queries/profile";

// Mirrors backend/src/modules/profile/conversational-setup/types.ts and
// conversational-setup.controller.ts exactly (verified by reading the real
// code, not guessed) — docs/requirements.md Feature 11 / Feature 15.
export type ConversationalField =
  | "displayName"
  | "birthDate"
  | "city"
  | "interests"
  | "bio";

export interface ExtractedTurnField {
  field: ConversationalField | null;
  stringValue: string | null;
  interestsValue: string[] | null;
  birthDateGregorian: string | null;
  birthDateDisplay: string | null;
}

export interface StartResult {
  sessionId: string;
  remainingFields: ConversationalField[];
  assistantMessage: string;
}

export interface TurnResult {
  transcript?: string;
  proposed: ExtractedTurnField;
  assistantReply: string;
  remainingFields: ConversationalField[];
  completed: boolean;
}

export interface ConfirmResult {
  remainingFields: ConversationalField[];
  completed: boolean;
}

const BASE = "/v1/profile/conversational-setup";

export function startConversationalSetup(): Promise<StartResult> {
  return apiFetch<StartResult>(`${BASE}/start`, { method: "POST" });
}

export function sendTextTurn(
  sessionId: string,
  text: string,
): Promise<TurnResult> {
  return apiFetch<TurnResult>(`${BASE}/${sessionId}/message`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function sendVoiceTurn(
  sessionId: string,
  audio: Blob,
): Promise<TurnResult> {
  const form = new FormData();
  form.append("audio", audio, "turn.webm");
  return apiFetch<TurnResult>(`${BASE}/${sessionId}/voice`, {
    method: "POST",
    body: form,
  });
}

/**
 * FR-247: the one real write path — a plain UpdateProfileDto body, exactly
 * one of the five conversational-eligible fields. The backend has no idea
 * whether this is the AI's original proposal or an edited value — that's
 * the entire mechanism, not a limitation of it.
 */
export function confirmField(
  sessionId: string,
  value: Pick<
    UpdateProfileInput,
    "displayName" | "birthDate" | "city" | "bio" | "interests"
  >,
): Promise<ConfirmResult> {
  return apiFetch<ConfirmResult>(`${BASE}/${sessionId}/confirm`, {
    method: "POST",
    body: JSON.stringify(value),
  });
}

export function endConversationalSetup(sessionId: string): Promise<void> {
  return apiFetch<void>(`${BASE}/${sessionId}`, { method: "DELETE" });
}

// Re-exported for proposal-card.tsx's convenience — it needs both this
// module's field-turn types and profile.ts's enum types.
export type { Gender, RelationshipGoal };
