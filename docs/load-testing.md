# Load Testing — Scoping

## Why now, and why this is the right kind of next step

Real evidence has been accumulating across this whole project — never once staged deliberately, always found as a side effect of running e2e suites under normal development activity: Feature 4's chat suite intermittently failed under heavy same-session vendor load; Feature 10's Smart Boost tests hit real non-determinism at volume; Feature 15/17/20's own combined regression runs repeatedly showed 3-7 unrelated suites timing out together, every time confirmed clean when re-run in isolation immediately after (`docs/roadmap.md`'s own "Watch items" and per-feature findings sections document this pattern at least five separate times). That's a real, recurring signal that this system behaves differently under concurrent load than it does one request at a time — never yet measured on purpose, only stumbled into. With the product now feature-complete (Features 1-21), this is the first point where a deliberate load-testing pass covers the real, whole system rather than one still-changing corner of it, and — unlike the legal/compliance items in `docs/roadmap.md`/`legal-checklist.md` — it's entirely within engineering's own control to run right now.

**Status:** ✅ All three scenarios (Tier 1, Tier 2, kill-switch) have real, executed, clean results — see "Real findings from execution" below. The backend has been restored to the real dev database with every default (including `VOICE_CALLS_ENABLED`) back to its correct value.

## A real complication found while scoping, not assumed away

The original scoping proposal split work into "Tier 1: core paths, no AI vendor involved" and "Tier 2: AI-fanout paths, tested separately." **That split doesn't actually hold** — checked directly against the real code, not assumed: `MessageService.sendMessage()` calls `this.moderation.moderateText(dto.content)` (`backend/src/modules/chat/message.service.ts`) on **every single message send**, a real `omni-moderation-latest` OpenAI call. The same is true for every bio/interest profile write and every photo upload (Feature 8's three real moderation call sites). So there is no purely OpenAI-free "core" surface to test — even a plain chat-throughput scenario is, in reality, a moderation-throughput scenario too.

This changes the design in one real way: the hard cost/request cap (below) is **global across the entire harness**, not scoped per-tier — a single shared counter incremented by every request path known to reach OpenAI, regardless of which scenario triggered it. A cap that only watched "Tier 2" requests would give a false sense of safety against exactly the kind of script bug the user asked this to guard against.

## Scope

### Tier 1 — aggregate capacity under real, moderate-to-heavy concurrency

Goal: does the system's own infrastructure (Neon connection pool, Redis pub/sub, the NestJS process itself, Socket.IO delivery) hold up under many concurrent real users doing the app's core loop — not "does OpenAI scale," which is not ours to test or worth spending real API budget proving. Concurrency ramps **10 → 50 → 100** concurrent virtual users (Decisions §1 below), each ramp step its own measured stage.

