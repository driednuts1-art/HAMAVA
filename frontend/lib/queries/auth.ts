import { apiFetch } from "@/lib/api-client";
import { ApiRequestError, parseProblemDetails } from "@/lib/api-error";
import { useAuthStore, type AuthUser } from "@/lib/auth-store";
import { getProfile } from "@/lib/queries/profile";

interface RequestOtpResponse {
  message: string;
  devCode?: string;
}

/** FR-213/FR-214: unauthenticated — no token exists yet, apiFetch just omits the header. */
export function requestOtp(phone: string): Promise<RequestOtpResponse> {
  return apiFetch<RequestOtpResponse>("/v1/auth/otp/request", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

// The real backend's /otp/verify (and this route's own proxy) only ever
// returns {id, livenessStatus} — never profileCompleted, which this
// function fetches separately (FR-225).
interface VerifyBackendResponse {
  accessToken: string;
  user: { id: string; livenessStatus: boolean };
}

interface VerifyResponse {
  accessToken: string;
  user: AuthUser;
}

/**
 * FR-207: goes through this app's own /api/auth/verify route, not apiFetch
 * directly to the backend — that route is what strips the refresh token
 * into an httpOnly cookie before anything reaches this function.
 *
 * FR-225: also fetches GET /v1/profile/me right after, so the auth store's
 * `profileCompleted` is populated from the very first authenticated moment
 * — `/`'s gate (Feature 15) never has to fetch it separately. Feature 29:
 * `hasSeenWelcomeTour` comes off this exact same response too.
 */
export async function verifyOtp(
  phone: string,
  code: string,
): Promise<VerifyResponse> {
  const res = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code }),
  });
  if (!res.ok) {
    throw new ApiRequestError(await parseProblemDetails(res));
  }
  const body = (await res.json()) as VerifyBackendResponse;
  // Set the token first — getProfile's apiFetch call needs it for the
  // Authorization header.
  useAuthStore.getState().setAccessToken(body.accessToken);
  const profile = await getProfile();
  const user: AuthUser = {
    ...body.user,
    profileCompleted: profile.profileCompletedAt !== null,
    hasSeenWelcomeTour: profile.hasSeenWelcomeTour,
  };
  useAuthStore.getState().setSession(body.accessToken, user);
  return { accessToken: body.accessToken, user };
}

// Feature 14 FR-217: must match the real backend's PRIVACY_POLICY_VERSION
// (backend/.env) exactly — no public endpoint currently exposes it, so this
// is intentionally duplicated config, not derived. Open item for a fast
// follow if the two ever drift: a small public GET /v1/legal/... endpoint.
const PRIVACY_POLICY_VERSION =
  process.env.NEXT_PUBLIC_PRIVACY_POLICY_VERSION ?? "v1";

export function acceptBiometricConsent(): Promise<unknown> {
  return apiFetch("/v1/consent/biometric", {
    method: "POST",
    body: JSON.stringify({ policyVersion: PRIVACY_POLICY_VERSION }),
  });
}

interface LivenessSessionResponse {
  status: "PENDING" | "PASS" | "FAIL";
}

export function startLivenessSession(): Promise<LivenessSessionResponse> {
  return apiFetch<LivenessSessionResponse>(
    "/v1/verification/liveness/session",
    { method: "POST" },
  );
}
