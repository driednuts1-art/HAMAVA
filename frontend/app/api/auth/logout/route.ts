import { NextResponse } from "next/server";
import { backendFetch } from "@/lib/server/backend-fetch";
import { clearRefreshCookie, getRefreshCookie } from "@/lib/session-cookie";

/**
 * FR-210: revokes the session server-side first (real backend /auth/logout),
 * then clears the httpOnly cookie. Clearing the in-memory access token is
 * the client's own responsibility, done only after this call succeeds
 * (lib/auth-store.ts's clearSession(), invoked by the calling component) —
 * so a network failure here never leaves the client believing it's logged
 * out while the server still considers the session valid.
 */
export async function POST() {
  const refreshToken = await getRefreshCookie();
  if (refreshToken) {
    await backendFetch("/v1/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    });
  }
  await clearRefreshCookie();
  return new NextResponse(null, { status: 204 });
}
