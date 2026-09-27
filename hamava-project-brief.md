# Hamava (هم‌آوا) — Technical Project Brief

**Product type:** Hybrid dating + social discovery app for the global Persian-speaking market
**Target platforms:** Web (PWA-first for accessibility outside app stores) + native iOS/Android
**Primary market:** Iran + Persian diaspora (Afghanistan, Tajikistan, US/EU/Canada communities)
**Core positioning:** *"The dating app where every profile is a real, live-verified human, and AI actually understands who you're looking for."*
**Document status:** Reviewed as a development-team-grade technical specification. Section 8 onward is written to the level of detail an engineering team would need to start sprint planning, not just a product pitch.

---

## 1. Problem statement & competitive gap

Research into existing Persian-language dating/chat apps (Cafe Bazaar/Myket reviews, Telegram dating communities, FATA police advisories) surfaced five recurring failure modes in the category:

1. **Fake profiles & romance scams** — no rigorous identity verification; scammers use stolen/AI-generated photos and push users off-platform to WhatsApp/Telegram before financial exploitation ("pig butchering" pattern).
2. **Technical instability** — frequent crashes, slow profile/message loading.
3. **No real matching intelligence** — most apps/Telegram groups are manual browsing only, no semantic or preference-based matching.
4. **Aggressive monetization** — heavy paywalls early in the funnel, user resentment.
5. **Spam-heavy, unmoderated environments.**

**Strategic thesis:** win on *trust infrastructure* + *AI-native matching* + *safety-by-design calling*, not on breadth of features. Do not attempt to out-feature Tinder/Bumble globally — dominate the Persian-language vertical with a defensible trust moat.

---

## 2. Target audience

**Primary segment**
- Persian-speaking adults, roughly 20–38 years old, in Iran and major diaspora hubs (US, Canada, UK/EU, Turkey, UAE)
- Digitally fluent, active on Instagram/Telegram, already familiar with (and burned by) low-trust dating/chat apps
- Seeking both serious relationships and genuine friendship/social connection — not a single-intent user base, hence the hybrid dating+social product shape

**Secondary segments**
- Diaspora users specifically seeking Persian-speaking partners abroad (underserved — global apps like Tinder have no Persian-language or culturally-aware matching layer)
- Users who have tried existing Persian apps and churned due to trust or stability issues — early acquisition target

**User needs driving product decisions**
- Needs *proof* of authenticity before investing emotional energy — drives the verification-first architecture
- Needs privacy from their own social circle as much as from strangers — drives granular visibility controls
- Needs safety reassurance for real-world meetups — drives Share My Date and safe-calling features
- Needs to *skip* low-signal browsing — drives AI prompt-based search
- **Needs the product to actually work on unstable or filtered connections** — this is a first-class engineering constraint for this specific market, not an edge case (see Section 10)

---

## 3. Our advantages (value proposition)

| Advantage | User-facing benefit |
|---|---|
| Verification-first architecture | User can trust that a profile is a real, live person before ever messaging |
| AI-native discovery | Less time wasted browsing; matches are relevance-ranked, not just recency/proximity-ranked |
| Safety-integrated communication | Users can meet in person with materially lower risk than on unmoderated chat apps |
| Modern, fast, stable technical foundation | Directly addresses the #1 and #2 complaints found in competitor research (crashes, slow loading) |
| Privacy-respecting by default | Every sensitive setting defaults to the safer option |
| Culturally native, not a translated clone | Built for Persian-language UX and Persian social norms from day one |
| Resilient under real network conditions | Engineered for the actual connectivity reality of the primary market, not just lab conditions |

---

## 4. Unique advantages — nothing comparable currently exists in this market

1. **Free, mandatory liveness verification with zero document retention** — no Persian competitor found offers a no-ID, privacy-preserving liveness layer as a baseline.
2. **Natural-language / prompt-based matching** — not found in any Persian dating/social app researched; even Tinder only has AI-assisted matching in limited international markets.
3. **"Blind voice call before photo reveal"** as a designed safety + anti-superficiality mechanic — not observed in any competitor.
4. **Share My Date elevated to a primary feature**, not a buried settings option.
5. **"Verified-only" as the default discovery filter**, not an opt-in.
6. **Built for filtered/unstable connectivity from the architecture stage** — a structural advantage no competitor in this category appears to engineer for deliberately.