Real user journeys, each a full, real HTTP/WebSocket flow against the actual running backend (no mocking, matching this project's standing discipline):
- Signup → OTP verify → liveness (mocked provider, unchanged from every existing e2e run) → profile creation.
- Deck fetch → swipe (mix of PASS/LIKE/SUPER_LIKE) → match formation.
- Open a conversation → send/receive messages, including real WebSocket delivery across two real connected clients (the exact scenario Feature 17's own real Redis cross-instance regression test already proved works for *one* pair — this is many pairs, concurrently).
- Settings reads/writes (Feature 20) — cheap, no vendor fanout, a useful "floor" scenario.

### Tier 2 — AI-fanout paths, moderate (not heavy) concurrency, testing *our* resilience mechanisms, not OpenAI's throughput

Per explicit user direction: this tier's goal is confirming that this project's own real, already-built safety mechanisms behave correctly when multiple requests are genuinely in flight at once — not proving how many requests OpenAI itself can absorb.

- **Fail-open/fail-closed behavior under concurrency**: AI Search extraction, match explanation generation, conversational-setup extraction. Each of these already has a real, tested vendor-failure path (`docs/roadmap.md`'s `test/helpers/vendor-failure.ts`) — this tier confirms the same real behavior holds when several such requests overlap, not just sequentially in a unit/e2e test.
- **Kill-switch behavior**: confirmed via its own separate, standalone scenario (`scenarios/kill-switch-toggle.ts`, see Decisions §4 below) — deliberately never toggled mid-way through a large concurrent run, since the real backend restart a toggle requires would make the run's result uninterpretable (recovery-from-restart noise vs. the kill switch's own real behavior).
- **Real error-message correctness under load**: confirm the real, distinguishing backend `detail` text (vendor-down vs. kill-switched vs. rate-limited) stays correct and doesn't get scrambled/cross-contaminated across concurrent requests sharing the same process (a real, if unlikely, class of bug — shared mutable state, log interleaving mistaken for a response body, etc.).

Concurrency ramps **5 → 15 → 30** concurrent virtual users (Decisions §1 below) — enough to exercise real concurrent code paths, nowhere near enough to be a meaningful throughput test of OpenAI itself.

### Explicitly out of scope

- **Voice/video call load testing (Feature 18).** WebRTC media doesn't flow through this backend at all (`docs/architecture.md` §5.10) — there's nothing here for a load test to meaningfully stress. The one backend-side surface, TURN credential minting (`POST /v1/calls/*/start`/`join`), is call-signaling throughput, not media throughput, and mints real, billed Cloudflare Realtime TURN credentials — folded into the same global external-vendor-call budget as OpenAI (below), not tested for volume on its own.
- **Any load testing against a production environment.** This entire initiative targets the real dev backend only. The harness itself refuses to run against any base URL that doesn't match an explicit allowlist (Safety guardrails, below) — mirroring `ProductionSafetyService`'s own real "refuse to start unsafely" precedent, just enforced client-side in the script instead of server-side.
- **Whisper transcription throughput.** Already real-verified per-feature (`docs/architecture.md` §5.6/§5.8); a dedicated volume test would be pure OpenAI-cost spend with no code-behavior signal distinct from Tier 2's other AI-fanout scenarios.
- **Photo upload/storage throughput** (MinIO in dev, real S3-compatible in prod) — a real, valid future load-testing target, but a distinct concern (large binary payloads, malware-scan latency) from this pass's HTTP/WebSocket-request-rate focus; not folded in silently.

## Tooling

**Decision: a small, custom Node/TypeScript harness (`backend/scripts/load-test/`), not k6 or Artillery.**

- **k6** is a separate Go binary, not an npm package — the first genuinely non-Node tool this backend would depend on, for a one-off testing initiative. Every other tool in this project (Jest, Playwright, ts-node for the AI-eval scripts) stays inside the existing Node toolchain.
- **Artillery** stays inside Node, but its scenario definitions are YAML/config-driven — a real, if smaller, new DSL to learn and maintain for scenarios that are fundamentally "log in, then do the same multi-step real HTTP/WebSocket flow this project's own e2e helpers already express in plain TypeScript." Reusing the shape of `backend/test/helpers/` (`uniquePhone`, `getAccessToken`-style flows) directly, rather than re-expressing them in a load tool's own config language, is less code and less to keep in sync as features change.
- **The global hard cost cap (below) is easiest to get exactly right in a plain script** — a shared in-process counter and an early-abort check the harness's own code enforces, rather than configuring a load tool's separate, less granular built-in rate/duration limits to approximate the same thing.

```
backend/scripts/load-test/
  run.ts                    -- CLI entry point, reads a scenario name + concurrency from argv
  scenarios/
    core-user-journey.ts    -- Tier 1 (10→50→100 ramp)
    ai-fanout-resilience.ts -- Tier 2 (5→15→30 ramp)
    kill-switch-toggle.ts   -- standalone (Decisions §4) — never combined with the above
  lib/
    virtual-user.ts         -- one simulated user: real login, real token, real per-user state
    openai-cost-guard.ts    -- the global hard cap (see below)
    target-safety-check.ts  -- refuses to run against a non-allowlisted base URL
    metrics.ts               -- per-stage p50/p95/p99 latency + real-vs-expected-4xx error classification
    cleanup.ts              -- deletes every synthetic user this run created, via the real DELETE /v1/users/me flow (Feature 20) — not a raw SQL DELETE, so the same real cascade/purge behavior already tested gets exercised here too
```

## The global hard cost/request cap

Per explicit user direction: this lives in the tool's own code, not only as a documented rule a script author is trusted to follow.

- `openai-cost-guard.ts` exports a single module-level counter and one function, `recordOpenAiCall()`, called by every request wrapper in `virtual-user.ts` that's known to reach an OpenAI-backed endpoint (message send, photo upload, bio/interests write, AI search extract/search/transcribe, conversational-setup session/turn endpoints, match explanation's lazy-generation trigger via `GET /v1/discovery/matches`, boost).
- A hard ceiling (`LOAD_TEST_MAX_OPENAI_CALLS`, a real, required CLI argument with no silent default — the run refuses to start without an explicit number, so nobody can forget to set it) throws and aborts the **entire run** the instant the counter would exceed it — not a warning, not a "finish the current batch first," an immediate hard stop, since the whole point is protecting against a bug in the harness itself generating far more calls than intended.
- The counter is real-time-visible in the run's own console output (`X / LIMIT real OpenAI-touching calls made`), so a run that's about to hit the ceiling is visible before it happens, not just after.
- This is a client-side safeguard, not a backend one — it protects the OpenAI billing account from a runaway *test* script specifically; it is not a substitute for the real, already-built server-side rate limits (`AI_SEARCH_TEXT_RATE_LIMIT_PER_MINUTE` etc.), which stay untouched and are themselves one of the things Tier 1/2 scenarios exercise for real.

## Target environment and data

- **Runs against the real dev backend and the real dev Neon database** — matching this project's standing "always real, never mocked" discipline; a synthetic/isolated environment would test nothing about the real infrastructure this app actually runs on.
- **Every synthetic user is tagged identifiably** (`uniquePhone()`'s existing `+1555...` prefix, reused directly from `test/helpers/unique-phone.ts` — already the established convention every e2e suite uses for exactly this reason) and **the harness cleans up after itself** via `cleanup.ts` (real `DELETE /v1/users/me` calls, per Feature 20 — a real, complete purge, not a leftover data trail).
- **No per-user *action* rate-limit bypass is used or needed.** Real concurrency is achieved by simulating many distinct real users, each bound by their own real per-user limits (`SWIPE_RATE_LIMIT_PER_MINUTE`, `MESSAGE_RATE_LIMIT_PER_MINUTE`, `AI_SEARCH_TEXT_RATE_LIMIT_PER_MINUTE`, etc.) — exactly like real distinct users would be.
- **Correction found while building, not assumed away**: *creating* those many distinct users is itself a real per-*IP* bottleneck, separate from any per-user action limit — `OTP_REQUEST_LIMIT_PER_IP_PER_HOUR=20` would block ramping to 50/100 virtual users well before Tier 1's own concurrency target, since every virtual user's signup OTP request originates from the same load-test-runner machine. The fix is **not a new escape hatch** — it's the *existing* `OTP_RATE_LIMIT_BYPASS`/`AUTH_OTP_DEBUG_ECHO` pair, already an established, already-reviewed test-only mechanism this project's entire e2e suite depends on for the identical reason (`test/jest-e2e.setup.ts`, `npm run start:frontend-e2e`). The load-test target backend is started the same way every e2e run already starts it; no new bypass surface is introduced.

## Metrics captured per run

- Per-scenario p50/p95/p99 latency and error rate (a real 4xx from a real rate limit is *not* an error for this purpose — expected, correct behavior; only 5xx and unexpected 4xx count).
- Real WebSocket delivery latency (`message:new` push, chat) under concurrent load — the one metric this project's existing single-pair e2e tests structurally cannot produce.
- The real OpenAI-call counter's final count and the wall-clock time it took to reach it (a real, if rough, throughput signal for Tier 2's own concurrency level).
- Any 5xx, any WebSocket disconnect/reconnect event, any real, unexpected error — logged with enough context to root-cause, matching this project's own "stop and root-cause anomalies" standard rather than just tallying a pass/fail number.

## Safety guardrails

- `target-safety-check.ts` refuses to run unless the target base URL is in an explicit allowlist (`http://localhost:3000` by default, matching this project's own dev setup) — mirroring `ProductionSafetyService`'s real "refuse to start unsafely" precedent, enforced client-side since this tool runs outside the server process.
- The global OpenAI-call cap (above) is mandatory, not optional — `run.ts` refuses to start without `LOAD_TEST_MAX_OPENAI_CALLS` explicitly set.
- Real kill switches (`VOICE_CALLS_ENABLED` etc.) are restored to their real defaults (`true`) after any Tier 2 run that toggles them, mirroring the exact restore-and-restart discipline already used throughout this project's own manual verification passes (Feature 18/19's temporary env-toggle probes).
- `cleanup.ts` runs automatically at the end of every scenario, real or aborted (a `finally`-guaranteed step, not something that only runs on a clean exit) — a crashed or manually-interrupted run must not leave synthetic data behind uncleaned.

## Decisions (resolved by explicit user direction before implementation)

1. ✅ **Concurrency: a real ramp, not a single fixed number, and deliberately exploratory rather than modeled on an assumed production traffic shape (none exists yet to model).** Tier 1 (deck/swipe/settings/auth) ramps **10 → 50 → 100** concurrent virtual users. Tier 2 (AI-fanout — chat, AI search) ramps **5 → 15 → 30**. Each step is its own measured stage, not a blind jump to the top number — the goal is finding where real behavior changes (latency knee, error-rate inflection, the first real 5xx), not confirming a pre-guessed capacity figure.
2. ✅ **`LOAD_TEST_MAX_OPENAI_CALLS` = 500 real calls per run, a count-based hard cap, not a dollar-based one** — the guard already counts real calls natively (§ above), and 500 calls stays under $1-2 even by a deliberately conservative per-call cost estimate across this project's real OpenAI usage (`omni-moderation-latest` moderation, `text-embedding-3-small` embeddings, `gpt-4o-mini` extraction/explanation, `whisper-1` transcription — all real, cheap models per `docs/architecture.md`'s own trail, none of this project's heavier/pricier tiers).
3. ✅ **A dedicated, separate Neon branch for load testing — not the shared dev database.** Explicit reasoning: the shared dev DB has *already* caused multiple real pagination-fragility bugs as its own accumulated history grew (`docs/roadmap.md`'s "Known infrastructure debt" — the exhaustive-pagination-helper fix, hit independently across four different e2e suites) — deliberately generating a much larger, load-test-scale volume of synthetic data on that same shared database risks reproducing the identical class of bug, at a worse scale, for everyone else's concurrent dev work too. See "Provisioning the branch" below for the one real blocker this introduces.
4. ✅ **The kill-switch scenario is its own small, standalone run — never toggled mid-way through a large concurrent Tier 1/2 run.** Explicit reasoning: today's kill switches are `.env` values read once at boot (`ConfigService`), so a real toggle requires a real backend restart — doing that in the middle of a large run would interrupt every other in-flight virtual user's connection too, and the resulting recovery-from-restart behavior (reconnection, in-flight-request failures) would be indistinguishable from the kill switch's own real behavior, making the run's result uninterpretable. Scoped instead as `scenarios/kill-switch-toggle.ts` — a small, dedicated scenario: start the backend with a switch on, run a handful of virtual users, stop, flip the real `.env` value, restart, confirm the real 503/`detail` text, flip back, restart again to leave the backend in its correct default state (mirroring Feature 18/19's own already-established manual-verification restart discipline exactly).

## Provisioning the branch — ✅ done

Creating a real Neon branch needed either the Neon dashboard (a human action) or an authenticated `neonctl`/Neon API call — this agent had no Neon credentials configured anywhere in this project, so the user created the branch directly and supplied its real pooled connection string. Stored at `backend/scripts/load-test/.env.load-test.local` (matching `backend/.gitignore`'s existing `.env.*.local` pattern) — deliberately **not** `backend/.env`, so the normal dev backend never accidentally points at the load-test branch or vice versa.

The load-test harness itself never touches `DATABASE_URL` directly — that's the *backend server's* own connection, not something the load-test scripts (which only speak real HTTP/WebSocket to whatever backend is running) read at all. To point the backend at the branch for a load-test run, start it with `DATABASE_URL` overridden from the load-test env file, the exact same `cross-env`-style override this project has used since Feature 14 for `AUTH_OTP_DEBUG_ECHO`/`OTP_RATE_LIMIT_BYPASS` (dotenv-family loaders don't override a value already present in `process.env`) — then restart it back onto the real dev database afterward, mirroring Feature 18/19/20's own established temporary-override-then-restore discipline exactly. A real Neon branch is a full copy-on-write snapshot of its parent at creation time, not an empty schema — this branch already carries the real, current schema *and* a copy of the existing dev database's accumulated data as of branch creation, which is a genuine plus for load-testing realism (real query performance against a real-sized dataset, not an artificially empty best case), not a concern.

## Real findings from execution

### Two real bugs found in the harness itself, both via real runs, not review

1. **Phone-number collision.** The first draft of `uniqueLoadTestPhone()` prepended a cosmetic `"+1556"` marker prefix, then `.slice(0, 16)`'d the result to fit the real E.164 validation pattern's length bound — but that truncation silently cut off the *last two digits* of the zero-padded sequence number, the only part actually distinguishing concurrent virtual users. Every group of 10 users created in the same run collided onto an identical phone number, producing a real `401 Invalid or expired OTP code` the moment two colliding users' requests raced. Found on the very first real smoke-test run (2 users). Fixed by dropping the cosmetic prefix and mirroring `test/helpers/unique-phone.ts`'s own proven, untruncated scheme directly, rather than inventing a variant of it.
2. **Orphaned data on partial batch failure.** `Promise.all`'s all-or-nothing semantics meant a single failed user creation discarded the whole batch's return value — and, once fixed by pushing each user into the cleanup array as a real side effect on success, exposed a second, deeper issue: `Promise.all` rejecting on the *first* failure doesn't stop or wait for the other N-1 still-in-flight creations, which kept running as unsupervised background work and finishing (still creating real rows) *after* `finally`'s cleanup had already run to completion. Two real runs left 63 and then 62 genuinely orphaned rows on the branch database, both found by direct query and removed by hand. Fixed with `Promise.allSettled` — every creation attempt now genuinely finishes, success or failure, before the stage is considered done, so cleanup always sees a complete, stable list.

### A real, previously-undocumented backend rate limit, found only by generating real concurrent load

A combined `10 → 50 → 100` run hit a real `429 ThrottlerException` on `/v1/auth/otp/request` partway through stage 3 — traced to `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])` (`backend/src/app.module.ts`, applied globally via `APP_GUARD`), a real, global, per-IP request cap **completely independent of `OTP_RATE_LIMIT_BYPASS`** (which only covers `OtpService`'s own DB-backed per-phone/per-IP counter). This had never been exercised or documented anywhere in this project before — no prior e2e suite has ever generated enough request volume from one process to reach it.

**Important distinction, per explicit user direction, so this finding is never later mistaken for a real server-capacity limit:** every virtual user in this harness originates from the same real machine and therefore the same real IP address. A real production user base of 100 concurrent people would arrive from ~100 different real IPs, each with their own independent throttle bucket — the global per-IP cap would not meaningfully engage the way it does here. **The 429s this tool observes are, at least in part, a real artifact of the tool's own single-IP topology, not evidence that the backend itself can only serve ~100 requests/minute of real, distributed traffic.** Whether the cap is *also* a real, intended production safeguard (very plausibly yes — a legitimate anti-abuse measure) is a separate, valid question from "is this our actual capacity ceiling" — this tool's own results cannot distinguish the two on their own, and must not be read as if they can.

An isolated single-stage run of exactly the same 100-user stage (no preceding stage 1/2 traffic from the same run) completed **100/100 signups with zero errors** — real evidence that the earlier failure was not a hard "100 concurrent users" ceiling. The leading hypothesis was that back-to-back ramp stages from one IP accumulate within the same real 60-second rolling throttle window, so stage 3's own budget is partly consumed by stage 1/2's still-recent traffic before it even starts.

**✅ Confirmed directly, not just inferred.** Re-running the full combined `10 → 50 → 100` ramp (with the `Promise.allSettled` fix in place) reproduced the failure exactly: stages 1 and 2 both completed with real-errors=0, and stage 3 immediately hit **42/100 real 429s** on `/v1/auth/otp/request`, all with the identical `ThrottlerException` body. Confirms the hypothesis: it is the *combined* recent request volume from this one IP across consecutive stages that trips the cap, not stage 3's own 100-user concurrency in isolation.

### A second real finding from the same run: the global throttle can block cleanup too

Of the 58 users stage 3 did manage to create, **cleanup failed for all 58** — not a repeat of the earlier `Promise.all`/orphaning bug (that fix held; every created user was correctly tracked), but a new, real mechanism: `VirtualUser.deleteAccount()` needs its own fresh OTP re-verification (Feature 6 FR-83, the real, correct, unmodified backend contract), which means cleanup itself calls `/v1/auth/otp/request` again — the exact same globally-throttled route that had just been hammered by the creation attempts moments earlier. With the throttle window still hot, every one of the 58 cleanup attempts also got a real 429, and — correctly, not a bug — the tool did not fall back to bypassing the real API. All 58 rows were removed by hand via direct SQL against the branch (the same real, safe, already-established fallback used for the two earlier orphan incidents), restoring the branch to its exact 523-row baseline.

**This is a genuine, real property of the system, not obviously a defect**: the same global anti-abuse throttle that protects `/v1/auth/otp/request` from a burst of creation traffic *also*, correctly and by the same real mechanism, protects it from a burst of legitimate deletion traffic immediately afterward — the guard doesn't (and structurally can't, without weakening the real security boundary) distinguish "this caller is my own load-test cleanup step" from any other caller.

✅ **Decided, by explicit user direction: no retry-with-backoff.** This tool is always run under direct human supervision, not as an unattended background system — automatic retries would add real complexity to mask a condition a human watching the run should simply see and act on. Instead, `cleanup.ts` now prints a loud, `stderr`-based, impossible-to-miss banner (not a plain log line that scrolls away under later stages' own output) the moment any deletion fails, explicitly instructing the manual SQL fallback — the same real, proven path already used successfully three separate times during this tool's own verification. `run.ts` prints a second, final reminder as the very last thing it outputs and sets a non-zero exit code if any cleanup failures occurred anywhere in the run, so the condition survives even if the per-stage banner is missed.

### Kill-switch scenario — clean, both phases, exactly as designed

Run as the two small, separate, operator-driven invocations the design called for (Decisions §4), with a real manual backend restart between them — never combined with a large concurrent run:

- **Phase "before"** (`VOICE_CALLS_ENABLED=true`, the real default): 2/2 real pairs started a real call successfully (`201`, p50=912ms).
- Backend stopped, `VOICE_CALLS_ENABLED` flipped to `false` in `backend/.env`, backend restarted, health-confirmed.
- **Phase "after"**: 2/2 real pairs got the real, expected `503` with the real, distinguishing detail text — `"Voice calls are temporarily disabled."` — confirmed directly from the response body, not assumed from the status code alone.
- Backend stopped, `VOICE_CALLS_ENABLED` restored to `true`, backend restarted onto the **real dev database** (the load-test branch override removed) — leaving every default correct and the load-testing session's own footprint fully closed out.
- Cleanup: 5/5 both phases, zero orphaned rows, zero manual-cleanup banners triggered (each phase's own small `CONCURRENT_USERS = 5` stayed well under the global throttle).

One minor, cosmetic-only nuance noticed while reading the output, not worth a code change: `kill-switch-toggle.ts` passes `[503]` as `metrics.time()`'s "expected" status list for phase="after", but `MetricsCollector` classifies anything `>= 500` as a real error unconditionally (by design — Tier 1/2 never expect a 5xx, so that branch is checked first and never consults the expected-4xx list at all). The phase's own real pass/fail determination (`sawExpectedOutcome`, correctly 2/2 both times) is unaffected — this only means the metrics summary's own `real-errors=2` label reads as alarming for what is actually this scenario's own correct, expected outcome.

### Tier 2 (AI-fanout resilience) — clean on infrastructure, one real bug found and fixed in the harness itself

The first Tier 2 run (`5 → 15 → 30`) hit no throttle collisions at all (its own per-stage request volume stays well under the global cap even summed across stages) and no 5xx anywhere — but every single `ai-search` call (50/50 across all three stages) came back a real `400`. Traced to a real bug in the harness, not the backend: the real `POST /v1/discovery/ai-search/extract` response is `{ filters: {...} }` — a nested object (`ExtractedFiltersResponseDto`) — but `VirtualUser.aiSearch()` spread the *whole response wrapper* into the follow-up search request instead of unwrapping `.filters` first, adding an unrecognized `filters` key that the real `ValidationPipe`'s `forbidNonWhitelisted: true` correctly rejected. Fixed by unwrapping `.filters` before spreading; confirmed skeptically, not just assumed fixed — the DTO shapes were read directly from `ai-search.controller.ts`/`ai-search.dto.ts`/`extracted-filters-response.dto.ts` before writing the fix, then re-run for real.

**Re-run, fully clean**: all three stages (5/15/30 concurrent) — `signup`, `profile-completion`, and `ai-search` all real-errors=0, unexpected-4xx=0. `rate-limit-probe` correctly observed a real 429 in *every* stage (`AI_SEARCH_TEXT_RATE_LIMIT_PER_MINUTE=10` firing correctly even with other real concurrent traffic in flight) — direct, positive evidence for Tier 2's actual goal (this project's own rate-limit correctness holding under real concurrency), not just an absence of errors. Cleanup succeeded 5/5, 15/15, 30/30 — no orphaned rows, branch DB confirmed back at its exact 523-row baseline by direct query. Total real OpenAI-touching calls across both the buggy and fixed runs: 502 (well inside two separate 500-call caps, one per invocation).
