import { useAuthStore } from "./auth-store";

let refreshInFlight: Promise<string | null> | null = null;

/**
 * The ONE place that calls POST /api/auth/refresh — every caller (the
 * reactive 401 retry in api-client.ts, AuthRehydrator's on-mount
 * rehydration, and its FR-208 proactive timer) goes through this shared,
 * de-duplicated function instead of firing its own raw `fetch()`.
 *
 * Real bug this fixes, found by running Feature 15's own e2e test twice in
 * a row, not assumed away: the refresh token is single-use/rotating
 * (backend/src/modules/auth/tokens/token.service.ts::rotateRefreshToken —
 * the old session is revoked the instant it's used). React's Strict Mode
 * double-invokes effects in dev, so AuthRehydrator's rehydration effect
 * used to fire two concurrent, uncoordinated `/api/auth/refresh` calls on a
 * single mount — both read the same pre-rotation cookie value, the first to
 * finish rotated it successfully, and the second (now using an already-
 * revoked token) got a real 401 and kicked the user back to /login. Not
 * only a dev-mode artifact either — the same race is reachable in
 * production from two browser tabs refreshing near-simultaneously, or a
 * fast double-navigation. Coalescing every caller onto one in-flight
 * promise makes only one real request happen no matter how many callers
 * ask for a refresh at once.
 */
export async function refreshAccessTokenOnce(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = fetch("/api/auth/refresh", { method: "POST" })
      .then(async (res) => {
        if (!res.ok) return null;
        const body = (await res.json()) as { accessToken: string };
        useAuthStore.getState().setAccessToken(body.accessToken);
        return body.accessToken;
      })
      .catch(() => null)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}
