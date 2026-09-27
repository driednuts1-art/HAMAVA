import { apiFetch } from "@/lib/api-client";
import { ApiRequestError, parseProblemDetails } from "@/lib/api-error";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

// Mirrors backend/src/modules/date-share/date-share.service.ts and its two
// controllers exactly (verified by reading the real running code) —
// docs/requirements.md Feature 19 §1/§6.

export interface DateShareLinkCreated {
  id: string;
  token: string;
  expiresAt: string;
}

export function createDateShareLink(
  matchId: string,
  datetime: string,
  locationText: string,
): Promise<DateShareLinkCreated> {
  return apiFetch<DateShareLinkCreated>(`/v1/discovery/matches/${matchId}/date-share`, {
    method: "POST",
    body: JSON.stringify({ datetime, locationText }),
  });
}

export interface DateShareLinkSummary {
  id: string;
  datetime: string;
  locationText: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export function getDateShareLinks(matchId: string): Promise<DateShareLinkSummary[]> {
  return apiFetch<DateShareLinkSummary[]>(`/v1/discovery/matches/${matchId}/date-share`);
}

export function revokeDateShareLink(matchId: string, linkId: string): Promise<void> {
  return apiFetch<void>(`/v1/discovery/matches/${matchId}/date-share/${linkId}`, {
    method: "DELETE",
  });
}

// FR-165/FR-389: no `verified` field exists in this response — verification
// is a precondition for the row being returned at all (checked server-side,
// FR-156/FR-166), never something this client reads a boolean for.
export interface PublicDateShareView {
  sharerDisplayName: string | null;
  partnerDisplayName: string | null;
  partnerPhotoUrl: string | null;
  datetime: string;
  locationText: string;
}

// FR-388/FR-393/§9: deliberately does NOT go through apiFetch — that shared
// helper always attaches `Authorization` from useAuthStore when a token
// happens to be present (e.g. an already-logged-in visitor opening their own
// link, FR-393) and its 401-refresh-retry logic assumes an authenticated
// context that doesn't apply here. This is the one genuinely public,
// unauthenticated fetch in this frontend — it must send no auth header at
// all, regardless of whether the browser happens to hold a session
// elsewhere, matching the real backend endpoint (public-date-share.controller.ts)
// having no guard at all. A dedicated function, not a flag on the shared
// utility every other feature also depends on — narrower blast radius,
// matching this project's own established precedent (lib/queries/matches.ts's
// getMatchFeedback fix).
export async function getPublicDateShare(token: string): Promise<PublicDateShareView> {
  const response = await fetch(`${API_BASE_URL}/v1/date-share/${token}`, {
    headers: { Accept: "application/json" },
  });
  if (response.ok) {
    return (await response.json()) as PublicDateShareView;
  }
  throw new ApiRequestError(await parseProblemDetails(response));
}