This combination — not any single feature alone — is the defensible moat.

---

## 5. Security & privacy (architectural principle, engineering detail)

- **Biometric data minimization:** liveness-check images/video processed transiently, deleted immediately after the pass/fail result, never written to persistent storage.
- **Zero ID document retention:** Verified+ tier — third-party KYC processor handles the document; Hamava's backend stores only a boolean result + provider reference token.
- **No phone number exposure:** WebRTC calling never reveals either party's real number to the other.
- **Privacy-by-default toggles:** precise location OFF by default; "who can message me" defaults to verified-only.
- **Full data deletion on account removal:** real purge within a defined SLA, not soft-delete.
- **Abuse & scam detection:** automated pattern detection for romance-scam behaviors (early off-platform requests, early financial asks), informed by documented "pig butchering" patterns.
- **Encryption:** TLS 1.3 in transit; encryption at rest for the database and object storage; evaluate E2E encryption for chat as a Phase 2 hardening step.
- **Secrets management:** all API keys, DB credentials, and third-party tokens stored in a dedicated secrets manager (e.g. AWS Secrets Manager, HashiCorp Vault, or GCP Secret Manager) — never in environment files committed to source control.
- **Authentication:** short-lived JWT access tokens + rotating refresh tokens, refresh token revocation list, device-level session management (user can see and revoke active sessions).
- **Authorization:** explicit resource-level authorization checks on every endpoint (no relying on "the frontend doesn't show that button" as a security boundary).
- **API security baseline:** rate limiting per user/IP/endpoint, input validation and schema enforcement (e.g. Zod/class-validator) on every request, output encoding to prevent injection, CSRF protection on state-changing web requests, secure headers (CSP, HSTS, X-Content-Type-Options, Referrer-Policy).
- **OWASP Top 10 as an explicit checklist** for every release: injection, broken auth, sensitive data exposure, XXE, broken access control, security misconfiguration, XSS, insecure deserialization, vulnerable dependencies, insufficient logging/monitoring.
- **Dependency & supply-chain security:** automated dependency scanning (Dependabot/Snyk) on every build; block merges on critical CVEs.
- **File/media upload safety:** virus/malware scanning on all uploaded media, strict file-type and size validation, image re-encoding on ingest (strips embedded EXIF/GPS metadata and neutralizes malformed-file exploits), no direct serving of user-uploaded files from the same origin as the API.
- **Rate limiting & anomaly detection specifically for the risk engine:** swipe velocity anomalies, mass-messaging patterns, device/IP fingerprint reuse across many accounts, rapid profile-info changes.
- **Independent security review:** third-party penetration test before public launch, and after any major architecture change (e.g., adding the calling infrastructure).
- **GDPR-equivalent data deletion flow** for account removal, including associated messages, photos, and verification records within a defined SLA.

---

## 6. Modern, user-friendly UI/UX — implementation-level requirements

