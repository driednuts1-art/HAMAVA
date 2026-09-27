import { apiFetch } from "@/lib/api-client";
import type {
  DrinkingHabit,
  Education,
  ExerciseHabit,
  Gender,
  KidsStatus,
  PoliticalView,
  PromptAnswer,
  RelationshipGoal,
  SmokingHabit,
  ZodiacSign,
} from "@/lib/queries/profile";

// Mirrors backend/src/modules/discovery/* exactly (verified by reading the
// real code, not guessed) — docs/requirements.md Feature 16.

// Feature 27 (FR-485/FR-486): null means genuinely hidden by the symmetric
// privacy rule (either party has showLastActiveStatus off) — never render
// this as "offline," render nothing at all.
export interface PresenceValue {
  online: boolean;
  lastOnlineAt: string | null;
}

export interface DeckCandidate {
  id: string;
  displayName: string | null;
  age: number | null;
  city: string | null;
  bio: string | null;
  interests: string[];
  verified: boolean;
  photos: { id: string; position: number; url: string }[];
  // Feature 24 (FR-453): candidate-profile-fields.util.ts's shared shape —
  // present on every deck/AI-search/who-liked-me candidate alike.
  promptAnswers: PromptAnswer[];
  height: number | null;
  education: Education | null;
  exerciseHabit: ExerciseHabit | null;
  hasKids: KidsStatus | null;
  zodiacSign: ZodiacSign | null;
  politicalView: PoliticalView | null;
  hometown: string | null;
  languages: string[];
  // FR-451: already null when the candidate has hideDrinkingSmoking set —
  // enforced server-side, never a client-side hide.
  drinking: DrinkingHabit | null;
  smoking: SmokingHabit | null;
  // Feature 24 (FR-456): only ever populated by getWhoLikedMe below.
  likedWith?: "LIKE" | "SUPER_LIKE";
  // Feature 27 (FR-490): true whenever createdAt is within the last 7 days.
  isNewMember: boolean;
  presence: PresenceValue | null;
}

export interface DeckPage {
  candidates: DeckCandidate[];
  nextCursor: string | null;
}

export function getDeck(cursor?: string, limit = 20): Promise<DeckPage> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return apiFetch<DeckPage>(`/v1/discovery/deck?${params.toString()}`);
}

export type SwipeAction = "LIKE" | "PASS" | "SUPER_LIKE";

export interface SwipeResult {
  swipeId: string;
  action: SwipeAction;
  matched: boolean;
  matchId?: string;
}

export function swipe(targetUserId: string, action: SwipeAction): Promise<SwipeResult> {
  return apiFetch<SwipeResult>("/v1/discovery/swipes", {
    method: "POST",
    body: JSON.stringify({ targetUserId, action }),
  });
}

export interface DiscoveryPreferences {
  minAge: number;
  maxAge: number;
  genderPref: Gender[];
  relationshipGoalPref: RelationshipGoal[];
  verifiedOnly: boolean;
  activeThisWeekOnly: boolean;
  newMembersOnly: boolean;
}

export function getPreferences(): Promise<DiscoveryPreferences> {
  return apiFetch<DiscoveryPreferences>("/v1/discovery/preferences");
}

export function updatePreferences(
  input: Partial<DiscoveryPreferences>,
): Promise<DiscoveryPreferences> {
  return apiFetch<DiscoveryPreferences>("/v1/discovery/preferences", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export interface ExtractedFilters {
  city: string | null;
  minAge: number | null;
  maxAge: number | null;
  gender: Gender[];
  relationshipGoal: RelationshipGoal[];
  semanticQuery: string;
}

export function extractTextFilters(text: string): Promise<{ filters: ExtractedFilters }> {
  return apiFetch<{ filters: ExtractedFilters }>("/v1/discovery/ai-search/extract", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function transcribeVoiceFilters(
  audio: Blob,
): Promise<{ transcribedText: string; filters: ExtractedFilters }> {
  const form = new FormData();
  form.append("audio", audio, "prompt.webm");
  return apiFetch<{ transcribedText: string; filters: ExtractedFilters }>(
    "/v1/discovery/ai-search/transcribe",
    { method: "POST", body: form },
  );
}

export type AiSearchMode = "TEXT" | "VOICE";

export interface AiSearchInput {
  mode: AiSearchMode;
  semanticQuery: string;
  city?: string;
  minAge?: number;
  maxAge?: number;
  gender?: Gender[];
  relationshipGoal?: RelationshipGoal[];
  cursor?: string;
  limit?: number;
}

// FR-275: `verifiedOnly` is deliberately not a field of AiSearchInput at
// all — it structurally cannot be set here, matching the real backend DTO.
export function runAiSearch(input: AiSearchInput): Promise<DeckPage> {
  return apiFetch<DeckPage>("/v1/discovery/ai-search", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface BoostStatus {
  active: boolean;
  endsAt: string | null;
}

export function getBoostStatus(): Promise<BoostStatus> {
  return apiFetch<BoostStatus>("/v1/discovery/boost");
}

export function activateBoost(): Promise<BoostStatus> {
  return apiFetch<BoostStatus>("/v1/discovery/boost", { method: "POST" });
}

// ---- Feature 24: Who Liked Me (FR-453..FR-463) ----

// Shared React Query key so the tab bar's badge (components/layout/tab-bar.tsx)
// and the list screen (components/discovery/who-liked-me-list.tsx) invalidate
// and refetch the exact same cache entry — same reasoning as
// lib/queries/chat-query-keys.ts's CONVERSATIONS_QUERY_KEY.
export const WHO_LIKED_ME_COUNT_QUERY_KEY = ["discovery", "who-liked-me", "count"];
export const WHO_LIKED_ME_QUERY_KEY = ["discovery", "who-liked-me"];

/** Mirrors DeckPage's own shape — the same real cursor contract every list endpoint uses. */
export function getWhoLikedMe(cursor?: string, limit = 20): Promise<DeckPage> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return apiFetch<DeckPage>(`/v1/discovery/who-liked-me?${params.toString()}`);
}

/** FR-462: real unseen-like count for the tab badge. */
export function getWhoLikedMeCount(): Promise<{ count: number }> {
  return apiFetch<{ count: number }>("/v1/discovery/who-liked-me/count");
}

/** FR-463: mark the tab seen as of now, resetting the badge. */
export function markWhoLikedMeSeen(): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/v1/discovery/who-liked-me/seen", {
    method: "POST",
  });
}
