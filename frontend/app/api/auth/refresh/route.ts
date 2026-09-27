import { NextResponse } from "next/server";
import { backendFetch, relayProblemDetails } from "@/lib/server/backend-fetch";
import {
  clearRefreshCookie,
  getRefreshCookie,
  setRefreshCookie,
} from "@/lib/session-cookie";

interface RefreshBackendResponse {
  accessToken: string;
  refreshToken: string;
}

/**
 * FR-207/FR-209: reads the httpOnly refresh cookie (never sent by the
 * client — this route reads it server-side), rotates it via the real
 * backend, re-sets the cookie with the new refresh token, and returns only
 * the new access token. Called on every fresh page load (FR-209) and by
 * FR-208's proactive/FR-204's reactive refresh — never takes a request body.
 */
export async function POST() {
  const refreshToken = await getRefreshCookie();
  if (!refreshToken) {
    return NextResponse.json(
      { detail: "No session." },
      { status: 401 },
    );
  }

  const backendResponse = await backendFetch("/v1/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
  });

  if (!backendResponse.ok) {
    await clearRefreshCookie();
    return relayProblemDetails(backendResponse);
  }

  const result = (await backendResponse.json()) as RefreshBackendResponse;
  await setRefreshCookie(result.refreshToken);

  return NextResponse.json({ accessToken: result.accessToken });
}
