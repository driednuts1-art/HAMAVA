# Architecture Review v2 — AI-Native Matching Evolution: Audit & Gap Analysis

**Status:** Phase A/B deliverable (audit + gap analysis only). No code was changed to produce this document. Every claim below was verified by reading the actual source at `C:\Users\Admin\Desktop\دیتینگ اپ پروژه` — `backend/prisma/schema.prisma` in full, every `*.interface.ts` in `backend/src`, the core services (`ProfileService`, `ConversationalSetupService`, `AiSearchService`, `DeckService`, `SwipeService`, `MatchService`, `MatchExplanationService`, `BlockService`, `ModerationFlagService`, `AuditLogService`, `AccountDeletionService`, `ProductionSafetyService`, `ChatGateway`, `VerificationService`), `docs/architecture.md`, `docs/roadmap.md`, `docs/product.md`, `docs/security.md`, `docs/legal-checklist.md`, and the frontend's route/component/lib structure — not inferred from the Engineering Status Report or from memory of earlier sessions.

This document answers: what already exists (don't rebuild it), what's partial, what's genuinely missing, and what would conflict with the existing architecture if built carelessly. It does not propose an implementation plan — that's Phase C, gated on sign-off of this document.

---

## A. Current Architecture

**Confirmed exactly as `docs/architecture.md` describes, cross-checked against the real module tree, not assumed from that doc alone.**

- **Backend:** NestJS modular monolith, TypeScript. `backend/src/modules/` = `auth`, `verification`, `profile` (+ `profile/conversational-setup`), `discovery` (+ `discovery/ai-search`, `discovery/match-explanation`), `chat`, `calls`, `safety`, `date-share`, `settings`, `admin`, `users`. `backend/src/common/` = `audit-log`, `crypto`, `production-safety`, `filters`, `exceptions`, `moderation`, `ai` (embedding + transcription), `analytics`, `pagination`, `websocket`. `backend/src/redis/` holds the one shared `RedisService`.
- **Database:** PostgreSQL on Neon, Prisma Migrate + Prisma Client, pgvector extension enabled (`extensions = [vector]` in `schema.prisma`) for exactly one column (`User.bioEmbedding vector(1536)`).
- **Cache/pub-sub:** Redis (Upstash), one shared connection owner (`RedisService`/`RedisModule`, `@Global()`), consumed by exactly two things: `ConversationalSetupSessionStore` (ephemeral onboarding session state) and `RedisIoAdapter` (Socket.IO horizontal-scaling pub/sub for the chat/calls gateway).
- **Object storage:** S3-compatible (`S3StorageProvider`, real — MinIO locally, verified against Cloudflare R2 too), presigned time-limited URLs generated fresh on every read, never persisted.
- **AI vendor:** OpenAI only, everywhere, called via raw `fetch()` — **zero uses of the `openai` npm package anywhere in `backend/src`**, confirmed by a repo-wide grep and by `package.json` not listing it as a dependency. Every OpenAI-touching file is named `OpenAi*Provider` and implements a narrow interface (`EmbeddingProviderInterface`, `TranscriptionProviderInterface`, `ContentModerationProviderInterface`, `AiSearchExtractionProviderInterface`, `MatchExplanationProviderInterface`, `ConversationalExtractionProviderInterface`).
- **Auth:** short-lived JWT access token + rotating opaque refresh token (`Session` table, HMAC-hashed, revocable).
- **Frontend:** Next.js 16 App Router, TypeScript, Tailwind, React Query, Zustand, Playwright — `frontend/app/` has exactly three pages (`/`, `/login`, `/profile`) plus three Next.js API route handlers that proxy the refresh-token cookie dance. No mobile (Flutter) client exists — `product.md` §8.1 proposed Flutter, but nothing in the repo builds one; this is an intentional, already-tracked scope reduction (web-only so far), not an oversight.

**What was proposed in `product.md` but never built** (confirmed by grep, not assumed from the doc's own "still a proposal" framing): PostGIS/geohash, a feature-flag system (LaunchDarkly/Unleash or otherwise), OpenTelemetry tracing, Sentry error tracking, a secrets manager (still plain `.env`, tracked as a real pre-production blocker in `docs/security.md` item 2), GraphQL, Kubernetes. None of these are assumed present anywhere below.

---

## B. Current Data Model

Full schema read directly (`backend/prisma/schema.prisma`, 600 lines). Relevant entities for this directive:

- **`User`** — one row per person, no `Persona`/multi-identity concept. Carries profile fields (`displayName`, `birthDate`, `city`, `bio`, `interests[]`), a single `datingIntent RelationshipGoal?` enum field (`SERIOUS | CASUAL | MARRIAGE_TRACK | FRIENDSHIP | NOT_SURE`) — this is the *only* "intent" that exists, and it is a plain nullable enum column, not a dynamic/multi-valued system. Also carries `gender`, `livenessStatus`, `role` (`USER`/`ADMIN`), privacy toggles (`preciseLocationEnabled`, `messagingPermission`, `allowInSafetyShares`), and `bioEmbedding` (the one vector column, `Unsupported("vector(1536)")`, read/written only via raw SQL).
- **`DiscoveryPreferences`** — one-to-one with `User`. `minAge`, `maxAge`, `genderPref[]`, `relationshipGoalPref[]`, `verifiedOnly` (default `true`), `activeThisWeekOnly`. No `distance_km`/geo field despite `product.md` §9 originally sketching one — confirmed absent, and confirmed *why* in `docs/roadmap.md`'s Phase 2 entry (no location-capture infrastructure exists; Feature 3 explicitly deferred it; Feature 16 hit the same gap from the frontend side and also declined to build it).
- **`Swipe`**, **`Match`** — `Match.whyYouTwo String?` is the *only* explanation field; there is no structured `{reasons[], potentialMismatches[]}` shape, no `MatchScore`/`MatchSignals`, no algorithm version field anywhere on `Match` or `Swipe`.
- **`AiSearchRequest`**, **`ConversationalSetupRequest`**, **`Boost`** — all pure rolling-window rate-limit counters (record + count-query dual role), never content.
- **`AnalyticsEvent`** — generic `{userId, event: String, properties: Json, createdAt}`. Exactly **one** real event is ever written: `profile_completed` with `{source: 'FORM'|'CONVERSATIONAL'}` (`ProfileService.maybeMarkProfileCompleted`). `product.md` §11 names 17 events; 16 of them are not instrumented anywhere.
- **`ModerationFlag`** — retains rejected content (text directly, images quarantined under a `flagged/` storage prefix) for human review. This is the closest thing in the schema to a "sensitive data with a defined access/retention policy" pattern, but it is purpose-built for moderation review, not a general data-classification mechanism.
- **`AuditLog`** — deliberately **not** a foreign key to `User` (`docs/architecture.md` §2, confirmed in the schema comment) — survives account deletion by design, for compliance.
- **No `Persona`, `Intent` (as an entity), `Need`, `Offer`, `MatchScore`, `MatchSignals`, `Experiment`/`Variant`/`Assignment`, `Translation`, or geo/location table exists anywhere.** Confirmed by reading the full schema, not by grep alone.

---

## C. Existing Matching Pipeline (Feature 9 — AI Prompt Search) and Feature 3 (Deck)

Read directly: `deck.service.ts`, `swipe.service.ts`, `ai-search.service.ts`, `ai-search-extraction.service.ts`, `candidate-exclusion.util.ts`, `preferences.service.ts`, `match.service.ts`, `match-explanation.service.ts`.

**One shared hard-exclusion function, one implementation.** `buildSafetyExclusionWhere(userId, viewerLivenessStatus)` (`candidate-exclusion.util.ts`) is called by both `DeckService.getDeck()` and `AiSearchService.search()` — excludes self, incomplete profiles, already-swiped-either-direction, blocked-either-direction, and the FR-79 messaging-permission gate for unverified viewers. This is a real, working, centralized hard-constraint layer — **it already satisfies the directive's "hard constraints must remain deterministic, never overridden by AI" requirement**, structurally: the LLM-touching code (extraction, embedding) never sees or influences this `where` clause at all.

**Ranking today is single-signal.** For the deck: `(tier, createdAt, id)` — `tier` is boost-promotion only (0/1), no semantic component. For AI search: hard filter (Prisma, type-safe) → one raw-SQL step computing `bioEmbedding <=> queryVector` cosine distance → `ORDER BY distance ASC, createdAt ASC, id ASC`. There is no multi-signal score, no weighting, no `MatchSignals`/`MatchScore` object, no algorithm versioning. This is exactly "Similarity" from the directive's target state (`Similarity + Compatibility + Complementarity`) — Compatibility and Complementarity do not exist yet, confirmed by the single `ORDER BY` clause being the entire ranking logic.

**The verified-only floor is structurally protected, not just conventionally.** `AiSearchDto` has no `verifiedOnly` field at the type level; `OpenAiExtractionProvider`'s OpenAI Structured Outputs schema has no field capable of expressing it either. `verifiedOnly` is read only from the caller's own stored `DiscoveryPreferences` (`AiSearchService.search()` line ~66). This is a real, already-built example of exactly the "hard constraint enforced in application code, never trusted to a prompt" pattern the directive asks for everywhere (§32).

**AI never invents a candidate or a field to filter on.** `ExtractedFilters` (`extraction-provider.interface.ts`) is a closed, typed shape (`city`, `minAge`, `maxAge`, `gender[]`, `relationshipGoal[]`, `semanticQuery`) — every field maps to a real, pre-existing filter dimension. There is no free-text pass-through into a raw query anywhere in this path.

**Fail-open vs. fail-closed is already a deliberate, consistent pattern, not ad hoc.** Every real vendor call in this codebase throws (fails **closed**) at the provider level (`ServiceUnavailableException`) — moderation, malware scan, embedding, extraction, transcription, match-explanation generation, TURN credentials. Individual *callers* then choose fail-open or fail-closed based on what's at stake: `ProfileService.recomputeBioEmbedding()` and `MatchExplanationService.generate()` catch and swallow (log + `null`/no-op) because a ranking/explanation feature failing must never block the underlying real action (a bio save, a swipe). `ProfileService.updateProfile()`'s moderation call is *not* caught — a moderation failure blocks the write. This distinction is already correctly drawn and documented per call site; it is not something the directive's "AI failure must not corrupt canonical profile data" (§27) needs to introduce — it already holds.

---

## D. Existing Profile Pipeline (Feature 2 + Feature 11)

Read directly: `profile.service.ts`, `conversational-setup.service.ts`, `types.ts`, `conversational-extraction-provider.interface.ts`.

**One write path, not two.** `ConversationalSetupService.confirm()` calls `ProfileService.updateProfile(userId, dto, 'CONVERSATIONAL')` — the exact same method `PATCH /v1/profile` calls with `source: 'FORM'` (the default). Every validation (age range), every moderation call (bio text), every embedding recompute runs identically regardless of source. **This already is the directive's "AI extraction → user confirmation → canonical write, no separate looser path" requirement (§7/§8), fully built and e2e-tested** (`docs/architecture.md` §5.8 confirms this with a real test: a confirmed bio that fails moderation gets 422 exactly like the direct form).

**The confirmation gate is a real, structural chokepoint.** `ConversationalSetupService.runTurn()` never writes anything — it returns a `proposed: ExtractedTurnField` for the client to display, edit, and separately POST to `.../confirm`. The AI's proposal and the human's confirmed value are two different objects at two different endpoints; nothing before `confirm()` touches `User`.

**What does *not* exist: persisted attribute provenance.** Once `confirm()` writes a value, it becomes a plain `User.displayName`/`bio`/etc. column — indistinguishable in the database from a value typed directly into the manual form. There is no `source: 'AI_INFERRED' | 'USER_CONFIRMED' | ...` metadata stored anywhere, no confidence score, no `confirmedAt` per-field timestamp. The *flow* enforces "AI proposes, human confirms" — but the *data model* does not remember which path a value came from once written. This is a real, precise gap (see Gap Analysis §G below) — not "no confirmation gate exists" (one does, and works), but "the confirmation event isn't durably recorded per-attribute."

**Non-retention of conversation content is structural, not policy.** No `ConversationTurn`/transcript table exists in the schema at all. `ConversationalSetupSessionStore` holds the only copy of turn-by-turn conversation, in Redis, under a TTL, discarded immediately on explicit `end()` (verified in `docs/architecture.md` §5.8: the real Redis key is confirmed gone via a direct `GET` after `end()`, not just "the API returned 200"). **This is exactly the property the injected directive text asked to preserve, and it is preserved by construction — there is nowhere in the schema a "store the transcript" change could even partially reintroduce it without adding a new table.**

**The Persian/Gregorian calendar risk (the single highest-risk item Feature 11 identified) is already mitigated**, not open: `birthDateDisplay` is a required field in the extraction schema, and it must name both the source calendar and the resolved Gregorian date explicitly — verified in the real e2e suite against a real extraction call.

---

## E. Existing AI Provider Abstraction

Confirmed via a repo-wide grep for every `*ProviderInterface`/`*-provider.interface.ts` file (12 total) plus their concrete implementations and DI wiring in every module file.

| Interface | Token | Real impl. | Mock exists? | Checked by `ProductionSafetyService`? |
|---|---|---|---|---|
| `OtpProviderInterface` | `OTP_PROVIDER` | — (none) | `MockOtpProvider` (only impl. wired) | ✅ |
| `LivenessProviderInterface` | `LIVENESS_PROVIDER` | — (none) | `MockLivenessProvider` (only impl. wired) | ✅ |
| `StorageProviderInterface` | `STORAGE_PROVIDER` | `S3StorageProvider` | — (deleted post-swap) | ✅ |
| `MalwareScanProviderInterface` | `MALWARE_SCAN_PROVIDER` | `ClamAvMalwareScanProvider` | — (none) | ✅ |
| `ContentModerationProviderInterface` | `CONTENT_MODERATION_PROVIDER` | `OpenAiContentModerationProvider` | — (deleted post-swap) | ✅ |
| `EmbeddingProviderInterface` | `EMBEDDING_PROVIDER` | `OpenAiEmbeddingProvider` | — (none, real from day one) | ❌ |
| `TranscriptionProviderInterface` | `TRANSCRIPTION_PROVIDER` | `OpenAiTranscriptionProvider` | — (none) | ❌ |
| `AiSearchExtractionProviderInterface` | `AI_SEARCH_EXTRACTION_PROVIDER` | `OpenAiExtractionProvider` | — (none) | ❌ |
| `MatchExplanationProviderInterface` | `MATCH_EXPLANATION_PROVIDER` | `OpenAiMatchExplanationProvider` | — (none) | ❌ |
| `ConversationalExtractionProviderInterface` | `CONVERSATIONAL_EXTRACTION_PROVIDER` | `OpenAiConversationalExtractionProvider` | — (none) | ❌ |
| `TurnCredentialProviderInterface` | `TURN_CREDENTIAL_PROVIDER` | `CloudflareTurnCredentialProvider` | — (none) | ❌ |
| `AnalyticsEventProviderInterface` | `ANALYTICS_EVENT_PROVIDER` | `MockAnalyticsEventProvider`* | — | ❌ (can't be — doesn't implement the marker) |

*`MockAnalyticsEventProvider` is misleadingly named — despite the name, it is the only implementation and writes real `AnalyticsEvent` rows to Postgres; it does not implement `MockProviderMarker`, so it's structurally invisible to the production-safety check either way.

**Zero direct OpenAI SDK usage anywhere** (confirmed twice, independently, by both research agents and my own grep) — every call is a typed `fetch()` inside a provider class. This means the directive's §26 concern ("business logic should depend on internal interfaces, not vendor SDK objects") is **already fully satisfied** — there is no leak to audit because there is no SDK import to leak in the first place.

**Real gap, precisely bounded:** the five AI-vendor interfaces added since Feature 9 (embedding, transcription, extraction ×2, match-explanation, TURN) were built "real from the start" (`docs/architecture.md` §5.6: "a text-extraction/embedding/transcription mock would have nothing meaningful to stand in for") and so were **never given mocks and were never added to `ProductionSafetyService`'s checklist**. This is a reasonable original decision (nothing to catch, since nothing could accidentally be a leftover mock) but it does mean there is currently **no mechanism to disable any of these six AI capabilities without a code change** — directly relevant to the directive's §28 "feature kill switches" ask.

---

## F. Existing Privacy/Security Model

**Visibility/exclusion logic is real, tested, and correct — but scattered across call sites, not centralized.** Confirmed patterns, each independently implemented and independently tested:
- `buildSafetyExclusionWhere()` — one shared function for deck+AI-search hard exclusion (blocks, swipes, incomplete profile, messaging permission).
- `BlockService.isBlocked()` (bidirectional) vs. `hasBlocked()` (directional) — two different semantics used correctly at two different call sites (deck exclusion is bidirectional; message-push suppression is directional/asymmetric — a blocked sender's message still sends and persists, only the push to the blocker is silently suppressed).
- `AdminGuard` — re-checks `role` fresh from the DB on every request (never trusts a JWT-cached role).
- `ConversationAccessService.assertParticipant()`/`assertAccessible()` — 404 vs. 403 distinguished deliberately (existence-hiding for ephemeral/private resources vs. ordinary authorization for durable, mutually-known resources like a `Match`).
- `ModerationFlagService` — a real human-review queue with an explicit "review is not enforcement" boundary (resolving a flag never republishes content or triggers an account action).

**There is no single `DataVisibilityPolicy`/data-classification abstraction anywhere.** Each of the checks above is correct in isolation and independently tested, but "who can see this field, can AI use it, can matching use it, can it appear in an explanation" is answered by reading the specific service that happens to touch that field, not by consulting one policy object. This is a real, confirmed gap (directive §9) — but it is a **consolidation gap in already-correct logic**, not a **missing-enforcement** gap. Nothing here is currently leaking data; the risk is future drift as more surfaces are added without a shared reference point.

**Match explanations are already grounded against hallucination, with a real second-call verification step** — `MatchExplanationService.generate()` → `provider.generate()` → `provider.checkGrounded()` (an independent structured-output call, not the same call self-certifying) → discard on `grounded: false`. `docs/architecture.md` §5.7 documents a real calibration bug found and fixed here (legitimate paraphrase initially over-flagged as fabrication) and confirms the check "actually discriminates" via a dedicated e2e test with a deliberately fabricated claim. **This is exactly the directive's §15 "extract claims → compare against source facts → reject unsupported claims" pattern, already built, already tested against both over- and under-rejection.** The one gap: the output is a single positive-only `string`, never a structured `{reasons[], potentialMismatches[]}` (see §G).

**Prompt-injection-relevant boundaries are already code-enforced, not prompt-enforced**, in every place checked: the verified-only floor (§C above), the block/exclusion logic (never touched by any LLM call), and account deletion authorization (`AccountDeletionService` requires a *fresh* OTP re-verification tied to the caller's own phone hash — a stolen JWT alone is insufficient, confirmed by reading the service). No LLM output is ever used as an authorization signal anywhere in the codebase (confirmed by reading every real vendor-call site — none of the six AI providers' outputs feed into a guard, a `where` clause, or an authorization decision; every one feeds only into either a *proposal* a human must confirm, or a *ranking* signal within an already-hard-filtered set).

**Account deletion is a real, synchronous, complete purge**, confirmed by reading `AccountDeletionService.deleteAccount()`: fresh-OTP-gated, deletes both `Photo` and quarantined `ModerationFlag` image storage objects before the cascading DB delete, records one `AuditLog` entry (which itself survives, by the FK design in §B) before the user row disappears, relies on `onDelete: Cascade` for every other table. **Directive §37's "what happens on delete" question already has a real, working, tested answer for every table that exists today.**

---

## G. Gap Classification

Per the directive's own taxonomy. Every "MISSING" below was confirmed absent by direct grep/read, not inferred from silence.

| Capability | Status | Evidence |
|---|---|---|
| **Persona** | **MISSING** | Zero matches for "Persona" as a domain concept anywhere in `backend/src` or `frontend/`. `User` is a single flat identity with a single `datingIntent` enum. |
| **Intent** (as a dynamic, first-class concept) | **MISSING** | `datingIntent` exists but is a single nullable enum column on `User`, not a separate entity, not multi-valued, not swappable without editing the profile. |
| **Need** | **MISSING** | Zero matches anywhere. |
| **Offer** | **MISSING** | Zero matches anywhere (confirmed independently twice). |
| **AI extraction confidence** | **MISSING** | No confidence field on any extraction DTO/interface (`ExtractedFilters`, `ExtractedTurnField`, `TurnExtractionResult` — none carry one). |
| **AI extraction source** (provenance) | **PARTIALLY EXISTS** | The *flow* enforces "AI proposes → human confirms" (§D) and `AnalyticsEvent`'s `profile_completed.source` records which *entry path* (FORM/CONVERSATIONAL) completed a profile — but no per-*field* provenance is persisted on `User` itself once written. |
| **User confirmation state** | **PARTIALLY EXISTS** | The confirm endpoint *is* the confirmation gate (real, tested, structurally chokepointed) — but confirmation is an *event* (a request that either happens or doesn't), not *state* (nothing durably records "field X was confirmed by the user at time Y from proposal Z"). |
| **Complementary matching** (Need↔Offer) | **MISSING** | No code path checks compatibility in the "A wants what B has" sense anywhere — every ranking signal today is similarity-only (cosine distance) or a flat preference filter. |
| **Match explanation** (structured, +/-) | **PARTIALLY EXISTS** | Real, grounded, tested generation exists (`MatchExplanationService`) — but produces one positive-only string, never `{reasons[], potentialMismatches[]}`. |
| **Match quality measurement** | **MISSING** | No feedback loop, no metric computation, no `Precision@K`/`NDCG@K` tooling anywhere. |
| **Behavioral feedback** (explicit, e.g. WRONG_MATCH) | **MISSING** | No feedback endpoint, no feedback table. |
| **AI evaluation framework** | **MISSING** | No `docs/ai-evaluation.md`, no `ai/evals/` directory, no eval harness. The closest existing practice is the project's own real-vendor-call e2e discipline (real Whisper fixtures, real grounding-check probes) — real but ad hoc per-feature, not a reusable framework. |
| **Data classification** | **PARTIALLY EXISTS** | Correct per-field visibility logic exists everywhere it's needed (§F) — no centralized `DataVisibilityPolicy`/taxonomy object exists to consult or extend. |
| **AI cost observability** | **MISSING** | No token/cost/latency capture anywhere — every `OpenAi*Provider` call is fire-and-forget from an observability standpoint (errors are logged; successful calls are not metered). |
| **Feature kill switches** | **MISSING** | Confirmed via `.env.example` grep (zero `*_ENABLED`/`*_FLAG`/kill-switch-shaped vars) and via the provider-wiring table in §E — every AI capability is compiled in, unconditionally, for every environment except the two legally-blocked mocks (which are gated by *legal* status, not a runtime toggle). |
| **Provider failover** (e.g. a second LLM vendor) | **NOT NEEDED** *(per directive's own explicit instruction not to add without demonstrated need)* | Single-vendor (OpenAI) throughout, deliberately (`docs/architecture.md`: "a text-extraction/embedding/transcription mock would have nothing meaningful to stand in for" — the same reasoning applies to a second live vendor: no demonstrated need yet). Fail-closed-at-provider / fail-open-at-caller (§C) already gives graceful degradation *within* the one vendor; a second vendor is a distinct, larger decision requiring its own product/cost case, not a gap in what exists today. |

---

## H. Frontend — Additional Notes Specific to This Directive

- **Natural-language discovery (directive §42/§43) already exists**, not merely as a proposal: `AiPromptSearch` (`frontend/components/discovery/ai-search.tsx`) is a live, tested (`frontend/e2e/discovery.spec.ts`), shipped feature — free-text or voice entry → AI-proposed structured filters → an editable confirm step → the real search. Structured filters (`FiltersPanel`) already exist as a *secondary* control, exactly matching the directive's preferred shape ("Tell us what you're looking for," with structured filters as secondary), not a category→subcategory drill-down.
- **No "Persona"/"Intent"/"Need"/"Offer" terminology is exposed anywhere in the UI** — confirmed by grep. The one existing "intent" surface (`datingIntent`, rendered as "هدف از رابطه" / relationship goal) already uses plain human language, not the backend enum name.
- **No profile-completion-percentage nagging UI exists.** The completeness gate (`useAuthStore.profileCompleted`) is a binary can-continue check, not a progress meter — already aligned with directive §44's "don't build a 63% complete flow" preference.
- **`preciseLocationEnabled` is a real, already-shipped, inert boolean** (backend column + settings toggle) with **zero** frontend UI referencing it and **zero** backend logic reading it beyond storing/returning the bare value. This is worth flagging precisely because it's the one place the codebase already has a "flag with no behavior behind it" — not a new risk to introduce, but a pre-existing one to be aware of before building any location feature (directive §33 already correctly anticipates this exact trap: "do not add fake/inert frontend controls").