- **Visual identity:** deep-indigo base with turquoise/gold accents evoking Persian visual heritage (geometric *girih* patterning), avoiding generic dating-app pink/red clichés — already validated in the interactive prototype.
- **RTL-native layout:** designed right-to-left from the ground up (typography, navigation, gesture direction, icon mirroring where directionally meaningful), not a mirrored LTR template.
- **Design tokens as code, not just a mood board:** color, spacing, radius, shadow, and typography values defined once (e.g. in a shared Tailwind config or a design-token JSON consumed by both Flutter and web) so web and mobile stay visually consistent without manual re-implementation.
- **Component library:** every interactive element (button, card, toggle, input, modal, bottom sheet, toast) defined once with explicit states — default, hover/pressed, disabled, loading, error, empty — not just the happy path shown in mockups.
- **Typography:** Vazirmatn (or comparable modern open-source Persian typeface) at multiple weights for clear hierarchy; verify font rendering and line-height specifically for Persian diacritics and numeral rendering (Persian vs. Arabic-indic digits — decide and standardize on one, already using Persian digits in the prototype).
- **Accessibility target:** WCAG 2.1 AA as the baseline — color contrast ratios, focus states visible and logical in RTL tab order, screen-reader labels on icon-only buttons, minimum touch-target sizes (44×44pt) on mobile.
- **Motion & interaction:** deliberate, not decorative — swipe-deck physics, verification progress ring, super-like toast, filter sliders should feel comparable to top-tier global consumer apps; respect `prefers-reduced-motion`.
- **Performance as a UX requirement:** sub-1.5s swipe-deck cold load, skeleton loading states (never a blank screen or bare spinner) for every async view, optimistic UI updates for swipe/like actions with rollback on failure.
- **Empty/error states designed with intent:** every empty or failed state gives the user a clear next action, written in the interface's own voice (see writing guidance below).
- **Dark mode:** the current design is inherently dark-theme; define whether a light theme is in scope for v1 or explicitly deferred — do not leave this ambiguous going into implementation.

---

## 7. Feature set

### 7.1 Onboarding & Trust
- Phone number verification (OTP, with abuse-resistant rate limiting on OTP requests)
- **Liveness check**: live selfie + head-turn/blink challenge → pass/fail, no image retained
- Optional **Verified+** tier: third-party KYC, ID never touches our DB, only a boolean + badge
- Clear, plain-language privacy disclosure screen before any biometric capture, with explicit opt-in consent recorded (timestamped, versioned against the specific privacy policy version shown)

### 7.2 Discovery
- **Dating Intent field** (onboarding, feeds directly into matching): serious relationship / casual dating / marriage-track / friendship / not sure yet
- **Compatibility Score**: blends stated values, lifestyle, relationship goals, cultural/family expectations (optional, privacy-friendly), and behavioral signals (which past matches led to real conversations/dates), learned over time
- **"Why You Two?" explainability**: every AI-suggested match includes a short, evidence-based reason grounded strictly in profile data the user actually entered — never invented content
- **Two discovery modes**: Explore (manual browse/swipe) and Matchmaker (AI Prompt Search, curated set)
- **AI Prompt Search**: free-text query → structured-output LLM call extracts filters (location, age range, interests, relationship goal) → hybrid structured-filter pre-pass + embedding-based semantic ranking against bios/interests
- **Swipe deck**: like / pass / Super Like (with AI-generated match explanation) / blind voice-call CTA
- **Smart Boost**: time-boxed visibility increase, constrained to users matching the requester's own filter/AI profile
- **Filters panel**: dual-handle age range, distance radius, gender preference, relationship goal, "verified-only" toggle on by default, "active this week" toggle

### 7.3 Communication & Safety
- Text chat (in-app only), delivered over a WebSocket connection with at-least-once delivery semantics and client-side message deduplication (idempotency keys)
- In-app voice/video calling — real phone numbers never exposed
- Time-limited first calls (abuse mitigation)
- Persistent panic/report button during calls and chat
- **Share My Date**: private link with date/time/location/verified-partner-photo, shareable with a trusted contact
- **Help Center**: searchable FAQ, "report a user," "report a bug," live support chat entry point
- **24/7 safety hotline** — prominent, not buried in settings

### 7.4 Profile & Settings
- Profile: photos, bio, verified badge (turquoise = liveness, gold = Verified+)
- Privacy controls: precise location toggle (default OFF), "who can message me" (default: verified-only)
- Standard settings taxonomy: Account, Privacy & Safety, Notifications (granular), General, destructive actions clearly separated

### 7.5 Explicitly deferred (Phase 2+)
- Double Date / group matching — culturally higher-risk for initial Iran-focused launch
- Broader social feed / stories layer — only after the dating core has product-market fit

---

## 8. Technical architecture (engineering-grade detail)

> Still a proposal to validate with a hired engineering lead — but detailed enough to start technical design docs from.

