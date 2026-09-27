import { useAuthStore } from "./auth-store";
import { ApiRequestError, parseProblemDetails } from "./api-error";
import { refreshAccessTokenOnce } from "./session-refresh";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

if (!API_BASE_URL) {
  throw new Error("NEXT_PUBLIC_API_BASE_URL is not set.");
}

interface ApiFetchOptions extends RequestInit {
  /** Internal — set on the single retry after a reactive refresh (FR-204). */
  _isRetryAfterRefresh?: boolean;
}

/** FR-203: RFC-7807-aware, typed fetch wrapper against the real backend. */
export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { _isRetryAfterRefresh, ...init } = options;
  const accessToken = useAuthStore.getState().accessToken;

  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  // A FormData body (profile photo upload, lib/queries/profile.ts) needs
  // the browser to set its own multipart boundary — forcing JSON here would
  // silently break every multipart upload's Content-Type.
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (response.ok) {
    // DELETE /v1/profile/photos/:id (Feature 15) returns 200 with no body
    // (Nest's default for a handler with no @HttpCode) — .json() on a
    // genuinely empty body throws, so check for real content first rather
    // than assuming every 2xx response is non-empty JSON.
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  if (response.status === 401 && !_isRetryAfterRefresh) {
    const refreshedToken = await refreshAccessTokenOnce();
    if (refreshedToken) {
      return apiFetch<T>(path, { ...options, _isRetryAfterRefresh: true });
    }
    useAuthStore.getState().clearSession();
    if (typeof window !== "undefined") {
      // A plain module function, not a component/event handler — no
      // useRouter() available. A hard navigation is an acceptable, simple
      // fallback for this specific rare path (session definitively dead,
      // reactive-refresh-after-401 also failed); the primary UX (FR-209's
      // proactive refresh, AuthRehydrator's own router.replace on a failed
      // rehydration) is a soft client-side redirect, not this one.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/login";
    }
  }

  const problem = await parseProblemDetails(response);
  throw new ApiRequestError(problem);
}
