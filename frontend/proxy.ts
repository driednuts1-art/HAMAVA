import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// FR-207: the httpOnly cookie set by /api/auth/verify and /api/auth/refresh
// (lib/session-cookie.ts). httpOnly only blocks *browser JS* (document.cookie)
// from reading it — Proxy runs server-side and reads the real Cookie header,
// so no separate non-httpOnly marker cookie is needed.
import { REFRESH_COOKIE_NAME } from "@/lib/session-cookie";

/**
 * FR-211/FR-212: a coarse, fast gate on the refresh cookie's mere presence —
 * not its validity (this runs on the Edge/Node runtime, which never holds
 * the JWT secret), and explicitly NOT a security boundary (docs/requirements.md
 * Feature 14 §8). The real authorization boundary is every backend
 * endpoint's own JwtAuthGuard, unchanged.
 *
 * Named `proxy.ts`, not `middleware.ts` — Next.js 16 renamed the file
 * convention (functionality is identical); see AGENTS.md's warning about
 * this project's Next.js version and node_modules/next/dist/docs/.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(REFRESH_COOKIE_NAME);

  const isLoginRoute = pathname.startsWith("/login");
  // FR-394 (Feature 19, Share My Date): the one other genuinely public
  // route in this app — a trusted contact opening a real share link has no
  // account and no cookie at all. Scoped as narrowly as `/date/` itself
  // (not a broadened matcher) so every other protected route keeps its
  // exact current behavior; see docs/requirements.md Feature 19 §9.
  const isPublicDateShareRoute = pathname.startsWith("/date/");
  // Feature 28 (FR-495/FR-497): "/" is now dual-purpose — the real
  // discovery screen for an authenticated visitor (unchanged), a real
  // public landing page for everyone else. The two legal placeholder pages
  // are exact-path matches only, never a `/settings/`-prefix — a broader
  // matcher would also unprotect privacy toggles, account deletion, etc.,
  // exactly the risk FR-394's own narrow-exemption discipline exists to
  // avoid. See docs/requirements.md Feature 28 §2.
  const isPublicRoot = pathname === "/";
  // Found during implementation, not in the original requirements.md draft:
  // the landing page's own footer "تماس با ما" link points to /settings/help
  // (the closest real, existing support-content analog — no real contact
  // channel exists anywhere in this codebase). Left unexempted, that link
  // would bounce a logged-out visitor straight to /login, breaking the very
  // link this feature adds. Same exact-path reasoning as the two legal
  // pages below: static, auth-independent content (confirmed by reading
  // HelpCenterPage/FaqAccordion — neither reads useAuthStore).
  const isPublicLegalPage =
    pathname === "/settings/privacy-policy" ||
    pathname === "/settings/terms" ||
    pathname === "/settings/help";

  if (
    !hasSession &&
    !isLoginRoute &&
    !isPublicDateShareRoute &&
    !isPublicRoot &&
    !isPublicLegalPage
  ) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (hasSession && isLoginRoute) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
