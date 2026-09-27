import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const isDev = process.env.NODE_ENV === "development";

// FR from the technical due-diligence audit (2026-09-18): no CSP or security
// headers existed anywhere in this app. Deliberately the "without nonces"
// shape from Next's own CSP guide (node_modules/next/dist/docs/.../
// content-security-policy.md) rather than a nonce-based one — nonces force
// every page into dynamic rendering (no static optimization/ISR at all),
// a real, large tradeoff this app has no stated need to make yet.
// style-src needs 'unsafe-inline' because framer-motion (used throughout
// discovery/matches/calls) animates via inline `style` attributes, which
// CSP's style-src also governs — there is no nonce/hash path for those
// without a much larger rework. script-src needs 'unsafe-inline' for the
// same non-nonce reason (Next's own framework bootstrap script is inlined).
// connect-src must list this app's own two real, non-same-origin dependencies:
// the backend API/WebSocket origin (NEXT_PUBLIC_API_BASE_URL, both http(s)
// and its ws(s) form for Socket.IO) and the real presigned photo/video
// storage origin (NEXT_PUBLIC_STORAGE_ORIGIN) — every `<img>` in this app
// (discovery cards, matches, chat, calls, date-share) points directly at a
// presigned URL on that origin, confirmed by reading every image call site.
// *.cloudflare.com covers the real TURN/STUN relay hostnames Calls (Feature
// 13/18) connects to at runtime, which vary per credential and aren't
// knowable statically.
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
const apiOrigin = new URL(apiBaseUrl).origin;
const apiWsOrigin = apiOrigin.replace(/^http/, "ws");
const storageOrigin = process.env.NEXT_PUBLIC_STORAGE_ORIGIN ?? "";

const cspDirectives = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' blob: data:${storageOrigin ? ` ${storageOrigin}` : ""}`,
  "font-src 'self'",
  `connect-src 'self' ${apiOrigin} ${apiWsOrigin} https://*.cloudflare.com wss://*.cloudflare.com`,
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
];
// Real bug, caught by an actual production-build Lighthouse run (2026-09-18)
// that a `next dev`-only e2e regression could never have caught: this used
// to be added whenever `!isDev`, which made the BROWSER itself rewrite
// every http:// request on the page — including this app's own API calls to
// `apiOrigin` — to https://. Since this backend has no real TLS listener at
// all yet (confirmed: `NEXT_PUBLIC_API_BASE_URL` is plain http:// in every
// environment this project has), that silently broke `AuthRehydrator`'s own
// profile/liveness fetches in a real `next build && next start` run — both
// requests failed at the network level (status -1), the app never finished
// authenticating, and it redirected to /login. Gated on the API origin
// itself actually being https: now, not on NODE_ENV, so this only ever
// activates once there's a real HTTPS backend to match.
if (apiOrigin.startsWith("https:")) cspDirectives.push("upgrade-insecure-requests");
const cspHeader = cspDirectives.join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: cspHeader },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // Real, deliberate exceptions: this app genuinely uses camera+mic (Feature
    // 13/18 calls, liveness capture) — a blanket deny would break those.
    value: "geolocation=(), browsing-topics=()",
  },
  // HSTS is a real no-op over plain HTTP dev but must be set for any real
  // production deployment (which the audit confirms doesn't exist yet) —
  // included now so it's not another thing forgotten at deploy time.
  ...(isDev
    ? []
    : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]),
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },

  // Real, reproducible finding while writing Feature 17's e2e suite: the
  // dev-mode route indicator (default position bottom-left) sits directly
  // over this feature's bottom-docked message-compose bar, silently
  // swallowing every click on the real send button in a real browser —
  // not a rendering bug in this app, but a genuine collision with Next.js's
  // own dev-only chrome. Compile/runtime errors still surface elsewhere
  // (the terminal, the browser console) with this off, per Next's own docs.
  devIndicators: false,

  // Temporary, dev-only: Next.js blocks cross-origin requests to dev
  // assets/HMR by default (real 403s on every /_next/static/* request,
  // confirmed directly via the browser console — not guessed), which is
  // exactly what produced the blank page when this app was opened through
  // a real Cloudflare quick tunnel for real device testing. `*.trycloudflare.com`
  // covers this and any future tunnel restart (a fresh random hostname each
  // time); remove once real device testing over a public tunnel is done.
  allowedDevOrigins: ["*.trycloudflare.com"],
};

// Phase 2 foundation (docs/i18n-rtl-migration-scope.md §2/§4): wires
// frontend/i18n/request.ts's message loading into the Next.js build —
// required by next-intl even though this app has exactly one locale today.
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

export default withNextIntl(nextConfig);
