import { cookies } from "next/headers";

// FR-207: the ONLY place the real refresh token exists in the frontend —
// httpOnly, Secure, SameSite=Lax. Never read by client-side JS, never sent
// to the real backend directly (only these Route Handlers proxy it).
export const REFRESH_COOKIE_NAME = "hamava_refresh_token";

// JWT_REFRESH_EXPIRES_IN=30d (backend/.env) — the cookie's own lifetime
// mirrors the real token's, so it never outlives what it protects.
const REFRESH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export async function setRefreshCookie(refreshToken: string): Promise<void> {
  const store = await cookies();
  store.set(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
  });
}

export async function getRefreshCookie(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(REFRESH_COOKIE_NAME)?.value;
}

export async function clearRefreshCookie(): Promise<void> {
  const store = await cookies();
  store.delete(REFRESH_COOKIE_NAME);
}
