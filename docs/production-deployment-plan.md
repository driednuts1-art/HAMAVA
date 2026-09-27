# Production Deployment Plan — DRAFT, awaiting explicit approval

**Status: planning only.** Per explicit instruction, nothing in this document has been executed — no account created, no domain purchased, no `git init` run, no money spent. Every action below is either informational, or something Claude Code can do once approved, or something that requires the user directly (marked in §2).

## 0. Critical pre-requisites found during this planning pass (read this first)

Two blocking findings surfaced while researching this plan that change what "real production deployment" can mean right now:

### 0.1 The backend will refuse to boot in real production mode today

`backend/src/common/production-safety/production-safety.service.ts` throws and crashes the process on startup if `NODE_ENV=production` and any vendor provider is still a mock. Checked directly: **`OTP_PROVIDER` (SMS) and `LIVENESS_PROVIDER` are both still mocks**, blocked on legal review that hasn't happened yet (`docs/roadmap.md` "Deferred vendor integrations" — OTP blocked on sanctions/export-control review, `legal-checklist.md` Part E; Liveness blocked on a DPIA, `legal-checklist.md` Part B). This is not a config oversight, it's a deliberate safety gate — it exists specifically to stop mock identity verification from ever silently reaching real users.

**Practical consequence**: `NODE_ENV=production` cannot boot at all until real OTP + Liveness vendors are wired in, which is itself blocked on legal review, not engineering work. Two honest paths forward:

- **(a) Infra dry-run now, real launch later**: deploy with `NODE_ENV` set to something other than the literal string `production` (the guard checks that exact string) — e.g. `staging`. This proves the whole hosting/DNS/env-var pipeline works end-to-end with real infrastructure, but it is **not a real public launch**: OTP codes are logged, not sent as SMS, and liveness always auto-passes. This must never be exposed to real end users beyond an internal test group who understand this explicitly, and the plan below is written with this distinction in mind everywhere it matters.
- **(b) Wait for legal review**, then swap in real OTP/Liveness vendors, then deploy with real `NODE_ENV=production`. This is the only path to an actual public launch.

Nothing here should be read as a recommendation to route around the guard for a real launch — that's exactly the scenario it was built to prevent.

### 0.2 The project root is not a git repository, and has no `.gitignore` — several loose files there look sensitive

`git status` at the project root returns "not a git repository." `.github/workflows/ci.yml` already documents this itself (see §5). There is no root-level `.gitignore` at all — only `backend/.gitignore` and `frontend/.gitignore`, both of which correctly exclude their own `.env`/`.env.local` files.

Sitting loose at the project root, with **no git protection of any kind**, are (among ordinary personal/reference files):

- `کدها و اطلاعات حساس.txt` — filename literally means "codes and sensitive information." Not opened by this session; flagged by name only.
- `TURN .txt` — likely contains Cloudflare TURN credentials given the project's own `CLOUDFLARE_TURN_KEY_ID`/`CLOUDFLARE_TURN_API_TOKEN` env vars. Not opened by this session; flagged by name only.
- `important info.pdf`, `hamava-legal-business-checklist.md`, `hamava-project-brief.md`, and ~24 personal WhatsApp photos + a `New folder` of more photos.

**Real risk**: the moment `git init` + `git add` happens at the project root (needed for any of the hosting options below, since they all deploy from a git push), every one of these files would be swept into the first commit unless explicitly excluded first. A source-code scan of `backend/src` and `frontend/app|components|lib` found **zero hardcoded secrets in actual code** — the risk is entirely these loose root-level files, not the codebase itself.

**Recommended fix, to happen as the very first step of actual execution (not done yet)**: create a root `.gitignore` that explicitly excludes the two named files above plus the photo files, *before* running `git init`/`git add`, so they're never staged in the first place — no need to move, rename, or delete anything the user hasn't reviewed. The user should personally confirm what's actually inside those two named files before deciding whether they even belong in this project folder at all; this plan does not open them.

---

## 1. Hosting options

**Unchanged**: Neon (Postgres), Upstash (Redis), Cloudflare R2 (storage) or whichever S3-compatible vendor is already configured, Cloudflare Realtime TURN, and OpenAI all stay exactly as they are — these are already managed cloud services, not something running on the dev machine. They just need their real connection strings/keys entered as environment variables on whichever host is chosen below.

### Backend (NestJS — needs a real, persistent process: WebSocket chat gateway + Redis pub/sub, not a serverless function)

