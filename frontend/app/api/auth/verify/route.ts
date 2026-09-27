import { NextResponse } from "next/server";
import { backendFetch, relayProblemDetails } from "@/lib/server/backend-fetch";
import { setRefreshCookie } from "@/lib/session-cookie";

interface VerifyOtpBackendResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; livenessStatus: boolean };
}

/**
 * FR-207: proxies POST /v1/auth/otp/verify server-side so the refresh token
 * never reaches client-side JavaScript at all — it's stripped out here and
 * set as an httpOnly cookie; only {accessToken, user} goes to the browser.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { phone: string; code: string };

  const backendResponse = await backendFetch("/v1/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!backendResponse.ok) {
    return relayProblemDetails(backendResponse);
  }

  const result = (await backendResponse.json()) as VerifyOtpBackendResponse;
  await setRefreshCookie(result.refreshToken);

  return NextResponse.json({
    accessToken: result.accessToken,
    user: result.user,
  });
}
