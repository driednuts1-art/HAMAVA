// Server-side-only helper — the three auth Route Handlers under
// app/api/auth/*/route.ts are the only frontend code that ever sends a
// refresh token to the real backend (FR-207). Never imported from client code.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

if (!API_BASE_URL) {
  throw new Error("NEXT_PUBLIC_API_BASE_URL is not set.");
}

export async function backendFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${API_BASE_URL}${path}`, { ...init, headers });
}

/** Relays a real backend RFC-7807 error response verbatim (status + body). */
export async function relayProblemDetails(
  backendResponse: Response,
): Promise<Response> {
  const body = await backendResponse.text();
  return new Response(body, {
    status: backendResponse.status,
    headers: { "Content-Type": "application/problem+json" },
  });
}