| Platform | ~Monthly cost (small single instance) | Pros | Cons |
|---|---|---|---|
| **Railway** | ~$5 (Hobby, single dev) to ~$20 (Pro, includes $20 usage credit) + metered CPU/RAM/egress on top | Simplest setup of the three; usage-based billing scales down when idle; strong Docker/Nixpacks auto-build support; good WebSocket support out of the box | No free tier; costs are variable/metered, less predictable than a flat price; smaller company than the other two |
| **Render** | Starter web service $7/mo, Standard $25/mo; a Postgres/Redis add-on would be extra if not using Neon/Upstash (not needed here) | Predictable flat pricing per service; mature, well-documented; good free-tier trial period for the initial test | Per-service pricing adds up (web service + any worker would be billed separately); April 2026 repricing cut included egress significantly (5GB Hobby / 25GB Pro before $0.15/GB) |
| **Fly.io** | Pure pay-per-second, no base plan fee — very low for a small always-on instance, roughly comparable to or cheaper than Railway at this scale | Full Docker control; global edge deployment if ever needed; no seat/plan fee | Steeper learning curve (fly.toml, flyctl CLi); no managed "just push and it works" experience the other two have |

**Recommendation**: **Railway** for the initial deploy — simplest path from "NestJS app with a Dockerfile/npm build" to "running, HTTPS, env vars set," good WebSocket support for the chat gateway, and the metered pricing is genuinely cheap at Hamava's current (pre-launch) traffic level. Render is the natural fallback if Railway's usage-based billing feels unpredictable once there's real traffic.

### Frontend (Next.js)

| Platform | ~Monthly cost | Notes |
|---|---|---|
| **Vercel** | Hobby: free — but **Vercel's Hobby plan terms restrict it to personal, non-commercial use**, which a real dating app is not. **Pro: $20/user/month**, includes $20 usage credit, 1TB data transfer, 10M edge requests | Built by the makers of Next.js — zero-config deploys, automatic preview URLs per PR/branch, the standard choice for a Next.js app. Effectively the only serious option to seriously compare against for this specific framework; Render/Railway can also host a Next.js app in a Node container, but lose Vercel's edge/ISR optimizations that this app isn't using anyway (no need to over-index on that unless a specific page needs it later). |

**Recommendation**: **Vercel Pro** ($20/month) once this is a real, public production deployment — the Hobby plan is not appropriate for a commercial product per its own terms. For the "infra dry-run" staging deploy (§0.1a), Hobby is fine as a temporary step before flipping to Pro for the real launch.

**Estimated combined baseline**: roughly **$25–45/month** (Railway ~$5–20 + Vercel Pro $20) before any real user-driven usage overages, on top of whatever Neon/Upstash/R2/OpenAI/Cloudflare already cost.

Sources: [Render vs Railway vs Fly.io: Pricing Compared (2026)](https://dev.to/pavel-hostim/render-vs-railway-vs-flyio-pricing-compared-2026-2e5p), [Railway vs Render vs Fly.io: Benchmarks & Pricing (2026)](https://techsy.io/en/blog/railway-vs-render-vs-fly-io), [Vercel Pricing 2026: Hobby Free, Pro $20/developer/month](https://costbench.com/software/developer-tools/vercel/), [Vercel Hobby Plan (official docs)](https://vercel.com/docs/plans/hobby)

---

## 2. Who does what

| # | Step | Who | Notes |
|---|---|---|---|
| 1 | Create a root `.gitignore` excluding the sensitive/personal loose files (§0.2) | **Claude Code** | Pure file-authoring, no account needed |
| 2 | `git init` at the project root, first commit | **Claude Code** | After #1 is in place and reviewed |
| 3 | Create a GitHub account (if none exists) / create a new private repo | **User** | Account creation + payment/identity are always user-only actions |
| 4 | Push the local repo to the new GitHub remote | **Claude Code** (needs the remote URL from the user first) | |
| 5 | Create a Railway account, link GitHub | **User** | Account creation |
| 6 | Create a Vercel account, link GitHub | **User** | Account creation |
| 7 | Configure the backend service on Railway (build command, start command, port) | **Claude Code** (guidance) + **User** (clicking through Railway's own UI, since Claude Code has no browser access to a third-party dashboard requiring the user's login) | |
| 8 | Configure the frontend project on Vercel (framework preset, build command) | Same split as #7 | Vercel auto-detects Next.js; minimal manual config expected |
| 9 | Enter real production environment variables (`DATABASE_URL`, `OPENAI_API_KEY`, `JWT_ACCESS_SECRET`, etc.) into Railway's and Vercel's own env-var panels | **User** (these are secrets; see §3 — Claude Code should not be asked to type real production secrets into a third-party web dashboard) | Claude Code can prepare the exact, complete list of variable names + one-line descriptions of what each needs to contain, from `backend/.env.example` |
| 10 | Purchase a domain | **User** | Payment required — explicit-permission/prohibited-action boundary either way |
| 11 | Point DNS at Railway/Vercel per their own instructions | **User** (DNS panel access) + **Claude Code** (can tell you exactly which records to add, once the domain is chosen) | |
| 12 | Verify the deployed staging environment end-to-end (signup, discovery, chat, calls) | **Claude Code**, using the browser tool against the real deployed URL | Once steps 1–11 are live |
| 13 | Decide when real OTP/Liveness vendors are ready (post legal review) and flip to real `NODE_ENV=production` | **User** (legal sign-off) then **Claude Code** (the actual vendor-swap code, per `docs/roadmap.md` §1/§2) | This is the actual "go live to real users" gate, separate from "infra is deployed" |

---

## 3. Secrets security

**Where production secrets go**: environment variables entered directly into Railway's and Vercel's own dashboard env-var panels — never committed to the repo, never hardcoded in source. This matches how `backend/.env`/`frontend/.env.local` already work locally; production is the same pattern, different storage location. `backend/.env.example` is the authoritative list of every variable name the backend needs — Claude Code can hand the user this exact list to fill in on Railway without ever needing to see or type the real values itself.

**Current state, checked directly, not assumed**:
- ✅ No git repository exists yet anywhere in the project — zero secrets have ever been committed to any git history, because there is no history.
- ✅ `backend/.gitignore` and `frontend/.gitignore` both already correctly exclude their real `.env`/`.env.local` files — these nested `.gitignore` files remain effective even after a root-level `git init`.
- ✅ A direct grep of `backend/src` and `frontend/app|components|lib` for hardcoded API-key-shaped strings (`sk-...`, AWS-key-shaped strings, embedded Postgres connection strings) found **nothing** — no secrets hardcoded in actual application code.
- ⚠️ See §0.2 — loose root-level files with no git protection at all, needing a root `.gitignore` before the first `git init`/`git add`.
- ⚠️ `docs/roadmap.md`'s own Production Readiness Checklist already flags: no OpenAI billing/usage-alert monitoring exists, and the account has run dry twice during development. Worth setting up a real low-balance alert (OpenAI's own dashboard feature) as part of this deployment, not after.

