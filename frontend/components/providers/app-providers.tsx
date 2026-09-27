"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/auth-store";
import { apiFetch } from "@/lib/api-client";
import { decodeAccessToken } from "@/lib/jwt";
import { getProfile } from "@/lib/queries/profile";
import { refreshAccessTokenOnce } from "@/lib/session-refresh";

// FR-208: proactive refresh at 80% of the access token's remaining life.
const PROACTIVE_REFRESH_FRACTION = 0.8;

interface LivenessStatusResponse {
  livenessStatus: boolean;
}

/**
 * FR-209: on every fresh page load, one silent refresh before rendering any
 * protected content — the httpOnly refresh cookie (not memory, which never
 * survives a reload) is the real source of truth for "is there a session."
 *
 * The real backend's /auth/refresh only returns {accessToken, refreshToken}
 * (backend/src/modules/auth/auth.controller.ts) — no `user` payload, unlike
 * /otp/verify. Re-populating `user` after a reload reuses the already-real,
 * already-tested GET /v1/verification/liveness/status (Feature 1) rather
 * than inventing a new backend "whoami" endpoint for this alone; `id` comes
 * from decoding the fresh access token's own `sub` claim (FR-208's same
 * decode-not-verify precedent).
 */
function AuthRehydrator({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const accessToken = useAuthStore((s) => s.accessToken);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const isLoginRoute = pathname.startsWith("/login");
  // FR-395 (Feature 19, Share My Date): a real trusted contact opening a
  // share link has no session at all, and that's the fully expected case —
  // this page never reads useAuthStore's session either (components/date-share/
  // public-date-view.tsx has no dependency on it), so rehydration is skipped
  // here exactly as it already is for /login, regardless of whether a
  // logged-in visitor's own cookie happens to be present too (FR-393 only
  // requires the *page* render correctly either way, not that this effect
  // run for them). Scoped as narrowly as proxy.ts's own FR-394 exemption.
  const isPublicDateShareRoute = pathname.startsWith("/date/");
  // Feature 28: a real, necessary second gate (proxy.ts is not the only
  // thing standing between a logged-out visitor and these routes) — found
  // by explicit user follow-up before implementation, not assumed safe.
  // Deliberately NOT the same "skip rehydration entirely" treatment as
  // /date/ above: unlike the public date-share view, `/` and these two
  // settings sub-pages are real, ordinary in-app routes an *authenticated*
  // visitor can and does hard-refresh, and skipping the real attempt would
  // wrongly drop a valid session (tab bar disappearing, `user` going null)
  // on a plain reload. The real rehydration attempt below runs completely
  // unchanged for these three routes; only fail()'s redirect-to-login is
  // suppressed, so a genuinely logged-out visitor settles into
  // "unauthenticated" instead of being bounced away.
  const isPublicWhenLoggedOut =
    pathname === "/" ||
    pathname === "/settings/privacy-policy" ||
    pathname === "/settings/terms" ||
    pathname === "/settings/help";
  const skipRehydration = isLoginRoute || isPublicDateShareRoute;

  useEffect(() => {
    let cancelled = false;

    // On /login (or the public date-share route), a failed rehydration is
    // the expected, common case (no session yet, or none needed) — never a
    // redirect. Anywhere else, `proxy.ts` already let the request through on
    // a cookie's mere presence (FR-211); if that cookie turns out to be
    // invalid/expired, this is the real check that catches it and sends the
    // user back, rather than silently rendering protected content with no
    // working session underneath.
    function fail() {
      useAuthStore.getState().clearSession();
      if (!cancelled && !skipRehydration && !isPublicWhenLoggedOut) {
        router.replace("/login");
      }
    }

    async function rehydrate() {
      // `proxy.ts` (FR-211/FR-212) already redirects an authenticated
      // visitor away from /login server-side, before any client JS runs —
      // so a valid session can never reach this point while on /login. The
      // refresh call would always 401 here; skipping it avoids a real,
      // pointless network round-trip and the console noise of a browser
      // logging that "failed" request as an error on every single /login load.
      // The public date-share route has no such server-side guarantee (a
      // real logged-in user can genuinely land here with a valid cookie,
      // FR-393) — skipped anyway, since this route's own content never
      // depends on the result either way.
      if (isLoginRoute) {
        useAuthStore.getState().clearSession();
        return;
      }
      // Deliberately NOT the same unconditional clearSession() as above: an
      // already-authenticated user can reach /date/ via a real in-SPA
      // client-side navigation (proxy.ts has no equivalent guarantee here
      // that it does for /login, FR-393) — blindly clearing would destroy a
      // real, valid in-memory session over nothing more than opening a
      // share link in the same tab. Only normalize status away from
      // "unknown" (the one thing that would otherwise leave this route
      // stuck on AuthRehydrator's blank-screen gate below); an
      // already-real "authenticated"/"unauthenticated" status is left
      // exactly as it is.
      if (isPublicDateShareRoute) {
        if (useAuthStore.getState().status === "unknown") {
          useAuthStore.getState().clearSession();
        }
        return;
      }

      // Shared, de-duplicated with every other refresh call site
      // (lib/session-refresh.ts) — real bug this fixes, found by running
      // this feature's own e2e test twice in a row: React Strict Mode's
      // dev-only double-effect-invocation used to fire two concurrent,
      // uncoordinated refresh calls from this one effect alone, and the
      // refresh token's single-use rotation meant the second one always lost.
      const accessToken = await refreshAccessTokenOnce();
      if (cancelled) return;
      if (!accessToken) {
        fail();
        return;
      }
      const decoded = decodeAccessToken(accessToken);
      if (!decoded) {
        fail();
        return;
      }
      try {
        // FR-225: fetched in parallel, not sequentially — no added latency
        // beyond whichever of the two real calls is slower. Feature 29:
        // profile fetched in full (not the narrower fetchProfileCompleted())
        // so both profileCompleted and hasSeenWelcomeTour come off the same
        // real GET /v1/profile/me response, not two separate round trips.
        const [liveness, profile] = await Promise.all([
          apiFetch<LivenessStatusResponse>("/v1/verification/liveness/status"),
          getProfile(),
        ]);
        if (cancelled) return;
        useAuthStore
          .getState()
          .setSession(accessToken, {
            id: decoded.sub,
            livenessStatus: liveness.livenessStatus,
            profileCompleted: profile.profileCompletedAt !== null,
            hasSeenWelcomeTour: profile.hasSeenWelcomeTour,
          });
      } catch {
        if (!cancelled) fail();
      }
    }

    void rehydrate();
    return () => {
      cancelled = true;
    };
    // Intentionally runs once per app mount, not on every store change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    if (!accessToken) return;

    const decoded = decodeAccessToken(accessToken);
    if (!decoded) return;

    const nowSeconds = Date.now() / 1000;
    const remainingMs = (decoded.exp - nowSeconds) * 1000;
    const delayMs = Math.max(remainingMs * PROACTIVE_REFRESH_FRACTION, 0);

    refreshTimer.current = setTimeout(() => {
      void refreshAccessTokenOnce();
    }, delayMs);

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [accessToken]);

  if (status === "unknown") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background" />
    );
  }

  return <>{children}</>;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <AuthRehydrator>{children}</AuthRehydrator>
    </QueryClientProvider>
  );
}
