import { apiFetch } from "@/lib/api-client";
import type { PresenceValue } from "@/lib/queries/discovery";

// Mirrors backend/src/modules/discovery/match.service.ts and
// match-feedback.service.ts exactly (verified by reading the real code) —
// docs/requirements.md Feature 17 §1/§6.2/§6.7.

export type MatchSource = "SWIPE" | "SUPER_LIKE";

export interface MatchSummary {
  matchId: string;
  matchedAt: string;
  matchSource: MatchSource;
  matchReasons: string[];
  matchMismatches: string[];
  explanationGeneratedAt: string | null;
  user: {
    id: string;
    displayName: string | null;
    age: number | null;
    verified: boolean;
    primaryPhotoId: string | null;
    // Feature 27 (FR-485/FR-486): null when the symmetric privacy rule hides it.
    presence: PresenceValue | null;
  };
}

export function getMatches(): Promise<MatchSummary[]> {
  return apiFetch<MatchSummary[]>("/v1/discovery/matches");
}

export type MatchFeedbackRating =
  | "VERY_RELEVANT"
  | "RELEVANT"
  | "NEUTRAL"
  | "NOT_RELEVANT"
  | "WRONG_MATCH";

export type MatchFeedbackReason =
  | "LOCATION"
  | "AGE"
  | "GOAL"
  | "LANGUAGE"
  | "PROFESSION"
  | "INTEREST"
  | "NOT_INTERESTED"
  | "OTHER";

export interface MatchFeedback {
  rating: MatchFeedbackRating;
  reasonCode: MatchFeedbackReason | null;
  createdAt: string;
  updatedAt: string;
}

// A real bug found running Feature 17's own e2e suite: NestJS sends a
// genuinely empty response body (not the JSON literal "null") when a
// controller handler returns `null` (match-feedback.service.ts::getMine),
// and apiFetch's `text ? JSON.parse(text) : undefined` (lib/api-client.ts)
// then resolves that empty body to `undefined` — which React Query
// explicitly forbids as query data ("Query data cannot be undefined"),
// throwing at runtime. Every other apiFetch caller either expects a real,
// non-empty JSON payload or genuinely expects `void` (a 204 endpoint,
// where the caller never reads the return value) — this is the first
// endpoint whose real, meaningful success payload is `null` itself, so the
// coalesce belongs here, not in the shared api-client.ts (safer, narrower
// blast radius than changing a utility every other feature also depends on).
export async function getMatchFeedback(matchId: string): Promise<MatchFeedback | null> {
  const result = await apiFetch<MatchFeedback | null>(
    `/v1/discovery/matches/${matchId}/feedback`,
  );
  return result ?? null;
}

export function submitMatchFeedback(
  matchId: string,
  rating: MatchFeedbackRating,
  reasonCode?: MatchFeedbackReason,
): Promise<MatchFeedback> {
  return apiFetch<MatchFeedback>(`/v1/discovery/matches/${matchId}/feedback`, {
    method: "POST",
    body: JSON.stringify({ rating, ...(reasonCode ? { reasonCode } : {}) }),
  });
}