**Recommendation for a future step, not blocking today's plan**: once this is a real production deployment with real users, consider a dedicated secrets manager (Railway/Vercel's own env-var store is reasonable for launch — this is what most small production apps use — but `docs/roadmap.md` already notes a real secrets manager should exist before wiring real e2e-test credentials into CI).

---

## 4. Domain suggestions

No specific domain was requested, so here are options built on the "Hamava" (هم‌آوا — "in harmony/unison") brand. **Availability changes constantly — these are suggestions to check at the time of purchase via any registrar (Namecheap, Cloudflare Registrar, etc.), not confirmed-available names:**

- `hamava.com` — the obvious first choice, worth checking first
- `hamava.app` — `.app` requires HTTPS by default (Google-run TLD), a nice fit for a mobile-first product, and often more available than `.com` for short brand names
- `hamava.co`
- `gethamava.com`
- `joinhamava.com`
- `hamava.love` / `hamava.dating` — on-the-nose for a dating app, memorable, sometimes cheaper than generic TLDs
- `meethamava.com`

---

## 5. CI/CD review

`.github/workflows/ci.yml` already documents its own current state in its own header comment (written 2026-09-18, still accurate): lint + typecheck + fully-mocked unit tests run on every push/PR to `main`, for both backend and frontend, plus a dependency-vulnerability audit job. **It is currently inert** — it can't run at all, because the project isn't a git repository yet and has no GitHub remote to trigger from. It intentionally has **no deployment step** — by design, since no production infrastructure existed yet.

**What this plan changes, once approved and executed**: pushing the repo to GitHub (§2, steps 2–4) makes this workflow start running for real, exactly as already written — no changes needed to the file itself for CI (lint/typecheck/unit tests/audit) to start working.

**What "CD" (actual deployment) looks like, and a real decision point**: Railway and Vercel both have their own native GitHub integration — once a repo is connected, they redeploy automatically on every push to the configured branch, with zero GitHub Actions changes needed. Two options:

- **(a) Let Railway/Vercel's own git integration handle deploys directly** (the simpler, default path for both platforms) — `ci.yml` stays exactly as a pure quality gate, deploys happen independently via each platform's own webhook. A failing CI check would not by itself block a deploy unless branch protection rules are added on GitHub requiring CI to pass before merge to `main`.
- **(b) Add an explicit deploy job to `ci.yml`** that only runs after the lint/test/audit jobs succeed, calling Railway's/Vercel's CLI or API — this makes "CI passing" a hard gate before any deploy, at the cost of a bit more workflow complexity.

**Recommendation**: start with (a) — it's what both platforms are built for, needs no workflow changes, and is trivial to layer branch-protection rules on top of later if a hard gate is wanted. Not something to decide today; can be revisited once the repo is actually live on GitHub.

**Left deliberately unaddressed, matching the file's own existing comment**: wiring the real e2e suites (backend Jest e2e, frontend Playwright) into CI needs real Neon/Upstash/OpenAI/storage/TURN credentials as GitHub Actions secrets — a separate decision (cost of OpenAI calls on every push, which environment) that this deployment plan doesn't resolve, since it's about getting infrastructure live, not about CI scope.

---

## Summary — what happens next

This document is a plan only. Waiting for explicit approval before any of the following starts: creating a root `.gitignore`, running `git init`, creating any account on GitHub/Railway/Vercel, purchasing a domain, or entering any real secret anywhere.