### 8.1 Frontend
- **Mobile:** Flutter — single codebase for iOS/Android, strong fit for a small team; evaluate against React Native only if the hiring pool strongly favors JS/TS engineers over Dart.
- **Web:** Next.js (React), PWA-enabled (installable, offline shell caching) for markets where app-store distribution is unreliable or filtered.
- **State management:** Riverpod or Bloc on Flutter; React Query (TanStack Query) + a lightweight global store (Zustand) on web — avoid over-engineering with Redux for an app this size.
- **RTL-first design system**, shared design tokens between Flutter and Next.js (see Section 6).

### 8.2 Backend
- **API layer:** Node.js (NestJS) — chosen for TypeScript end-to-end consistency with the web frontend, strong modularity (matches the "modular monolith" architecture below), and a large hiring pool. Go is a reasonable alternative if the team leans that way, at the cost of a second language boundary.
- **API design standard:** REST with OpenAPI 3.x specification as the source of truth (contract-first — generate client SDKs and server stubs from the spec, don't hand-write both sides and let them drift). Consider GraphQL only if/when the mobile team needs highly flexible querying across many nested resources — not justified for the MVP feature set.
- **Error format:** standardized problem-details format (RFC 7807) across every endpoint — consistent `type`, `title`, `status`, `detail`, `instance` fields so client error handling is uniform.
- **API versioning:** URI versioning (`/v1/...`) from day one, even with a single client, to avoid breaking changes later.
- **Pagination:** cursor-based (not offset-based) for the swipe deck and message history, to stay performant as tables grow and to avoid skipped/duplicated items under concurrent writes.

### 8.3 Data layer
- **Primary database:** PostgreSQL — relational core (users, matches, messages metadata, reports).
- **Vector search:** pgvector extension on the same Postgres instance for MVP simplicity (avoids operating a second database for embeddings); migrate to a dedicated vector DB (Pinecone/Weaviate/Qdrant) only if query volume or embedding dimensionality outgrows pgvector's performance envelope.
- **Cache & ephemeral state:** Redis — session cache, swipe-deck queue/pagination cursors, rate-limiter counters, WebSocket presence/pub-sub backbone for horizontal scaling of the chat service.
- **Object storage:** S3-compatible (with EU-region bucket for GDPR data residency), strict lifecycle policy — liveness capture images auto-deleted post-verification, profile photos processed through a resize/optimization pipeline (WebP/AVIF output, multiple resolutions for responsive delivery) and served through a CDN.
- **Migrations:** a single migration tool with versioned, reversible migrations (Prisma Migrate or TypeORM migrations) — no manual schema changes against production, ever.
- **Backups & disaster recovery:** automated daily backups with point-in-time recovery, explicit RPO (recovery point objective) and RTO (recovery time objective) targets defined before launch — not decided ad hoc after an incident.
- **Read scaling:** plan for a read replica once discovery-query load grows; do not prematurely shard — a single well-indexed Postgres instance handles substantial scale before this is needed.

### 8.4 Real-time & media infrastructure
- **Chat transport:** WebSocket gateway (NestJS Gateway or a managed service) backed by Redis pub/sub so multiple backend instances can route messages to the correct connected client — required for horizontal scaling beyond a single server instance.
- **Voice/video calling:** WebRTC for 1:1 calls. For MVP, peer-to-peer with a TURN/STUN server (coturn, self-hosted or managed) is sufficient and simpler to operate than a full SFU; revisit an SFU (e.g. LiveKit) only if group calling or call recording/analytics becomes a requirement.
- **NAT traversal reliability matters more than usual here** given the target market's network conditions — budget for a properly provisioned TURN relay (not just STUN) since a meaningful share of users will be behind restrictive NATs or filtered networks where direct peer connections fail.
- **Call quality monitoring:** basic WebRTC stats collection (packet loss, jitter, connection type) reported back for debugging call-quality complaints, since "the call was bad" reports are otherwise undebuggable.

### 8.5 AI/ML layer
- **Liveness detection:** third-party SDK integration (do not build in-house — regulatory/liability weight is high).
- **KYC (Verified+ tier):** third-party processor (Sumsub/Onfido-class), pass/fail webhook only, zero document retention.
- **Prompt-to-filter parsing:** LLM call using structured/function-calling output (not free-text parsing with regex) to extract structured filters reliably.
- **Semantic matching:** embedding model over user bios/interests + the parsed prompt, cosine similarity ranking via pgvector, blended with the structured filter pre-pass for both relevance and query performance.
- **Content moderation:** automated image moderation (nudity/violence classifiers) and text moderation (harassment, scam-pattern keyword/behavioral detection) on all profile content before publish, plus a human review queue for user reports — never rely on automated moderation alone for account-level actions like bans.

### 8.6 Infrastructure, environments & DevOps
- **Environments:** strictly separate development, staging, and production — staging must mirror production configuration closely enough that "it worked in staging" is a meaningful signal.
- **Infrastructure as code:** Terraform (or the cloud provider's native IaC) for all cloud resources — no manually clicked-together infrastructure that can't be reproduced or audited.
- **Containerization:** Docker images for every backend service, deployed via a managed container platform (ECS/Cloud Run/Kubernetes — choose based on team size and operational appetite; Kubernetes is likely overkill for MVP scale and adds operational burden a small team should avoid until it's actually needed).
- **CI/CD pipeline:** automated build → lint → test → security scan → deploy-to-staging on every merge to main; manual promotion gate to production. No direct pushes to production.
- **Deployment strategy:** rolling or blue-green deployment to avoid downtime during releases; automated rollback on health-check failure.
- **Feature flags:** a feature-flag system (even a simple in-house one backed by a config table, or a managed service like LaunchDarkly/Unleash) to ship code dark and roll out features gradually — especially important for anything touching the matching algorithm or moderation logic, where you want to A/B test rather than flip a switch for 100% of users at once.

### 8.7 Observability
- **Structured logging:** JSON logs with correlation/request IDs threaded through every service call, aggregated centrally (e.g. CloudWatch, Grafana Loki, or a managed logging service) — not scattered plaintext logs per server.
- **Metrics:** application and infrastructure metrics (request latency, error rate, queue depth, DB connection pool saturation) via Prometheus-compatible metrics, visualized in Grafana or a managed equivalent.
- **Distributed tracing:** OpenTelemetry instrumentation across the API, so a slow request can be traced through every service it touched, not just guessed at.
- **Error tracking:** Sentry (or equivalent) on both backend and clients (Flutter + web), with source maps/symbolication configured so stack traces are actually readable, not minified garbage.
- **Alerting & SLOs:** define explicit SLOs (e.g. 99.9% API availability, p95 API latency under a defined threshold) with alerts routed to an on-call rotation — decide this before launch, not after the first outage.

### 8.8 Network resilience for the target market (Iran-specific engineering constraint)

This deserves explicit engineering attention, not an assumption of reliable connectivity:

- **Design for high-latency, lossy, and intermittently filtered connections** as the default case, not the exception, for a meaningful share of the primary user base.
- **CDN with broad edge coverage** for static assets and media so first-load performance doesn't depend on a single origin's reachability.
- **Aggressive client-side caching and offline-tolerant UI:** cache the swipe deck and recent chat history locally so the app remains partially usable and doesn't show a blank/broken screen on a dropped connection; queue outgoing messages locally and retry with backoff rather than failing silently.
- **Low-bandwidth mode:** serve smaller image variants and defer non-critical asset loads when the client detects a slow connection (Network Information API on web; platform equivalents on mobile).
- **PWA as a genuine distribution channel, not an afterthought** — for users where native app-store access is unreliable, the installable web app needs full feature parity with the native app, not a stripped-down fallback.
- **This should be treated as a defined non-functional requirement with its own acceptance criteria** (e.g. "core discovery and chat flows remain usable at simulated 3G speeds with 5% packet loss"), tested explicitly, not just hoped for.

---

## 9. Data model (high-level entities)

```
User
 ├─ id, phone (hashed), email, created_at
 ├─ profile: display_name, birth_date, city, bio, photos[], interests[]
 ├─ verification: liveness_status (bool), liveness_verified_at,
 │                verified_plus_status (bool), verified_plus_provider_ref
 ├─ preferences: age_range, distance_km, gender_pref, relationship_goal,
 │                verified_only (default true)
 └─ settings: notification_prefs, messaging_permission, location_precision

Match
 ├─ id, user_a_id, user_b_id, created_at, source (swipe|super_like|ai_search)

Message
 ├─ id, match_id, sender_id, content, sent_at, read_at, client_idempotency_key

CallSession
 ├─ id, match_id, started_at, ended_at, duration_limit_s, type (voice|video),
 │  connection_type (p2p|relayed), quality_stats_ref

Report
 ├─ id, reporter_id, reported_id, reason, context_ref, status, created_at

DateShareLink
 ├─ id, user_id, match_id, datetime, location_text, expires_at, token

AuditLog
 ├─ id, actor_id, action, target_ref, metadata, created_at   -- for moderation/admin actions, required for accountability and later compliance reporting
```

**Indexing notes for the engineering team:** composite indexes on `(user_id, created_at)` for chronological queries, a geo-index (PostGIS or a bounding-box approach) for distance-based discovery queries, and the vector index for embedding similarity search — these are not optional afterthoughts, they determine whether discovery queries stay fast as the user base grows.

---

## 10. Testing & QA strategy

- **Unit tests** for business logic (matching score calculation, filter parsing, moderation rule evaluation) — target meaningful coverage on core logic, not a vanity percentage across the whole codebase.
- **Integration tests** for API endpoints against a real (containerized) test database, not mocked at the DB layer, to catch actual query/schema issues.
- **End-to-end tests** for the critical user journeys explicitly: signup → verification → profile creation → swipe → match → message → report/block, and the payment/subscription flow. These are the flows where a regression is most costly.
- **Contract tests** between frontend and backend if using a contract-first OpenAPI approach, to catch breaking API changes before they reach a client.
- **Security testing** as a distinct pass, not folded into general QA: automated dependency/CVE scanning in CI, and a manual/third-party penetration test before launch (see Section 5).
- **Load testing** before launch and before any major marketing push — validate the architecture against a defined concurrent-user target (start with a realistic MVP-launch number, e.g. low thousands of concurrent users, not an aspirational million-user figure that has no bearing on early infrastructure decisions).
- **Manual QA checklist** for every release covering: signup, login, password/OTP reset, profile edit, photo upload, verification flow, swipe/match, unmatch, chat, block, report, subscription purchase and cancellation, account deletion.

---

## 11. Analytics event taxonomy

Define and instrument these events from day one — they are the raw material for both the North Star metric (Section 15) and future matching-algorithm improvements:

```
signup_started, signup_completed
profile_completed, photo_uploaded
verification_started, verification_completed, verification_failed
profile_viewed
like_sent, like_received, super_like_sent
match_created
message_sent, message_read
conversation_started
call_started, call_ended
date_shared, date_feedback_submitted
report_submitted, block_created
subscription_started, subscription_cancelled
```

Route these to a product analytics tool with EU-hosted data (e.g. PostHog EU Cloud, or self-hosted) to keep this consistent with the GDPR data-residency posture defined elsewhere — don't default to a US-hosted analytics SaaS without checking this.

---

## 12. Non-functional requirements

- **Language:** Persian (fa) primary, RTL layout mandatory throughout; English as secondary for diaspora settings.
- **Accessibility:** WCAG 2.1 AA baseline (see Section 6); must remain usable via web/PWA given app-store/filtering friction in the primary market.
- **Performance:** cold-start swipe deck load < 1.5s under normal conditions; core flows remain usable under simulated poor-network conditions (see Section 8.8).
- **Availability:** target 99.9% uptime for chat/call infrastructure, with defined SLOs and alerting (Section 8.7).
- **Privacy-by-default:** every new privacy-relevant toggle defaults to the more private/safe option.
- **Scalability target for architecture decisions:** design for tens of thousands of concurrent users without a rearchitecture; explicitly defer decisions that only matter at millions-of-users scale (e.g. microservice decomposition, multi-region active-active) rather than over-building for a scale that doesn't exist yet.

---

## 13. Launch strategy — solving cold start

- **Phase 1 — one dense beachhead community**, not a broad simultaneous release (e.g. a specific diaspora city cluster or a single Iranian city).
- **Phase 2 — adjacent cities/communities**, only once Phase 1 reaches a defined active-user density threshold.
- **Phase 3 — broader geographic rollout**, only after matching and safety systems are validated with real usage data.
- Do not launch broadly across many countries simultaneously before the core trust/matching loop is proven.
- Concentrate initial influencer partnerships within the Phase 1 community.

---

## 14. Success metrics — North Star and funnel

**North Star Metric:** meaningful connections — matches that progress into a real conversation and, ideally, a real-world or sustained interaction.

**Core funnel to instrument from day one** (see Section 11 for the underlying events):
```
Visit → Install → Signup → Profile completed → Verified
→ First Like → First Match → First Message → Conversation
→ Date planned → Post-date feedback → Retention → Subscription
```
Particular attention to **Verified → First Match** (where trust-first architecture should show measurable advantage) and **Conversation → Date planned** (where safety features are expected to increase real-world follow-through).

---

## 15. MVP scope (recommended first build)

1. Phone auth + mandatory liveness verification
2. Basic profile creation
3. Swipe deck (like/pass/super like) — structured filters only, no AI search yet
4. In-app chat
5. Report/block flow
6. Core settings (account, privacy, notifications)

**Explicitly out of MVP, added in fast-follow:** AI prompt search, in-app voice/video calling, Share My Date, Smart Boost, Verified+ tier.

**Engineering sequencing note:** build the modular monolith (Section 8.2/8.6) with clean module boundaries from the start — Auth, Users, Profiles, Matching, Discovery, Messaging, Moderation, Admin as distinct modules within one deployable service — so that if/when scale justifies extracting Matching or Messaging into a separate service later, that extraction is a refactor, not a rewrite.

---

## 16. Reference prototype

An interactive HTML/CSS/JS UI prototype covering 9 screens (verification, AI search, swipe, chat+call, profile, share-my-date, filters, help center, settings) was already built for visual/UX reference, including the design tokens referenced in Section 6. Bring that file into the new project as the design reference when implementation starts.

---

## 17. Open decisions for the new project session

- Final mobile framework choice (Flutter vs React Native) — depends on team hiring
- Liveness/KYC vendor selection (cost + Persian-market support matters)
- Hosting jurisdiction, cloud provider, and data residency approach given the target user base
- Container orchestration choice (managed container service vs. Kubernetes) — default to the simpler option unless a concrete need justifies Kubernetes
- Monetization model detail (freemium boundary — what's free vs Verified+/premium)
- Whether a light theme is in scope for v1 (Section 6)
- Specific concurrent-user target for initial load-testing (Section 10)

---

## 18. How to run this as a project (docs-first workflow)

Structure the new project around a small set of living documents that any future work must be consistent with:

```
/docs
  product.md        ← this brief, kept up to date as decisions change
  requirements.md    ← per-feature requirements as they're specified
  architecture.md    ← the technical decisions actually locked in (not just proposed)
  database.md        ← finalized schema, migrated as it evolves
  design-system.md   ← tokens from the prototype (colors, type, spacing)
  security.md        ← the Section 5 principles, expanded with implementation detail
  api-spec.md        ← the OpenAPI contract (Section 8.2), source of truth for endpoints
  roadmap.md         ← MVP → Phase 2 → Phase 3 sequencing
```

**Practical working rule:** before implementing any feature, state which requirement in `requirements.md` it satisfies; if it doesn't exist yet, write the requirement first, then implement. Before merging any API change, update `api-spec.md` first — code that doesn't match the spec is treated as a bug in the code, not the spec.
