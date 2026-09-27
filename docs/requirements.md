# Requirements

Per-feature requirements, specified before implementation and kept up to date as decisions change (`product.md` §18). Features are appended below in MVP build order (`product.md` §15).

- [Feature 1: Phone Auth + Liveness Verification](#feature-1-phone-auth--liveness-verification) — ✅ shipped
- [Feature 2: Basic Profile Creation](#feature-2-basic-profile-creation) — ✅ shipped
- [Feature 3: Swipe Deck](#feature-3-swipe-deck) — ✅ shipped
- [Feature 4: In-App Chat](#feature-4-in-app-chat) — draft

---

## Feature 1: Phone Auth + Liveness Verification

**Status:** ✅ Shipped — first MVP feature (per `product.md` §15, item 1: "Phone auth + mandatory liveness verification")
**Source sections:** `product.md` §7.1 (Onboarding & Trust), §5 (Security & privacy), §8.2 (API standards), §9 (Data model)
**Related legal constraint:** `legal-checklist.md` Part B — DPIA required before processing *real* user biometric data. Not blocking for this scaffold because the liveness provider is a mock that performs no real biometric processing (see Open Items below).

---

## 1. Goal

A user can prove they control a real phone number (OTP) and that a live human is behind the account (liveness challenge), and receive an authenticated session — with zero persistent storage of biometric capture data, per §5.

## 2. In scope

- Phone number submission + OTP request/verify
- Abuse-resistant rate limiting on OTP requests (§7.1)
- Session issuance: short-lived JWT access token + rotating refresh token (§5)
- Device-level session tracking, with revocation support (§5)
- Biometric consent disclosure recorded before any liveness capture, timestamped and versioned against a specific privacy-policy version (§7.1)
- Liveness challenge session lifecycle: start → provider result (pass/fail) → status update on the user record
- No image/video retention at any point — provider integration is transient by contract (§5)

## 3. Explicitly out of scope for this feature

- **Verified+ / KYC tier** (§7.1, §15 — deferred to fast-follow; no ID document handling here)
- Profile creation, discovery, matching, chat, calling — separate features/modules
- Real SMS delivery and real liveness biometric processing — see Open Items
- Admin/moderation tooling for verification review

## 4. User flow

1. User enters phone number (E.164 format).
2. Client calls `POST /v1/auth/otp/request`. Server issues a time-limited OTP, rate-limited per phone and per IP, and hands it to the OTP provider abstraction for delivery.
3. User enters the received code. Client calls `POST /v1/auth/otp/verify`.
4. On success: server finds-or-creates the `User` (phone stored only as a salted hash, never in plaintext), issues an access token + refresh token, creates a `Session` record, returns tokens + current verification status.
5. Client shows the plain-language biometric disclosure screen. User must explicitly opt in. Client calls `POST /v1/consent/biometric` with the displayed policy version. Server records a timestamped, versioned `ConsentRecord`. Liveness cannot start without this.
6. Client calls `POST /v1/verification/liveness/session` to start a liveness challenge (selfie + head-turn/blink) via the liveness provider abstraction.
7. Provider returns a pass/fail result via `POST /v1/verification/liveness/callback`. Server updates `User.livenessStatus` + `livenessVerifiedAt`. No capture data is persisted at any step.
8. Client polls or reads `GET /v1/verification/liveness/status` to reflect the result in the UI.

## 5. Functional requirements

### 5.1 OTP / phone verification
- FR-1: Phone numbers must validate as E.164 before an OTP is issued.
- FR-2: OTP codes are numeric, single-use, and expire after a short, configurable window (default 5 minutes).
- FR-3: OTP codes are stored server-side only as a hash, never in plaintext.
- FR-4: Rate limiting applies on two independent axes: per-phone (e.g. max N requests/hour) and per-IP (e.g. max M requests/hour). Both are configurable, enforced via a rolling-window count against the `OtpRequest` table (not Redis — corrected here to match the actual implementation in `backend/src/modules/auth/otp/otp.service.ts`; Redis in this project is used only for the chat WebSocket pub/sub adapter, §5.3 in `docs/architecture.md`).
- FR-5: Verify attempts are capped per OTP (e.g. 5 wrong tries invalidates the code and requires a new request), to resist brute force.
- FR-6: OTP delivery goes through an `OtpProviderInterface` — the calling code must not depend on any specific vendor's SDK/API shape (see Open Items).

### 5.2 Session & tokens
- FR-7: On successful OTP verification, issue a short-lived JWT access token (default 15 min) and a longer-lived opaque refresh token (default 30 days), per §5.
- FR-8: Refresh tokens are stored server-side only as a hash, are single-use, and rotate on every refresh (old token invalidated, new one issued).
- FR-9: Each session is tied to a `Session` record capturing device/client metadata, creation time, last-used time, and revocation state. Users can later be shown and can revoke active sessions (endpoint deferred to the Settings feature, but the data model must support it now).
- FR-10: A revoked or expired refresh token must not yield a new access token.

### 5.3 Biometric consent
- FR-11: Liveness verification cannot start unless a `ConsentRecord` exists for the current user referencing the exact privacy-policy version shown at consent time.
- FR-12: Consent records are immutable and timestamped; re-consent is required if the policy version changes (enforced by version comparison, not by the client's say-so).

### 5.4 Liveness verification
- FR-13: The liveness challenge (selfie + head-turn/blink) is delegated entirely to a `LivenessProviderInterface`. Application code never touches raw capture frames.
- FR-14: The result recorded on `User` is a boolean (`livenessStatus`) plus a timestamp. No image, video, or biometric template is written to any persistent store (DB or object storage) at any point in this flow.
- FR-15: A failed liveness check allows retry (rate-limited the same way as OTP, to prevent abuse of a free liveness flow).

### 5.5 Error handling & API conventions
- FR-16: All endpoints under this feature return errors in RFC 7807 problem-details format (§8.2).
- FR-17: All endpoints are versioned under `/v1` (§8.2).
- FR-18: All request bodies are validated against explicit DTOs (class-validator) — no unvalidated input reaches business logic (§8.2, §5 API security baseline).

## 6. Data model additions (extends §9)

```
User (subset relevant to this feature)
 ├─ id
 ├─ phoneHash            -- HMAC of E.164 phone, unique; plaintext phone is never persisted
 ├─ livenessStatus (bool, default false)
 ├─ livenessVerifiedAt (nullable timestamp)
 ├─ createdAt

OtpRequest
 ├─ id, phoneHash, codeHash, expiresAt, attemptCount, consumedAt, createdAt

Session
 ├─ id, userId, refreshTokenHash, deviceInfo, createdAt, lastUsedAt, revokedAt

ConsentRecord
 ├─ id, userId, policyVersion, acceptedAt

LivenessSession
 ├─ id, userId, provider, providerSessionRef, status (pending|pass|fail), createdAt, resolvedAt
```

## 7. Security requirements (from §5, scoped to this feature)

- TLS assumed at the edge (out of scope for app code, noted for deployment).
- Phone numbers: never stored in plaintext; only a keyed hash (HMAC with a server-side secret) for lookup.
- OTP codes and refresh tokens: stored only as hashes.
- Rate limiting on every unauthenticated, abuse-prone endpoint (OTP request, OTP verify, liveness session start).
- No biometric capture data persisted, ever — this is a hard invariant, not a performance optimization; it must hold even in error/retry paths.
- Explicit resource-level authorization: a user can only read/act on their own verification/session records.
- Secrets (JWT signing key, phone-hash HMAC key, DB/Redis credentials) read from environment/secrets store, never hardcoded.

## 8. Acceptance criteria

- [x] A new phone number can complete OTP request → verify → receive tokens.
- [x] OTP requests beyond the configured per-phone/per-IP limits are rejected with a 429 in problem-details format.
- [x] An expired or already-consumed OTP is rejected.
- [x] More than the allowed number of wrong OTP attempts invalidates the code.
- [x] Refresh token rotation works; a used-up refresh token cannot be reused.
- [x] Liveness session cannot start without a prior `ConsentRecord` for the current policy version.
- [x] A successful mock liveness result sets `User.livenessStatus = true` and stamps `livenessVerifiedAt`.
- [x] No table or object-storage bucket anywhere in the system ever contains liveness image/video data.
- [x] All error responses across these endpoints conform to RFC 7807.

## 9. Open items (explicit decisions already made — tracked for future swap)

1. **OTP provider is a mock** (console/log output only, no real SMS sent) behind `OtpProviderInterface`. Real vendor selection is blocked on sanctions/export-control legal review (`legal-checklist.md` Part E) — see `docs/roadmap.md`.
2. **Liveness provider is a mock** (always returns `pass`, no real biometric processing) behind `LivenessProviderInterface`. Swapping in a real vendor (Sumsub/Onfido-class) is blocked on completing a DPIA (`legal-checklist.md` Part B, GDPR Art. 35) — see `docs/roadmap.md`. Do not connect a real liveness vendor to this code path before that DPIA is signed off.
3. Database/migrations: Prisma Migrate + Prisma Client (decision recorded, see `docs/architecture.md` once written).

---

## Feature 2: Basic Profile Creation

**Status:** ✅ Shipped — second MVP feature (per `product.md` §15, item 2: "Basic profile creation")
**Source sections:** `product.md` §7.4 (Profile & Settings), §9 (Data model — `profile` fields), §5 (file/media upload safety, content moderation), §8.3 (media storage/processing), §8.5 (content moderation)
**Depends on:** Feature 1 — every endpoint here requires a valid access token (a verified phone-authenticated session). Liveness does **not** need to be `true` to create a profile; discovery/matching (a later feature) is where "verified-only" filtering applies.

### 1. Goal

An authenticated user can create and edit the profile other users will see: display name, birth date, city, bio, interests, and photos — with the upload path meeting the media-safety baseline in §5 as far as that's achievable without a contracted third-party vendor (see Open Items).

### 2. In scope

- Create/update own profile fields: `displayName`, `birthDate`, `city`, `bio`, `interests[]`
- Read own profile
- Photo upload (multipart), delete; stored via a storage-provider abstraction
- Server-side re-encoding of every uploaded photo (strips EXIF/GPS metadata, neutralizes malformed-file exploits, normalizes to WebP) — done in-process, no vendor needed (§5)
- File-type and size validation on upload (§5)
- A `profileCompletedAt` marker once the minimum-viable profile exists (displayName + valid birth date + ≥1 photo), for later gating of discovery access
- Malware scanning and image/text content-moderation *hooks* — called on every upload, but backed by mocks for now (see Open Items)

### 3. Explicitly out of scope for this feature

- Dating Intent field, Compatibility Score, discovery/matching filters (§7.2 — separate feature)
- Verified-badge display logic, Verified+ tier (§7.1/§15 — deferred)
- Privacy controls (location precision, who-can-message-me) and the general Settings screens (§7.4 — "Core settings" is its own later MVP item)
- Multi-resolution responsive image variants and CDN delivery (§8.3) — single re-encoded WebP per photo is enough for this pass; documented as a fast-follow in `docs/roadmap.md`
- A real age-assurance mechanism (`legal-checklist.md` Part D) — see Open Items; this feature only adds a baseline self-declared-birthdate check

### 4. User flow

1. Client calls `PATCH /v1/profile` with any subset of `{displayName, birthDate, city, bio, interests}`. Server validates and upserts the profile fields on the caller's `User` row.
2. Client calls `POST /v1/profile/photos` (multipart) to upload a photo. Server validates type/size, runs the (mocked) malware scan, re-encodes to WebP and strips metadata, runs the (mocked) content moderation check, stores the result via the storage-provider abstraction, and creates a `Photo` row.
3. Client calls `DELETE /v1/profile/photos/:id` to remove a photo (must belong to the caller).
4. Client calls `GET /v1/profile/me` at any point to read the current profile + photo list + `profileCompletedAt`.
5. After each mutating call, the server recomputes `profileCompletedAt` (set once, immutable after — matches the `profile_completed` analytics event in §11, though analytics instrumentation itself is out of scope here).

### 5. Functional requirements

#### 5.1 Profile fields
- FR-19: `displayName`: 1–50 characters, required for a "complete" profile.
- FR-20: `birthDate`: must resolve to an age between 18 and 100 inclusive at request time; under-18 is rejected outright (400), not just flagged. This is a baseline technical guardrail only — **not** the "distinct, documented age-assurance approach" `legal-checklist.md` Part D calls for; that needs dedicated legal review before launch (see Open Items).
- FR-21: `city`: optional free text, ≤100 characters.
- FR-22: `bio`: optional free text, ≤500 characters.
- FR-23: `interests`: optional array of free-text strings, each 1–30 characters, ≤10 items.
- FR-24: All fields are independently optional on update (`PATCH` semantics) — a user can build their profile incrementally.

#### 5.2 Photo upload
- FR-25: Accepted input formats: JPEG, PNG, WebP. Anything else is rejected (415) before any processing happens.
- FR-26: Max upload size is configurable (default 8 MB); oversized uploads are rejected (413) before being read into memory in full.
- FR-27: Every accepted upload is re-encoded server-side (not just re-saved) to WebP, which strips EXIF/GPS metadata and any malformed-file payload riding along with the original bytes, before it ever reaches storage (§5).
- FR-28: Every accepted upload is passed through a `MalwareScanProviderInterface` before being persisted; a positive/unclean result rejects the upload (422). Implemented for real against a ClamAV daemon (see §9 Open Items, and `docs/roadmap.md` §4) — not mocked.
- FR-29: Every accepted upload is passed through a `ContentModerationProviderInterface` (image classifier) before being persisted; a rejected result rejects the upload (422) rather than silently hiding it later. Mocked for now (see Open Items).
- FR-30: A user can have at most a configurable number of photos (default 6); exceeding it is rejected (409) until they delete one.
- FR-31: Stored photos are never served from the same origin as the API in production — see Open Items for the current dev-only exception.
- FR-32: A user may only delete their own photos (resource-level authorization, §5).

#### 5.3 Text content moderation
- FR-33: `bio` (and any other free-text field capable of carrying abuse/harassment/scam content) is passed through a `ContentModerationProviderInterface` text-check before being saved; a rejected result rejects the update (422) with the offending field named in the response. Mocked for now (see Open Items).

#### 5.4 Completion tracking
- FR-34: `profileCompletedAt` is set (once, first time only) when `displayName`, a valid `birthDate`, and at least one photo are all present. It is never cleared by later edits or photo deletions, even if the profile later drops below the threshold — it marks "onboarding reached this milestone," not "profile currently meets the bar."

#### 5.5 API conventions (carried over from Feature 1)
- FR-35: All endpoints require a valid access token (`JwtAuthGuard`), versioned under `/v1`, errors in RFC 7807 format, request bodies validated against explicit DTOs.

### 6. Data model additions (extends §9)

```
User (new fields, in addition to Feature 1's)
 ├─ displayName        String?
 ├─ birthDate           DateTime?
 ├─ city                String?
 ├─ bio                 String?
 ├─ interests           String[]
 ├─ profileCompletedAt  DateTime?

Photo
 ├─ id, userId, storageKey, position, createdAt
```

### 7. Security requirements (from §5, scoped to this feature)

- Uploaded files are never trusted by extension/declared MIME type alone — validated by actually parsing/re-encoding the image; a file that fails to parse as a valid image of an accepted format is rejected outright.
- Re-encoding happens before storage, not as an async post-process step — an unprocessed original is never persisted, even transiently, past the request that uploaded it.
- Resource-level authorization on every profile/photo mutation: a user can only ever modify their own row.
- Free-text fields (`bio`, `interests`) pass through the same DTO validation + moderation hook as everything else — no field is exempt because it "seems low-risk."

### 8. Acceptance criteria

- [x] A profile can be built up incrementally via repeated `PATCH /v1/profile` calls.
- [x] A `birthDate` implying under-18 is rejected with 400, profile not updated.
- [x] A non-image or oversized file is rejected before processing, with no `Photo` row created and nothing written to storage.
- [x] An accepted photo is retrievable afterward and is NOT byte-identical to the original upload (proves re-encoding actually ran) and carries no EXIF block.
- [x] Uploading past the max-photos limit is rejected (409) and does not delete/overwrite an existing photo.
- [x] `profileCompletedAt` is null until displayName + valid birthDate + ≥1 photo all exist, then gets set exactly once and survives a later photo deletion.
- [x] A user cannot delete another user's photo (403/404, not a silent no-op).
- [x] Deleting a photo removes the physical file from storage, not just the `Photo` row (verified via `StorageProviderInterface.read()` failing post-delete, both manually and in `test/profile.e2e-spec.ts`).
- [x] A real malware scan actually runs and actually rejects: the EICAR antivirus test string, uploaded through the live HTTP endpoint, is rejected with 422 and a genuine `Eicar-Test-Signature FOUND` result from a running ClamAV daemon (not a canned/mocked response).
- [x] All error responses conform to RFC 7807.

### 9. Open items (explicit decisions — tracked for future swap, per the pattern in `docs/roadmap.md`)

1. **Photo storage is a local-disk mock** behind `StorageProviderInterface`, not a real object-storage vendor. No S3-compatible/EU-region bucket has been provisioned yet (`product.md` §8.3, §17). The dev-only file-serving route violates FR-31's "not same-origin" rule by necessity until a real provider (with its own CDN-fronted URLs) is wired in.
2. ~~Malware scanning is a mock~~ — ✅ **resolved**: `MalwareScanProviderInterface` is backed by a real ClamAV daemon integration (`ClamAvMalwareScanProvider`), not a mock. See `docs/roadmap.md` §4 for setup/deployment notes.
3. **Content moderation (image + text) is a mock** (`ContentModerationProviderInterface`, always approves) — no moderation vendor provisioned, and no human review queue exists yet (`product.md` §8.5 explicitly requires one before this can be relied on for real account-level actions).
4. **Age check is self-declared only.** A real age-assurance mechanism per `legal-checklist.md` Part D needs dedicated legal review before launch; this FR-20 check is a technical floor, not a compliance answer.

---

## Feature 3: Swipe Deck

**Status:** ✅ Shipped — third MVP feature (per `product.md` §15, item 3: "Swipe deck (like/pass/super like) — structured filters only, no AI search yet")
**Source sections:** `product.md` §7.2 (Discovery), §9 (Data model — `Match`, and the `preferences`/`verification` blocks on `User`), §8.2 (API standards — cursor pagination), §5 (rate limiting & risk-signal anomaly detection)
**Depends on:** Feature 1 (auth, `livenessStatus`) and Feature 2 (`profileCompletedAt`, photos). Every endpoint requires a valid access token.

### 1. Goal

An authenticated user with a completed profile can browse a feed of other candidates (Explore mode only — no AI Matchmaker yet), swipe like/pass/super-like, and get matched automatically the moment two users have liked each other — all under the structured filters described in §7.2, with "verified-only" on by default as one of this product's stated trust differentiators (§4).

### 2. In scope

- `GET /v1/discovery/deck` — cursor-paginated candidate feed (FR-36..FR-39)
- `POST /v1/discovery/swipes` — record a like/pass/super-like, detect and create a mutual match (FR-40..FR-45)
- `GET /v1/discovery/matches` — list the caller's matches, since a match with no way to see it is useless before the Chat feature exists
- `GET`/`PATCH /v1/discovery/preferences` — structured filters: age range, gender preference, relationship-goal preference, verified-only (default **on**), active-this-week (FR-46..FR-49)
- Two new profile-level attributes needed to make any of the above filterable: `gender` and `datingIntent` (§7.2's "Dating Intent field... feeds directly into matching") — added here because Feature 2 didn't collect them and nothing before this feature needed them
- Rate limiting on the swipe action itself, distinct from any generic API throttle (FR-50, directly implementing the "swipe velocity anomaly" risk signal named in §5)

### 3. Explicitly out of scope for this feature

- **AI Prompt Search / Matchmaker mode** (§7.2, §15 — "structured filters only, no AI search yet")
- **Compatibility Score, "Why You Two?" explainability** — both explicitly described in §7.2 as blending AI/behavioral signals; not buildable without the AI layer this MVP slice excludes
- **Smart Boost** (§15 — explicitly deferred)
- **Distance-radius filtering.** §7.2 lists "distance radius" as a filter, but no feature so far has collected precise coordinates — Feature 2's `city` is a free-text string, and §7.4's "precise location toggle" was never wired to an actual lat/lng capture flow. Building real distance filtering here would mean either faking it against a string field or silently scope-creeping in a geolocation flow that hasn't been specified. **Deferred** — see Open Items. Age range, gender preference, relationship-goal preference, verified-only, and active-this-week are implemented; distance is not.
- **Blind voice-call CTA on the swipe deck** (§4 unique-advantage #3, §7.2) — depends on the calling infrastructure (§8.4), which is a separate, later MVP item ("In-app chat" is next; voice/video calling is explicitly fast-follow per §15)
- Chat itself — a match is created, but messaging the match is the next feature
- Verified+ badge distinction — "verified" here means liveness-verified only (§7.1), since Verified+ doesn't exist yet

### 4. User flow

1. User calls `GET/PATCH /v1/discovery/preferences` at least once (or relies on defaults: 18–100 age range, no gender/relationship-goal restriction, **verified-only = true**, active-this-week = false).
2. Client calls `GET /v1/discovery/deck?cursor=&limit=` to fetch a page of candidates matching their preferences, excluding themselves and anyone they've already swiped on (in either direction).
3. User swipes. Client calls `POST /v1/discovery/swipes` with the target and the action (`LIKE` / `PASS` / `SUPER_LIKE`).
4. Server records the swipe. If the action is `LIKE` or `SUPER_LIKE` and the target has *already* swiped `LIKE`/`SUPER_LIKE` back on the caller, server creates a `Match` and the response says so immediately (`matched: true, matchId`).
5. Client requests the next page using the cursor from the previous response; swiped-on candidates never reappear.
6. User can call `GET /v1/discovery/matches` at any time to see everyone they've matched with.

### 5. Functional requirements

#### 5.1 Candidate feed & pagination
- FR-36: The deck endpoint uses **cursor-based pagination** (`product.md` §8.2 — explicitly not offset-based, to stay stable as the table grows and avoid skipped/duplicated candidates under concurrent writes). The cursor encodes `(createdAt, id)` of the last item returned; the next page is `WHERE (createdAt, id) > (cursor.createdAt, cursor.id) ORDER BY createdAt ASC, id ASC LIMIT N`. `id` is the tiebreaker because `createdAt` alone is not guaranteed unique.
- FR-37: A candidate must never be the caller themselves, and must have `profileCompletedAt IS NOT NULL` (an incomplete profile is not a valid candidate).
- FR-38: **Any candidate the caller has already swiped on — `LIKE`, `PASS`, or `SUPER_LIKE` — is permanently excluded from that caller's future decks.** This is a hard exclusion at the query level (`WHERE target.id NOT IN (SELECT targetId FROM Swipe WHERE actorId = caller)`), not a client-side filter. (Scope note: this excludes based on the *caller's own* swipe history only — a candidate who has passed on the caller is still shown to that caller, since the caller has no way to know that and one-directional passes shouldn't silently vanish someone's chance to be seen.)
- FR-39: The deck applies the caller's current `DiscoveryPreferences` (§5.3) as `WHERE` filters, not post-fetch filtering, so `limit` reflects actually-matching candidates.

#### 5.2 Swiping & matching
- FR-40: `POST /v1/discovery/swipes` accepts exactly one action per (caller, target) pair — a second swipe on the same target is rejected (409), never silently overwritten (a user's decision on a candidate is final for that pass through the deck, consistent with FR-38's exclusion).
- FR-41: A `LIKE` or `SUPER_LIKE` where the target has already swiped `LIKE`/`SUPER_LIKE` on the caller creates exactly one `Match` row, atomically with the swipe write (no window where two concurrent mutual likes could create two match rows or none).
- FR-42: `Match` rows are canonically ordered (lower user id first) so the same pair can never produce two different-looking match rows depending on who liked whom first.
- FR-43: `Match.source` records which action completed the match (i.e. the second/triggering swipe's action: `SWIPE` for a `LIKE`, `SUPER_LIKE` for a `SUPER_LIKE`) — matches the `source` field sketched in `product.md` §9 (its `ai_search` value is out of scope until the Matchmaker feature exists).
- FR-44: The swipe response reports whether a match was just created and its id, so the client can show a "It's a match" moment immediately rather than polling.
- FR-45: `GET /v1/discovery/matches` returns the caller's matches, most recent first, with the other user's basic profile (display name, age, primary photo, verified badge) — not full chat capability, which doesn't exist yet.

#### 5.3 Structured filters (preferences)
- FR-46: `DiscoveryPreferences` supports: `minAge`/`maxAge` (18–100 bounds, matching FR-20's age floor), `genderPref` (set of genders, empty = no restriction), `relationshipGoalPref` (set of dating-intent values, empty = no restriction), `verifiedOnly` (boolean), `activeThisWeekOnly` (boolean).
- FR-47: **`verifiedOnly` defaults to `true` for every user**, per `product.md` §4's explicit framing of "verified-only as the default discovery filter, not an opt-in" as one of this product's core trust differentiators. A user may turn it off, but the system default must never be off.
- FR-48: "Verified" for this filter means `User.livenessStatus = true` — Verified+ doesn't exist yet, so there's only one verification tier to filter on.
- FR-49: "Active this week" filters candidates whose `lastActiveAt` is within the last 7 days. `lastActiveAt` is stamped on successful OTP verification (login) — the only reliable activity signal that exists so far; a richer presence/heartbeat system is not part of this feature.

#### 5.4 Abuse resistance
- FR-50: Swipe actions are rate-limited per user on a rolling 60-second window, capped at **60 swipes/minute by default** (env var `SWIPE_RATE_LIMIT_PER_MINUTE`, not hardcoded — see `backend/.env.example`), independent of the coarse global API throttle — this directly implements the "swipe velocity anomalies" risk signal `product.md` §5 names under the risk engine. Exceeding it returns 429 and is recorded to `AuditLog` (`SWIPE_RATE_LIMIT_EXCEEDED`), the same abuse-signal pattern already used for OTP/malware/moderation rejections. 60/minute (1/second average) is a first-pass placeholder, not a data-driven figure — tune once real swipe-rate distributions exist.

#### 5.5 API conventions (carried over)
- FR-51: All endpoints require a valid access token, versioned under `/v1`, errors in RFC 7807 format, request bodies validated against explicit DTOs.
- FR-52: A transaction-manager-level failure on the swipe transaction (e.g. the database taking too long to acquire a connection — see `docs/architecture.md` §5.1's Neon cold-start note) surfaces as a 503 with a clear "please try again" message, not a bare 500. **Handled globally** by `ProblemDetailsFilter` (`backend/src/common/filters/problem-details.filter.ts`), which maps a fixed set of transient Prisma error codes (P1001, P1002, P1008, P1017, P2024, P2028) to 503 for every endpoint, not just this one — no per-call-site try/catch needed. The client can rely on 503 specifically meaning "transient, retry," distinct from every other error, app-wide.

### 6. Data model additions (extends §9)

`product.md` §9's high-level sketch names `Match` but not the per-swipe record needed to implement FR-38/FR-40/FR-41 — `Swipe` is a necessary addition beyond that sketch, not a deviation from it.

```
User (new fields)
 ├─ gender          Gender?           -- MALE | FEMALE | OTHER (see Open Items — taxonomy is a technical floor)
 ├─ datingIntent    RelationshipGoal? -- SERIOUS | CASUAL | MARRIAGE_TRACK | FRIENDSHIP | NOT_SURE
 ├─ lastActiveAt    DateTime?         -- stamped on OTP verify (FR-49)
 ├─ index (createdAt, id)             -- FR-36: the deck's ORDER BY + keyset-cursor pagination
 ├─ index (livenessStatus)            -- FR-47/FR-48: verifiedOnly defaults to true, so most deck queries filter on this

DiscoveryPreferences
 ├─ userId (PK/FK), minAge, maxAge, genderPref (Gender[]), relationshipGoalPref (RelationshipGoal[]),
 │  verifiedOnly (default true), activeThisWeekOnly (default false), updatedAt
 │  (userId is the primary key, so it's already indexed for the single-row lookup every read/write does)

Swipe
 ├─ id, actorId, targetId, action (LIKE|PASS|SUPER_LIKE), createdAt
 ├─ unique (actorId, targetId) -- FR-40; also serves FR-38's exclusion check and the reciprocal-like lookup (both are exact-match lookups on this same composite key)
 ├─ index (actorId, createdAt) -- FR-50: rate-limit window count query

Match
 ├─ id, userAId, userBId (canonically ordered, FR-42), source (SWIPE|SUPER_LIKE), createdAt
 ├─ unique (userAId, userBId)
 ├─ index (userAId), index (userBId) -- FR-45: matches-list lookup by either side of the pair
```

**Indexing note:** this covers the query shapes each FR above actually issues, not a full query-plan tuning pass — `product.md` §9's indexing guidance is followed for the known access patterns, but composite indexes for specific optional-filter combinations (e.g. `genderPref` + `datingIntent` together) are deferred until real query-plan data at scale justifies them, per the same section's "not optional afterthoughts, but" framing being about the patterns that are actually known, not speculative ones.

### 7. Security requirements (from §5, scoped to this feature)

- Resource-level authorization: a user can only swipe as themselves, read their own preferences/matches — never on behalf of another user id supplied in a request body.
- Swipe-velocity rate limiting (FR-50) as a concrete implementation of the risk-engine signal `product.md` §5 explicitly calls out by name.
- `verifiedOnly` defaulting to `true` (FR-47) is itself a safety control, not just a UX preference — it's this product's stated trust mechanism, so the default must not silently regress in future changes.
- No candidate data beyond what's needed for the deck/match views is exposed (no phone hash, no raw birthDate — age only, no session/token data).

### 8. Acceptance criteria

- [x] Two consecutive `GET /v1/discovery/deck` calls, chaining the cursor, never return the same candidate twice and never skip one that existed at request time.
- [x] A candidate the caller has passed on does not reappear in any later deck page for that caller.
- [x] Swiping the same target twice returns 409 on the second attempt.
- [x] When user A likes user B, then user B likes user A, exactly one `Match` row exists (not zero, not two), and B's swipe response reports `matched: true`.
- [x] A fresh user's `DiscoveryPreferences.verifiedOnly` is `true` without the client ever having set it.
- [x] With `verifiedOnly = true`, a candidate with `livenessStatus = false` never appears in the deck.
- [x] Exceeding the per-minute swipe rate limit returns 429 and produces a `SWIPE_RATE_LIMIT_EXCEEDED` audit-log entry (unit-tested; not separately re-verified end-to-end via HTTP given the volume of requests needed to trip it safely against the shared rate-limited dev DB).
- [x] All error responses conform to RFC 7807.

### 9. Open items (explicit decisions — flagged for product/legal review, not guessed silently)

1. **Gender taxonomy is a technical minimum** (`MALE`/`FEMALE`/`OTHER`), chosen only because *some* value domain is required to make gender-preference filtering work at all — this is the same "technical floor, not a product decision" pattern as Feature 2's age check. The product may want a richer, more inclusive taxonomy; that's a product decision this document doesn't make.
2. **Distance-radius filtering is deferred**, not silently dropped — see §3. Implementing it for real requires a decision on precise-location collection (§7.4's location-precision toggle was never built) and a geo-index approach (`product.md` §9 indexing notes mention PostGIS or a bounding-box approach), both of which are their own scope.
3. **Discovery lives in one module for now** (`DiscoveryModule`: deck, swipes, matches, preferences). `product.md` §15's sequencing note lists "Matching" and "Discovery" as eventually-separate module boundaries; splitting `Match`-related logic out is a refactor to do once Compatibility Score/AI matching actually lands, not before.
4. **Super Like carries no extra weight or quantity limit in this pass** — it's a distinguishable action for `Match.source` and future analytics, but `product.md` §7.2's "AI-generated match explanation" for Super Likes is out of scope (AI layer excluded from this MVP slice per §15), and no daily-quantity limit is specified anywhere in `product.md`, so none is invented here.

---

## Feature 4: In-App Chat

**Status:** ✅ Shipped, reviewed, approved — fourth MVP feature (per `product.md` §15, item 4: "In-app chat"). **This line was stale** (still read "Draft" despite `docs/roadmap.md` already listing this feature as shipped) — corrected 2026-09-17 after direct verification, not just trusting that prose: confirmed the real, non-mock implementation exists (`ChatGateway`/`ChatController`/`MessageService`/`ConversationAccessService` under `backend/src/modules/chat/`) and `backend/test/chat.e2e-spec.ts` (11 tests) is a real, current e2e suite matching this section's own §8 acceptance criteria.
**Source sections:** `product.md` §7.3 (Communication & Safety), §8.4 (Real-time & media infrastructure), §9 (Data model — `Message`, `Report`), §5 (rate limiting & abuse detection), §8.2 (cursor pagination, API conventions)
**Depends on:** Feature 3 — a `Match` must exist before any chat operation; every check in this feature is downstream of that.

### 1. Goal

Two matched users can exchange text messages that are never lost to a flaky connection (at-least-once, idempotent), delivered in real time when both are online via a WebSocket layer architected for horizontal scaling from day one, gated on the match still being valid and neither party having blocked the other, with a report path always one tap away.

### 2. In scope

- Text messaging between matched users only (FR-53)
- REST for the durable, idempotent write path + history; WebSocket for real-time push (FR-54, FR-58..FR-61 — see Open Items for why split this way)
- Cursor-paginated message history, newest-first (FR-62)
- Mark-as-read (FR-63)
- Block creation + enforcement on send (FR-55, FR-64)
- Minimal report mechanism, reachable from inside the conversation (FR-65)
- Message-send rate limiting (FR-57)

### 3. Explicitly out of scope for this feature

- **Voice/video calling** (§8.4, §15 — separate, later fast-follow item; "blind voice-call CTA" from the swipe deck is part of that, not this)
- **Share My Date** (§15 — deferred)
- **Media/image messages** — §7.3 specifies "Text chat," not media; sending photos/attachments in chat is a distinct, unscoped feature
- **Typing indicators, message editing, message deletion** — not mentioned anywhere in `product.md`; not invented here
- **Full report/block management** (listing your blocks, unblocking, an admin review queue for reports) — that's `product.md` §15's *separate* "Report/block flow" item (roadmap step 5). This feature builds only the minimal `Block`/`Report` primitives chat itself needs (the create path), not the management surface around them.
- **Retroactively excluding blocked users from the Feature 3 swipe deck** — a real behavioral gap (see Open Items), but changing `DeckService` is out of this feature's stated scope; flagged for Feature 5, not silently done here.
- **Proactive scam-pattern/behavioral anomaly detection across a conversation** (`product.md` §5's risk engine) — per-message content moderation is in scope (FR-56); analyzing patterns *across* a conversation over time is a distinct, larger piece of future work.

### 4. User flow

1. Two users match (Feature 3).
2. Either can call `GET /v1/chat/conversations` to see the match listed as a conversation.
3. Client opens it, calls `GET /v1/chat/conversations/:matchId/messages` for history (newest page first).
4. Client connects to the chat WebSocket namespace with its access token; the server joins the socket to a room scoped to that user's id.
5. User sends a message: client generates a `clientIdempotencyKey` (a UUID), calls `POST .../messages`. Server verifies the match, that neither side has blocked the other, that the sender isn't rate-limited, and that the content passes moderation — then persists it.
6. If the client's request fails or times out (a dropped connection, common on this product's target networks per `product.md` §8.8), it retries the *same* POST with the *same* idempotency key. The server returns the already-created message instead of creating a duplicate.
7. If the recipient is currently connected, the server pushes `message:new` to their WebSocket room in real time. Either way, the message is already durably persisted — the next `GET .../messages` call shows it regardless of whether the push was delivered.
8. Either user can call `POST .../read` to mark the other's messages read, or `POST .../block` / `POST .../report` at any point.

### 5. Functional requirements

#### 5.1 Match-gating
- FR-53: Every chat operation (send, fetch history, mark-read, block, report) first verifies the match exists and that the caller is one of its two participants. A caller who isn't a participant, or a match that doesn't exist, gets 403/404 — never a silently empty or filtered result.

#### 5.2 Sending & delivery
- FR-54: Sending is a REST POST carrying a client-generated `clientIdempotencyKey`. A repeated call with the same key, from the same sender, for the same match, returns the original message (200) rather than creating a duplicate — this is what makes "the client can safely retry on any doubt" (product.md §7.3's at-least-once requirement) actually safe.
- FR-55: A message is rejected if a `Block` exists between the two participants in either direction, checked fresh on every send (not cached).
- FR-56: Message content passes through the same `ContentModerationProviderInterface.moderateText` hook already used for profile text (Feature 2's "no field is exempt" principle) before being persisted.
- FR-57: Sends are rate-limited per user on a rolling per-minute window — same mechanism as FR-50's swipe rate limit, separate config (`MESSAGE_RATE_LIMIT_PER_MINUTE`). Exceeding it returns 429 and audit-logs `MESSAGE_RATE_LIMIT_EXCEEDED`.
- FR-58: On successful persist, the server pushes the message to the recipient's connected WebSocket room(s), if any, in real time. This push is best-effort — the REST persist is the durability guarantee, not the push.

#### 5.3 Real-time transport
- FR-59: The WebSocket gateway is backed by a Redis pub/sub adapter (`product.md` §8.4), even though only one backend instance runs today — architected now so adding a second instance later is an infrastructure change, not a rewrite.
- FR-60: WebSocket connections authenticate with the same JWT access token used by REST; no separate auth mechanism.
- FR-61: The gateway is push-only for this feature: clients receive `message:new` events but do not send messages over the socket — sending stays REST-only (see Open Items for the reasoning).

#### 5.4 History & read state
- FR-62: Message history is cursor-paginated (`product.md` §8.2), the same keyset mechanism as Feature 3's deck (`(sortKey, id)`), but ordered **newest-first** to match how a chat thread is actually read — see Open Items for this direction difference from the deck.
- FR-63: Marking read sets `readAt` on every one of the *other* participant's messages in that match that doesn't already have it.

#### 5.5 Safety
- FR-64: A user can block the other participant in a match at any time. The block's effect is bidirectional (either side having blocked the other prevents sending in both directions), though the record itself tracks who initiated it.
- FR-65: A user can report the other participant, optionally referencing a specific message, from inside the conversation itself — `product.md` §7.3's "persistent panic/report button during calls and chat," not something buried in a profile or settings screen.

#### 5.6 API conventions (carried over)
- FR-66: All endpoints require a valid access token, versioned under `/v1`, errors in RFC 7807 format, request bodies validated against explicit DTOs.

### 6. Data model additions (extends §9)

```
Message
 ├─ id, matchId, senderId, content, sentAt, readAt, clientIdempotencyKey
 ├─ unique(matchId, senderId, clientIdempotencyKey) -- FR-54
 ├─ index(matchId, sentAt, id) -- FR-62 cursor pagination

Block
 ├─ id, blockerId, blockedId, createdAt
 ├─ unique(blockerId, blockedId)

Report
 ├─ id, reporterId, reportedId, reason, contextRef (nullable: a matchId or messageId), status (default OPEN), createdAt
```

### 7. Security requirements (from §5, scoped to this feature)

- Resource-level authorization: FR-53 covers REST; on the WebSocket side, a connected socket only ever receives events addressed to its own user id's room, never another user's.
- Block-check (FR-55) and rate limiting (FR-57) are this feature's concrete anti-abuse controls, in the same spirit as the risk-engine signals `product.md` §5 names.
- Message content is never exposed to anyone who isn't a match participant, at either the REST or WebSocket layer.
- Secrets/config (Redis connection info) read from environment, never hardcoded — same standard as every other credential in this project.

### 8. Acceptance criteria

- [ ] A message cannot be sent, read, marked-read, blocked, or reported without an existing match between the two users.
- [ ] Retrying a send with the same idempotency key returns the same message, never a duplicate.
- [ ] A blocked user's send attempt is rejected, verified in both directions (blocker→blocked and blocked→blocker).
- [ ] History pagination via cursor never repeats or skips a message across pages.
- [ ] A message sent while the recipient is connected arrives over their WebSocket in real time.
- [ ] The same message, sent while the recipient is offline, is visible via the REST history endpoint once they reconnect (durability doesn't depend on the push succeeding).
- [ ] Exceeding the message rate limit returns 429 and produces a `MESSAGE_RATE_LIMIT_EXCEEDED` audit-log entry.
- [ ] All error responses conform to RFC 7807.

### 9. Open items (explicit decisions — flagged, not guessed silently)

1. **REST write + WebSocket push, not WebSocket as the write path.** `product.md` §7.3's exact wording ("delivered over a WebSocket connection with at-least-once delivery semantics and client-side message deduplication") could be read as a WS-native send/ack protocol. This document chooses REST for the write path instead, because: (a) it reuses this project's already-proven idempotent-POST + RFC 7807 conventions rather than inventing a parallel ack/retry protocol over raw socket events, and (b) "at-least-once, safe to retry" is straightforward to guarantee correctly with a durable write + a unique constraint, and materially harder to get right with hand-rolled socket-level retry/ack logic. WebSocket is realtime push only. Flagged explicitly as a judgment call.
2. **Redis is a new infrastructure dependency** (`product.md` §8.4) with no hosting decision made yet — needed before the WebSocket gateway can be implemented and actually tested (not just claimed to work), same pattern as the Neon/ClamAV decisions in prior features. Tracked so it isn't guessed at.
3. **Full report/block management is Feature 5's scope.** This feature builds only the create-path primitives (`Block`, `Report` tables + the actions to create them) that chat itself needs to function safely.
4. **Blocked users are not retroactively excluded from the Feature 3 swipe deck by this feature.** A user could theoretically match again with someone they'd previously blocked in an old match. Real gap, explicitly deferred to Feature 5 rather than silently patched into already-shipped Feature 3 code here.
5. **Report `reason` is free text** (length-bounded), not a fixed category enum — `product.md` doesn't specify a reporting taxonomy, so none is invented here; Feature 5's moderation work is the natural place to add structure if the product decides it wants one.

---

## Feature 5: Report/Block Flow

**Status:** ✅ Shipped, reviewed, approved — fifth MVP feature (per `product.md` §15, item 5: "Report/block flow"). **This line was stale**, corrected 2026-09-17 after direct verification: confirmed real `BlockService`/`ReportService`/`SafetyController` (`backend/src/modules/safety/`) and a real, current `backend/test/report-block.e2e-spec.ts` (8 tests).
**Source sections:** `product.md` §7.3 (persistent panic/report button, "report a user"), §8.5 (human review queue, "never rely on automated moderation alone for account-level actions"), §5 (abuse & scam detection, resource-level authorization), §9 (`Report`, `AuditLog`), §10 (e2e journey "…→ report/block", manual QA checklist), §15's engineering-sequencing note (Moderation and Admin as distinct module boundaries), `legal-checklist.md` (notice-and-action mechanism, "do not launch with an unmonitored report queue")
**Depends on:** Feature 3 (`Match`, `DeckService`) and Feature 4 (`Block`, `Report`, `SafetyModule`'s create-path primitives, `AuditLogService`) — this feature completes and generalizes what Feature 4 built minimally for chat's own needs.

### 1. What already exists (Feature 4) vs. what this feature adds

Feature 4 built only the create-path primitives chat itself needed to function safely, and explicitly deferred the rest here (Feature 4 Open Items #3–5). Audited against the current code before writing anything below, so this feature doesn't redo what's already there:

**Already exists, and this feature revises one part of it (flagged, not silent):**
- `Block` model (`blockerId`, `blockedId`, unique pair) and `Report` model (`reporterId`, `reportedId`, `reason` free text, `contextRef`, `status: OPEN|RESOLVED`), both in `backend/prisma/schema.prisma`. Unchanged.
- `BlockService.block()` (idempotent upsert) and `BlockService.isBlocked()` (bidirectional check — the *effect* is already bidirectional even though the row itself records a direction). Unchanged.
- `ReportService.create()` — a thin insert. Unchanged.
- Chat-scoped routes: `POST /v1/chat/conversations/:matchId/block`, `POST /v1/chat/conversations/:matchId/report` (both require an existing match). Unchanged.
- **`MessageService.sendMessage()` currently rejects a blocked send with a 403, symmetrically, for whichever side sends** (FR-55/FR-64 as shipped in Feature 4). **This feature revises that**: a 403 on send is itself an explicit "you've been blocked" signal to whoever receives it, which review feedback on this feature explicitly wants avoided for the blocked party specifically. See §6.1 (FR-69) for the corrected, asymmetric behavior. This was correct and approved scope for Feature 4 (which only needed "sending fails when blocked," not "fails silently, and only for one side") — it wasn't a bug, just a behavior this feature deliberately narrows.

**Missing — what this feature adds:**
- **Block has zero effect outside chat send-blocking.** `DeckService.getDeck()` never references `Block` (confirmed by grep — zero matches). A blocked pair still sees each other in the discovery deck and could match again. This is the gap requirement (1) below closes.
- **`listConversations()` and history/read access don't check `Block` at all** — a blocked match still lists as a live conversation and its history stays readable; only new sends are rejected. Requirement (4) below closes this.
- **`Report.reason` is unstructured free text** — no category enum exists. Requirement (2) below.
- **`ReportService.create()` never calls `AuditLogService`** — report submission produces no audit trail today. Requirement (3) below.
- **No report-listing or review-status-update method exists anywhere**, and **no admin/role concept exists in the codebase at all** (confirmed: zero matches for `admin`/`Roles`/`UserRole`/RBAC across `backend/src`). Requirement (3) below.
- **Block/Report both require an existing match** — there is no way to block or report someone encountered only in the discovery deck, before ever matching. Flagged as a proposed scope addition — see §2 and Open Items #1.

### 2. Goal

A user can block or report anyone they encounter — matched or not — with the block taking effect everywhere (deck, matches, chat), reports categorized rather than free-text-only, and every report both audit-logged and visible to a human reviewer through a minimal (not a full dashboard) admin endpoint, so the app never operates with what `legal-checklist.md` calls "an unmonitored report queue." Critically, the blocked party sees **no explicit signal** that they were blocked — no error, no notification, no visible change — only silence, to avoid giving someone already inclined to harass or retaliate a clear trigger to do so.

### 3. In scope

- Bidirectional block enforcement extended to discovery (deck exclusion) and to existing matches (conversation hidden for the blocker, not just send-blocked) — FR-67..FR-68
- The blocked party sees no explicit sign of the block anywhere — sends still succeed, the conversation just goes silent — FR-69..FR-70
- Block/report reachable from outside an active match, not only from inside chat — FR-71 (proposed extension, flagged for confirmation — see Open Items #1)
- Fixed report-reason category enum, replacing free-text-only — FR-72
- Report submission and resolution both written to `AuditLog` — FR-73, FR-75
- A minimal admin report-review surface: list + resolve, gated by a new `ADMIN` role — FR-74..FR-76

### 4. Explicitly out of scope for this feature

- **Unmatching** (ending a match without blocking) — named separately from "block" in `product.md` §10's manual QA checklist, implying it's its own feature; nothing in `product.md` §7 specifies its behavior (can they re-match later? does it delete history?). Not invented here.
- **Self-service admin-role granting/invite flow** — the new `ADMIN` role is assigned manually (a direct DB update) for this feature; building an admin-invite/permissions-management flow is separate work, out of scope. See Open Items #3.
- **Wiring a "resolved" report to any actual enforcement action** (warning, suspension, ban) — no account-action system exists yet anywhere in the codebase. `product.md` §8.5 is explicit that automated moderation must never drive account-level actions alone, and a human-driven enforcement flow is a distinct, larger feature. This feature stops at "an admin can see reports and mark them reviewed."
- **Unblocking** — no `product.md` section requests it, and it isn't obviously safe to add silently (e.g., should it require the *other* party's blocked status to also clear, or only the blocker's side?). Flagged, not built. See Open Items #4.
- **DSA-style transparency reporting output** (`legal-checklist.md` line 41) — this feature makes the underlying data (`AuditLog`, `Report.category`, `resolvedAt`) queryable enough to produce that later, per the checklist's own "design the pipeline so it can produce this data later without a rebuild" instruction, but does not build any reporting/export surface now.

### 5. User flow

1. **From the deck (new):** a user viewing a candidate card can block or report them directly, with no match required — `POST /v1/users/:userId/block`, `POST /v1/users/:userId/report`.
2. **From an active conversation (existing, unchanged surface):** the same actions via `POST /v1/chat/conversations/:matchId/block` / `.../report`, which resolve to the exact same underlying service calls as (1).
3. **Effect of a block, everywhere, immediately — asymmetric by design:**
   - **Deck (both sides, symmetric):** neither party appears in the other's discovery deck on the next fetch — an absence in a large candidate pool isn't attributable to a block, so this direction is safe to make mutual.
   - **For the blocker (A):** the match disappears from `GET /v1/chat/conversations`; any direct attempt to read history, send, or mark-read on it returns 403, same as if the match didn't exist. The underlying `Match`/`Message` rows are **not deleted** — see Open Items #2 for why.
   - **For the blocked party (B) — deliberately unaffected:** the match still appears in B's conversation list exactly as before; B can still read history and mark-read normally. If B sends a message, it succeeds (201) and is persisted exactly like any other message — B's client shows it as sent, with no error and no notification. It is simply never delivered to A: no real-time push (A's socket, even if connected, never receives it), and A cannot retrieve it via REST either, since A's own access to that match is already fully cut off by the block. From B's side, the conversation just quietly stops getting replies — indistinguishable from A having lost interest.
4. **Filing a report:** the reporter picks a `category` (required) and optionally adds free-text detail (required only if `category` is `OTHER`). The report is persisted, audit-logged, and immediately queryable by an admin — nothing about filing a report notifies or otherwise affects the reported user (silent from their side, per how every mainstream reporting flow works).
5. **Admin review (new, minimal):** an admin calls `GET /v1/admin/reports?status=OPEN` to see the queue, then `PATCH /v1/admin/reports/:id` to mark one resolved (with an optional note). Both actions are audit-logged.

### 6. Functional requirements

#### 6.1 Block enforcement, extended beyond chat send-blocking
- FR-67: `DeckService.getDeck()` excludes any candidate with a `Block` row between the viewer and the candidate in either direction (`blocksMade`/`blocksReceived` relations already on `User` — no new relation needed, only a new `WHERE`/`NOT` clause). As defense-in-depth against a stale client re-submitting swipes for an already-blocked pair, `SwipeService`'s match-creation transaction also refuses to create a `Match` between a blocked pair, even if it somehow received mutual `LIKE`s.
- FR-68: A `Match` where the **caller** has blocked the other participant is excluded from that caller's `GET /v1/chat/conversations`, and a new `ConversationAccessService.assertAccessible()` (layered on top of the existing `assertParticipant()`) treats it as if the match doesn't exist (404) for that caller's attempts at history, send, and mark-read. This applies **only to the blocking side** — see FR-69 for why the other side's access is deliberately left unchanged. **Block and report themselves are exempt from this gate** — both stay reachable via the chat-scoped routes even against a match the caller already blocked (block is already idempotent; report must stay "always reachable," the same FR-65 principle from Feature 4 — someone who blocked defensively must still be able to also file a report on the same match, and gating it would achieve nothing anyway since the standalone routes in §6.3 reach the same target user regardless).

#### 6.2 No observable signal for the blocked party
- FR-69: For the **blocked party**, none of the above applies: their `GET /v1/chat/conversations` still lists the match, `GET .../messages` still returns full history, and `POST .../read` still works — all exactly as if no block existed. This is the concealment goal from review: the blocked party must not be able to infer a block occurred from any change in behavior.
- FR-70: A message sent by the blocked party is accepted and persisted normally (201, same response shape as any other send — no distinct error path, no distinct status code). It is not delivered to the blocker: the WebSocket push step is skipped when a block exists between sender and recipient (checked in the same place, and at the same time, as the existing persist step — not a separate/later cleanup pass), and the blocker cannot retrieve it via REST regardless, since FR-68 already denies the blocker all access to that match. Net effect: the blocked party can keep "sending" into a conversation that has gone permanently one-way, with nothing in the API response ever indicating why.

#### 6.3 Block/report without requiring a match
- FR-71: `POST /v1/users/:userId/block` and `POST /v1/users/:userId/report` perform the same action as the existing chat-scoped routes, without requiring a `Match` to exist. A user may not target their own `userId` (400). The existing chat-scoped routes remain and internally call the same `BlockService`/`ReportService` methods — no duplicated logic between the two entry points.

#### 6.4 Report categorization
- FR-72: `Report` gains a required `category` field, a fixed enum: `SPAM`, `FAKE_PROFILE`, `HARASSMENT`, `SCAM_OR_FINANCIAL`, `OTHER` (the four risk categories named in review, plus an `OTHER` escape hatch so a real report is never forced into a wrong bucket). The existing free-text `reason` field becomes optional detail, required only when `category` is `OTHER`.

#### 6.5 Audit trail
- FR-73: `ReportService.create()` writes an `AuditLog` entry (`REPORT_SUBMITTED`, actor = reporter, target = reported user, metadata = `{ category, contextRef, reportId }`) — closing the gap where report submission currently produces no audit trail at all.
- FR-74: `GET /v1/admin/reports` lists reports (filterable by `status`, cursor-paginated the same way as every other list endpoint in this codebase — `docs/architecture.md`'s established keyset pattern), restricted to callers whose `User.role` is `ADMIN`.
- FR-75: `PATCH /v1/admin/reports/:id` sets `status` to `RESOLVED` (with an optional free-text `resolutionNote`, stamps `resolvedAt`/`resolvedByAdminId`), restricted to `ADMIN`, and writes an `AuditLog` entry (`REPORT_RESOLVED`, actor = the admin).

#### 6.6 Minimal admin access control
- FR-76: `User` gains a `role` field (`UserRole`: `USER` default, `ADMIN`). A new `AdminGuard` rejects any request to an admin-only route where `role !== ADMIN` with a 403. There is no endpoint to grant the `ADMIN` role — see Open Items #3.

#### 6.7 API conventions (carried over)
- FR-77: All endpoints require a valid access token (admin endpoints additionally require `ADMIN`), versioned under `/v1`, errors in RFC 7807 format, request bodies validated against explicit DTOs.

### 7. Data model additions (extends §9 and Feature 4 §6)

```
User
 └─ + role: UserRole (default USER)              -- FR-76

Report
 ├─ + category: ReportReasonCategory (required)   -- FR-72
 ├─ reason: String, now OPTIONAL                  -- FR-72 (was required free text; now detail, required only if category=OTHER, enforced at DTO/service layer not the DB)
 ├─ + resolvedAt: DateTime?                       -- FR-75
 ├─ + resolvedByAdminId: String?                  -- FR-75
 └─ + resolutionNote: String?                     -- FR-75

enum UserRole { USER, ADMIN }
enum ReportReasonCategory { SPAM, FAKE_PROFILE, HARASSMENT, SCAM_OR_FINANCIAL, OTHER }
```

No changes to `Block`, `Match`, or `Message` — block's expanded effect (deck exclusion, conversation hiding) is computed at query time from the existing `Block` table, not stored as new state, so there's nothing to keep in sync or let go stale.

### 8. Security requirements (from §5, scoped to this feature)

- Resource-level authorization: admin routes require both a valid access token *and* `role === ADMIN` — never gated on "the frontend doesn't show the admin screen" (`product.md` §5's explicit principle).
- Block enforcement is evaluated fresh per-request everywhere it applies — a stale/cached check would silently reopen exactly the kind of contact a block exists to prevent.
- **No response, status code, or error message differs for the blocked party as a result of the block** (FR-69/FR-70) — every code path they can trigger returns exactly what it would return if no block existed. This is a genuine constraint on implementation, not just a UX preference: a distinct 403, a different response shape, or even response-timing differences on the blocked path would leak the same information a change in behavior would.
- Filing a report never reveals to the reported user that they were reported, by whom, or why — no notification path exists in this feature, intentionally.
- `AuditLog` entries for report actions are the accountability trail `product.md` §9 requires ("for moderation/admin actions, required for accountability and later compliance reporting") — every state-changing action on a `Report` produces one, not just creation.

### 9. Acceptance criteria

- [ ] After A blocks B, neither appears in the other's discovery deck on the next fetch.
- [ ] After A blocks B, the pre-existing match disappears from **A's** `GET /v1/chat/conversations`, and A's history/send/mark-read attempts on it all return 403.
- [ ] After A blocks B, the same match is **still fully visible and functional for B** — `GET /v1/chat/conversations` lists it, history reads normally, mark-read works.
- [ ] After A blocks B, B sending a new message returns 201 with a normal message body (not an error, not a distinct response shape) and the message is persisted.
- [ ] After A blocks B, a message B sends is **not** delivered to A: no `message:new` WebSocket push reaches A even if A is connected at the time, and A cannot retrieve it via `GET .../messages` (blocked entirely from that match per FR-68).
- [ ] Two automated e2e assertions specifically diff the blocker's vs. blocked party's experience side-by-side for the same block event, to catch any accidental symmetry regression (e.g. someone "fixing" FR-69 back to a 403 because it looks like a bug).
- [ ] The underlying `Match` and `Message` rows still exist in the database after a block (queryable directly, not exposed via any API) — the hide is enforced at the access layer, not by deletion.
- [ ] A block or report can be filed against a user with no existing match, via `POST /v1/users/:userId/block` / `.../report`.
- [ ] A user cannot block or report themselves (400).
- [ ] Submitting a report with `category: OTHER` and no `reason` is rejected (400); the same call with any other category and no `reason` succeeds.
- [ ] Every successful report submission produces exactly one `REPORT_SUBMITTED` `AuditLog` row.
- [ ] `GET /v1/admin/reports` returns 403 for a non-admin caller, and the expected list for an admin.
- [ ] `PATCH /v1/admin/reports/:id` resolves a report, stamps `resolvedAt`/`resolvedByAdminId`, and produces a `REPORT_RESOLVED` audit entry.
- [ ] All error responses conform to RFC 7807.

### 10. Open items (explicit decisions — flagged, not guessed silently)

1. **Block/report without a match (FR-71) is a proposed scope addition, not something explicitly requested.** The four review requirements this feature was scoped from all concern block/report *effects*; none explicitly asked for new entry points. It's included because "جریان کامل Report/Block" (a *complete* report/block flow) and the fact that Feature 4 explicitly deferred "full report/block management" here both point toward closing the obvious gap — today you can only act against someone you've already matched, which is backwards from a safety standpoint (you'd most want to block someone *before* ever exchanging a message with them). Flagged explicitly so it can be confirmed or cut before implementation.
2. **Blocking hides a match/conversation rather than deleting or unmatching it — and does so asymmetrically.** Chosen because (a) `docs/architecture.md` §6's Safe Update Policy bias is against destructive operations, (b) retaining the message history is exactly what makes a report against that same conversation investigable later, and (c) "block" and "unmatch" are named as distinct concepts in `product.md` §10's QA checklist, so quietly making block behave like a delete would blur a boundary the product doc itself seems to draw. If the product intent is closer to "block should also permanently sever the match, not just hide it," that's a different, larger decision — flagged here rather than assumed. **The asymmetry (FR-69/FR-70, added per review feedback on this feature) is a deliberate anti-retaliation measure**, not an oversight: the blocked party keeps full, unchanged access to the conversation and can keep "sending" into it, specifically so that nothing in the API's behavior tips them off that a block happened. The tradeoff this accepts: the blocked party's client has no way to *ever* correctly reflect "this conversation is dead" — it will look permanently, silently unresponsive rather than explicitly closed, indistinguishable from the other person having simply stopped replying. That's the intended effect, not a bug to fix later.
3. **No self-service path to grant the `ADMIN` role** — deliberately out of scope (see §4). For this feature, promoting a user to admin is a manual `UPDATE users SET role = 'ADMIN'` in the database, documented here so it isn't a mystery later. A real admin-invite/permission-management flow is future work, likely alongside the `product.md` §15 "Admin" module boundary once more admin-only features exist to justify building it.
4. **Unblocking is not built.** Not requested by `product.md` or by review, and not obviously safe to default a behavior for (does unblocking one side re-expose the *other* side too, given the block record is one-directional but its effect is bidirectional?). Flagged for a future feature once the product decides what "unblock" should actually do.
5. **Report resolution has no connection to any enforcement action.** `PATCH .../resolve` only changes `Report.status` and records who/when/why in free text — it does not warn, suspend, or ban the reported user, because no such mechanism exists anywhere in the codebase yet. Marking a report resolved today means "a human looked at this," nothing more. Consistent with `product.md` §8.5's explicit rule against automated moderation alone driving account-level actions, but even human-driven enforcement is unbuilt — noted so "resolved" isn't mistaken for "actioned."

---

## Feature 6: Core Settings

**Status:** ✅ Shipped, reviewed, approved — sixth and final MVP feature (per `product.md` §15, item 6: "Core settings (account, privacy, notifications)"). **This line was stale**, corrected 2026-09-17 after direct verification: confirmed real `SettingsService`/`AccountDeletionService`/`SettingsController` (`backend/src/modules/settings/`) and a real, current `backend/test/settings.e2e-spec.ts` (8 tests).
**Source sections:** `product.md` §7.4 ("Privacy controls: precise location toggle (default OFF), 'who can message me' (default: verified-only)"; "Standard settings taxonomy: Account, Privacy & Safety, Notifications (granular), General, destructive actions clearly separated"), §5 ("Privacy-by-default toggles"; "Full data deletion on account removal: real purge within a defined SLA, not soft-delete"; "GDPR-equivalent data deletion flow... including associated messages, photos, and verification records"), §8.2 (session management, carried over from Feature 1's token design), §9 (`settings: notification_prefs, messaging_permission, location_precision`), `legal-checklist.md` ("Implement data retention & deletion in the product itself, not just on paper... full account purge on deletion request")
**Depends on:** Feature 1 (`Session`/`TokenService` — logout is reused, not rebuilt), Feature 2 (`StorageProviderInterface` — the real-file-deletion pattern is reused for account deletion), Feature 3/5 (`DeckService`, `SwipeService` — the new messaging-permission setting is enforced the same way Feature 5 enforces blocks).

### 1. What already exists vs. what this feature adds

Audited against the current code before writing anything below, so this feature doesn't redo or silently duplicate what's already there:

**Already exists, reused unchanged:**
- **Logout.** `POST /v1/auth/logout` (`auth.controller.ts`) takes `{ refreshToken }` and calls `TokenService.revokeRefreshToken()`, which does `updateMany({ where: { refreshTokenHash, revokedAt: null }, data: { revokedAt: new Date() } })` — sets `revokedAt` on exactly the one `Session` row matching the caller's current refresh token. This is already the "logout invalidates the current refresh token" behavior — Feature 6 does not rebuild it, only documents that the requirement is already satisfied (§5.4 below).
- **Real (not DB-row-only) deletion, as a pattern.** `ProfileService.deletePhoto()` calls `storage.delete(photo.storageKey)` (via `StorageProviderInterface` → `LocalDiskStorageProvider`) *before* deleting the `Photo` row, proven by an e2e test that reads the file directly off disk before/after to confirm it's actually gone, not just the DB row. Account deletion reuses this exact pattern for every photo the deleted user owns (FR-84).
- **`AuditLog` already cannot cascade-delete with a `User` row** — it has no foreign key to `User` at all (`actorId` is a bare `String?`, by explicit design per the schema comment: "audit history must survive account deletion for compliance purposes"). This means the review requirement "AuditLog باید... باقی بمونه" is **already structurally guaranteed** by the existing schema, not something this feature needs to newly build — it only needs to keep writing to it before the user row disappears (FR-86).
- **13 of 14 `User`-owning foreign keys are already `onDelete: Cascade`**: `Session`, `ConsentRecord`, `LivenessSession`, `Photo`, `DiscoveryPreferences`, `Swipe` (both directions), `Match` (both directions), `Message`, `Block` (both directions), `Report` (`reporterId`/`reportedId`). A single `prisma.user.delete()` already removes all of these rows at the database level with no additional code — the one exception is `Report.resolvedByAdminId`, which is `onDelete: SetNull` (an admin's past resolutions survive their own account deletion, unattributed). **What Prisma's cascade cannot do is delete files off disk** — that's the one piece this feature must add explicitly (FR-84).

**Missing — what this feature adds:**
- **No privacy fields exist on `User` at all** — no location-precision toggle, no messaging-permission field. `product.md` §5/§7.4's secure-by-default privacy controls are specified but not implemented anywhere. FR-78/FR-79.
- **No notification-preference fields exist on `User`.** FR-81.
- **No account-deletion endpoint or logic exists anywhere in the codebase** (confirmed by grep — zero matches for delete-account patterns). FR-83..FR-86.
- **No settings read/update endpoints exist** — `ProfileService`/`ProfileController` only ever touch bio-type fields (`displayName`, `birthDate`, `city`, `bio`, `interests`, `gender`, `datingIntent`), never privacy or notification settings. FR-80, FR-82.
- **`product.md` §8.2's "device-level session management (user can see and revoke active sessions)" is not implemented** (only single-session, current-token logout exists) — a real gap, but distinct from what was asked for this feature; flagged and deliberately deferred, not silently built here. See §4.

### 2. Goal

A user has real control over their account: privacy settings that default to the safe/private option exactly as specified (not opt-in), notification preferences that persist even though nothing sends real notifications yet, and a delete-account action that actually and irreversibly erases their personal data — profile, photos, messages — within the same request, while the compliance audit trail survives untouched. Logout continues to work exactly as it already does.

### 3. In scope

- Privacy settings: precise-location toggle and "who can message me," both defaulting to the secure option, both actually enforced (not just stored) — FR-78..FR-80
- Notification preferences, persisted only — no delivery mechanism exists yet, and this feature does not build one — FR-81, FR-82
- Real, complete account deletion (profile, photos including the physical files, messages, matches, sessions, consent/liveness records) with `AuditLog` explicitly surviving — FR-83..FR-86
- Logout — confirmed already correct, referenced, not rebuilt — FR-87

### 4. Explicitly out of scope for this feature

- **Multi-device session listing/revocation** (`product.md` §8.2's "user can see and revoke active sessions") — real gap, not built here. Today's `Session` model already has everything a `GET /v1/auth/sessions` + `DELETE /v1/auth/sessions/:id` pair would need (`deviceInfo`, `createdAt`, `lastUsedAt`, `revokedAt`), so this is a comparatively small addition later, but it wasn't part of what was asked for this feature and isn't invented here.
- **Actual notification delivery** (push/SMS/email) — explicitly out per review feedback; this feature only persists the preference. Building delivery is a distinct, later infrastructure feature (a new provider-abstraction, the same pattern as every other external vendor in `docs/roadmap.md`).
- **"General" settings** (language, theme, etc., per `product.md` §7.4's taxonomy) — nothing in `product.md` specifies what these are yet beyond the category name; not invented here.
- **Un-deleting / account recovery / a grace period before purge** — see Open Items #2 for why this reads as intentionally out of scope rather than an oversight.
- **Any change to `DiscoveryPreferences`** (age range, distance, gender/goal filters, verified-only-for-my-own-deck) — that's the *viewer's own* filter, a distinct, already-shipped Feature 3 concept from the *target's* messaging-permission setting this feature adds. Not touched here.

### 5. User flow

#### 5.1 Privacy settings
1. User calls `GET /v1/users/me/settings` and sees `preciseLocationEnabled: false`, `messagingPermission: "VERIFIED_ONLY"` — the secure defaults, without ever having chosen anything (product.md §5: "Privacy-by-default toggles").
2. User calls `PATCH /v1/users/me/privacy` to change either value.
3. **Enforcement is immediate and structural, not cosmetic**: if a user's `messagingPermission` is `VERIFIED_ONLY`, an unverified viewer's deck (`GET /v1/discovery/deck`) stops surfacing them on the next fetch — the same mechanism Feature 5 uses to make a block take real effect in the deck, not just a UI-level restriction that a modified client could bypass.

#### 5.2 Notification preferences
1. User calls `PATCH /v1/users/me/notifications` with any subset of the three granular toggles (FR-81). The response reflects the stored values.
2. **Nothing is sent as a result of this** — there's no push/SMS/email provider wired up yet. This is explicit here so nobody mistakes a 200 response for "the notification pipeline works now."

#### 5.3 Account deletion — gated by a fresh OTP re-verification, decided in review
1. User calls the **existing, unchanged** `POST /v1/auth/otp/request` for their own phone number — no new endpoint for this step, it's the same OTP request flow already built in Feature 1.
2. User calls `DELETE /v1/users/me` with `{ phone, code }` — the phone number and the OTP code just received. There is no `confirm: true` flag; the fresh OTP itself **is** the confirmation, and it's a materially stronger one than a boolean, since a stolen-but-still-valid short-lived access token alone cannot produce a fresh, correctly-verified OTP code (decided explicitly in review: a leaked JWT must not be sufficient to trigger the one irreversible action in the API).
3. The server verifies the OTP exactly the way `POST /v1/auth/otp/verify` already does (reusing `OtpService.verifyOtp()` unchanged — no parallel verification logic), **and additionally checks the verified phone belongs to the caller's own account** (`crypto.hashPhone(phone)` must equal the authenticated caller's own `phoneHash`) — otherwise a valid OTP for a *different* phone number could not be used to delete *this* account.
4. On success, the server writes `AuditLog: ACCOUNT_DELETION_REQUESTED` (actor = the user being deleted, since the row still exists at this point), deletes every `Photo` file from storage, then deletes the `User` row — cascading, at the database level, through `Session`, `ConsentRecord`, `LivenessSession`, `Photo`, `DiscoveryPreferences`, `Swipe`, `Match`, `Message`, `Block`, `Report` (reporter/reported side).
5. All of this happens **synchronously within the request** — by the time the response returns, the purge is already complete, not scheduled. `AuditLog` rows already written (including the one from step 4) are untouched — they have no foreign key to `User` and were never going to cascade.
6. The now-freed `phoneHash` can be used to register a brand-new account immediately — deletion isn't a soft-lock on the phone number.

#### 5.4 Logout (unchanged)
1. User calls `POST /v1/auth/logout` with their current refresh token, exactly as built in Feature 1 — that session's `revokedAt` is stamped, and any future `POST /v1/auth/refresh` attempt with that token is rejected. No new work; referenced here only so Feature 6's requirements list is complete.

### 6. Functional requirements

#### 6.1 Privacy settings, secure by default
- FR-78: `User` gains `preciseLocationEnabled: Boolean` (default `false`) and `messagingPermission: MessagingPermission` (enum `EVERYONE | VERIFIED_ONLY`, default `VERIFIED_ONLY`) — matching `product.md` §5's exact wording ("precise location toggle (default OFF)", "'who can message me' (default: verified-only)"). Because these are column defaults, not application-level fallbacks, every *existing* user gets the secure default retroactively on migration too, not only new signups.
- FR-79: `messagingPermission = VERIFIED_ONLY` is enforced at the same point Feature 5 enforces blocks: `DeckService.getDeck()` excludes a candidate from an unverified viewer's deck when that candidate's `messagingPermission` is `VERIFIED_ONLY`, and `SwipeService`'s match-creation transaction repeats the check as defense-in-depth — a match (and therefore any ability to message) can never form between an unverified viewer and a candidate who restricted themselves to verified-only, the same "prevent it from ever forming" strategy already used for blocked pairs, not a checked-only-at-send-time restriction.
- FR-80: `GET /v1/users/me/settings` returns the caller's current privacy and notification settings together; `PATCH /v1/users/me/privacy` updates `preciseLocationEnabled`/`messagingPermission` (partial updates — either field alone, or both).

#### 6.2 Notification preferences (persisted only)
- FR-81: `User` gains three granular boolean toggles — `notifyOnNewMatch`, `notifyOnNewMessage`, `notifyOnSafetyAlert` (all default `true`, an opt-out model, consistent with these being ordinary engagement notifications rather than a privacy-sensitive default like FR-78's). `PATCH /v1/users/me/notifications` accepts a partial update of any subset.
- FR-82: **No delivery mechanism exists for any of these.** This is not a bug or a stub to quietly fill in later without comment — it's the explicit, reviewed scope of this feature. The stored values are inert until a real push/SMS/email provider is built (`docs/roadmap.md`'s existing "deferred vendor integrations" pattern is the natural place for that, when it happens).

#### 6.3 Account deletion — real purge, not soft-delete, gated by fresh OTP re-verification
- FR-83: `DELETE /v1/users/me` requires `{ phone: string, code: string }` — a **freshly completed OTP re-verification**, decided explicitly in review over a plain `{ confirm: true }` flag, because this is the single irreversible action in the entire API and the app has no password to re-prompt for. The server (a) verifies the code via the existing `OtpService.verifyOtp()` unchanged, and (b) additionally requires the verified phone's hash to match the caller's own `phoneHash` — a valid OTP for a different phone number must not be usable to delete this account. No new OTP-request endpoint is added; step 1 of the flow (§5.3) reuses the existing `POST /v1/auth/otp/request` as-is.
- FR-84: Every `Photo` row owned by the user has its underlying file removed from storage (`StorageProviderInterface.delete()`, the exact mechanism `ProfileService.deletePhoto()` already uses) **before** the `User` row is deleted — cascade deletes the `Photo` rows, but never the files, so this step is mandatory, not optional cleanup.
- FR-85: Deleting the `User` row cascades, at the database level, through every FK already listed in §1 (`Session`, `ConsentRecord`, `LivenessSession`, `Photo`, `DiscoveryPreferences`, `Swipe`×2, `Match`×2, `Message`, `Block`×2, `Report`'s reporter/reported sides) — no application code duplicates what the schema's `onDelete: Cascade` already guarantees.
- FR-86: An `AuditLog` entry (`ACCOUNT_DELETION_REQUESTED`, actor = the user, metadata = nothing sensitive — just a timestamp-equivalent marker) is written before the delete executes. Because `AuditLog` has no FK to `User`, this row (and every prior row naming this user as `actorId`/`targetRef`) survives the deletion untouched — satisfying the review requirement directly, via a property the schema already had.

#### 6.4 Logout (carried over, unchanged)
- FR-87: `POST /v1/auth/logout` (Feature 1) continues to revoke exactly the `Session` matching the supplied refresh token. No behavior change; listed here only so this feature's requirement set is self-contained.

#### 6.5 API conventions (carried over)
- FR-88: All endpoints require a valid access token, versioned under `/v1`, errors in RFC 7807 format, request bodies validated against explicit DTOs.

### 7. Data model additions (extends §9 and Feature 5 §7)

```
User
 ├─ + preciseLocationEnabled: Boolean (default false)        -- FR-78
 ├─ + messagingPermission: MessagingPermission (default VERIFIED_ONLY) -- FR-78
 ├─ + notifyOnNewMatch: Boolean (default true)                -- FR-81
 ├─ + notifyOnNewMessage: Boolean (default true)               -- FR-81
 └─ + notifyOnSafetyAlert: Boolean (default true)              -- FR-81

enum MessagingPermission { EVERYONE, VERIFIED_ONLY }
```

No changes to `Session`, `AuditLog`, `Photo`, or any other model — account deletion relies entirely on FKs and cascade behavior that already exist (§1), and logout relies on `Session.revokedAt`, also already there.

### 8. Security requirements (from §5, scoped to this feature)

- **Privacy defaults are opt-in to loosen, never opt-in to protect** — `preciseLocationEnabled` and `messagingPermission` both default to the private/restrictive option at the database level, so a user who never visits the settings screen is still fully covered, matching `product.md` §5's "Privacy-by-default toggles" principle exactly.
- **Messaging-permission enforcement happens where a match is created or surfaced, not only at send time** — same "prevent contact from ever forming" posture Feature 5 established for blocks, not a send-time check that still lets an unwanted match sit in someone's list.
- **Account deletion is a real, complete, synchronous purge** — no soft-delete flag, no "marked for deletion" intermediate state reachable via any API, satisfying `product.md` §5's explicit "real purge... not soft-delete" and `legal-checklist.md`'s "not just on paper."
- **A stolen or leaked access token alone cannot delete the account** — `DELETE /v1/users/me` requires a freshly-verified OTP, not just the JWT already required for every other authenticated endpoint. This was an explicit review decision: the marginal implementation cost is close to zero (100% reuse of Feature 1's existing OTP request/verify pipeline), and it closes exactly the gap a bare `confirm: true` flag would leave open — a boolean guards against accidental calls, not a compromised token.
- **The compliance audit trail is preserved by construction** (`AuditLog` has no FK to `User`), not by a special case added to the deletion code path that could later be forgotten or bypassed.
- Resource-level authorization: every settings/deletion endpoint acts only on the caller's own account (`request.user.id`), never a `:userId` path param — there is nothing to authorize *against* another user's settings, unlike the admin surface in Feature 5.

### 9. Acceptance criteria

- [ ] A brand-new user's `GET /v1/users/me/settings` shows `preciseLocationEnabled: false` and `messagingPermission: "VERIFIED_ONLY"` without ever calling `PATCH`.
- [ ] An *existing* user created before this feature's migration also reads the same secure defaults (the migration itself, not just new-row defaults, is what's being verified).
- [ ] An unverified viewer's deck excludes a candidate whose `messagingPermission` is `VERIFIED_ONLY`; setting it to `EVERYONE` makes that candidate reappear on the next fetch.
- [ ] `PATCH /v1/users/me/notifications` persists a partial update (e.g., only `notifyOnNewMessage: false`) without disturbing the other two toggles.
- [ ] `DELETE /v1/users/me` without a valid, freshly-verified OTP for the caller's own phone is rejected (401) and nothing is deleted — verified with no code at all, a wrong/expired code, and a *valid* code for a *different* phone number (someone else's), all three rejected.
- [ ] `DELETE /v1/users/me` with a still-valid access token but no fresh OTP step at all is rejected — the JWT alone is never sufficient.
- [ ] After a confirmed deletion: the `User` row, all `Session`/`ConsentRecord`/`LivenessSession`/`Photo`/`DiscoveryPreferences`/`Swipe`/`Match`/`Message`/`Block`/`Report`(reporter+reported) rows referencing that user are gone from the database — verified by direct query, not just via the API.
- [ ] After a confirmed deletion, the photo files that belonged to the user are verified gone from disk directly (same technique as the existing Feature 2 e2e test), not just their DB rows.
- [ ] After a confirmed deletion, an `AuditLog` row with `action: 'ACCOUNT_DELETION_REQUESTED'` and `actorId` equal to the deleted user's former id still exists and is queryable.
- [ ] After a confirmed deletion, the same phone number can complete a fresh OTP request → verify flow and receive a brand-new user id.
- [ ] `POST /v1/auth/logout` still revokes only the session matching the supplied refresh token, and a subsequent `POST /v1/auth/refresh` with that token is rejected — the existing Feature 1 behavior, confirmed still intact.
- [ ] All error responses conform to RFC 7807.

### 10. Decisions (resolved in review before implementation)

1. **DECIDED: `DELETE /v1/users/me` requires a fresh OTP re-verification, not `{ confirm: true }`.** Explicit review decision: this is the single irreversible action in the entire API surface, the app has no password to re-prompt for, and `confirm: true` alone would only guard against an accidental/malformed client request, not a stolen or leaked bearer token — a real gap given the token's TTL, however short. The fix reuses the existing `/v1/auth/otp/request` + `OtpService.verifyOtp()` pipeline unchanged (§5.3, FR-83), so the marginal implementation cost is close to zero. Consistent with how this project has favored the more cautious option throughout (biometric consent gating, fail-closed malware scanning, the block/report design work).
2. **DECIDED: no grace period before purge — deletion is immediate and synchronous.** `product.md` §5's own phrasing ("real purge within a defined SLA, not soft-delete") reads as ruling out a soft-delete-then-purge-later pattern, and no document in this repo specifies a numeric SLA window to design a delay around, so immediate synchronous deletion trivially satisfies "within a defined SLA" without inventing one. A cooling-off period (e.g., 48 hours to cancel) is a legitimate pattern some consumer apps use instead, but would be a materially different design (a soft "pending deletion" state, a scheduled job, a cancel endpoint) — not what's being built here.
3. **DECIDED: accepted as-is — deleting your account also deletes the `Match`/`Message` rows the *other* participant can see, and this is intentional, not an oversight.** Because `Match`/`Message` both cascade from either participant's `User` row, if A deletes their account, B's view of that conversation's history disappears too, with no explicit signal to B beyond the match quietly no longer being there. Confirmed in review as an accepted, known consequence of choosing a real, complete purge (product.md §5's explicit "real purge... not soft-delete") over a soft-delete that would have preserved it — the same security-first tradeoff this project has made consistently, not a gap that needs a workaround. `Report.contextRef` (a `matchId`/`messageId`) already anticipated exactly this: it's explicitly *not* a hard FK, precisely because "the target may later be deleted" (Feature 4's own schema comment). No code change follows from this — it's recorded here so it reads as a deliberate acceptance, not a forgotten side effect.
4. **DECIDED: the three notification-toggle categories (`notifyOnNewMatch`, `notifyOnNewMessage`, `notifyOnSafetyAlert`) stand as designed**, all independently toggleable including `notifyOnSafetyAlert` — `product.md` doesn't specify a taxonomy beyond "granular," and these are the three most obviously distinct categories for this app's core loop. Revisit only if a future feature gives a concrete reason a safety-relevant notification shouldn't be silenceable.
5. **DECIDED: these endpoints live in a new `SettingsModule`, not the existing `UsersModule`.** The original proposal was `UsersModule`, but implementing FR-83 surfaced a real constraint: it needs `JwtAuthGuard` and `OtpService` from `AuthModule`, and `AuthModule` already imports `UsersModule` (for `UsersService`, used by `AuthService.verifyOtp()`) — `UsersModule` importing `AuthModule` back would be a circular module dependency. A new `SettingsModule` (importing `AuthModule` for the guard/OTP-reuse and `ProfileModule` for `STORAGE_PROVIDER`, Feature 2's real photo-deletion mechanism) avoids the cycle entirely and keeps `UsersModule` exactly as small and dependency-free as it already was. `AuthModule` gains `OtpService` to its `exports` list (previously only `TokenService`/`JwtAuthGuard`/`OTP_PROVIDER` were exported) so `SettingsModule` can reuse it without duplicating verification logic.

---

## Feature 7: Real Photo Storage

**Status:** ✅ Shipped, reviewed, approved — first post-MVP hardening item (`docs/roadmap.md`'s "Production Readiness Checklist" — closing an unblocked mock, same priority given to malware scanning in Feature 2). **This line was stale**, corrected 2026-09-17 after direct verification: confirmed the real, non-mock `S3StorageProvider` (`backend/src/modules/profile/storage/`, `LocalDiskStorageProvider` deleted per `docs/roadmap.md` §3) and a real, current `backend/test/storage.e2e-spec.ts` (7 tests).
**Source sections:** `product.md` §8.3 ("Object storage: S3-compatible (with EU-region bucket for GDPR data residency)... served through a CDN"), §5 ("encryption at rest for the database and object storage"), `legal-checklist.md` Part D ("Cloud hosting account with EU data-residency region selected"), Feature 2's own FR-31 ("never served from the same origin as the API," documented then as violated "by necessity" pending this exact feature)
**Depends on:** Feature 2 (`StorageProviderInterface`, `Photo` model, `ProfileService`) — this feature replaces the storage backend, not the upload/moderation/scan pipeline in front of it, which is untouched.

### 1. What already exists vs. what this feature adds

**Already exists, mostly unchanged:**
- `StorageProviderInterface` (`save`, `read`, `delete`) and `Photo.storageKey` (a vendor-agnostic opaque string) — the abstraction this feature was always designed to slot a real vendor behind. No `Photo` schema change is needed for this feature at all.
- The entire upload pipeline in front of storage — malware scan (real, ClamAV), re-encode to WebP, content moderation, position/count limits — Feature 2/2-review work, completely untouched here.
- `ProductionSafetyService` already refuses to boot in production while `STORAGE_PROVIDER` is a mock — this feature is what finally lets that check pass for real.

**Missing — what this feature adds:**
- **No photo URL is exposed anywhere in the API today.** `ProfileService.getProfile()`, `DeckService.getDeck()`, and `ConversationService.listConversations()` all return only a photo `id` (or, for chat, `primaryPhotoId`) — never a URL. The only way to actually fetch photo bytes today is `GET /v1/profile/photos/:id/file`, explicitly documented in its own `@ApiOperation` as `"DEV-ONLY... violates FR-31... replaced by a CDN URL once a real storage vendor is wired in"` — this feature is that replacement, and it touches three call sites, not one, which is why it's being scoped and reviewed as its own feature rather than folded silently into a provider swap.
- **`StorageProviderInterface` has no method that returns a client-fetchable URL** — only `save`/`read`/`delete`, all server-side. FR-89.
- **No real S3-compatible implementation exists** — `LocalDiskStorageProvider` is the only one, writing to a folder on the API server itself. FR-90.

### 2. Goal

Photos are stored in a real, vendor-agnostic S3-compatible backend and served to clients via a URL the client fetches directly — never proxied through the API origin — closing FR-31 for real instead of documenting it as a known violation. The vendor itself (which S3-compatible provider, in which EU region) is a deployment-time configuration choice, not a code change, the same abstraction discipline already used for every other external dependency in this project.

### 3. In scope

- `StorageProviderInterface` gains a URL-generating method — FR-89
- A real S3-protocol implementation, verified against a real (not mocked) S3-compatible server in dev/test — FR-90
- Photo URLs exposed from every place a photo is currently referenced by id only: own profile, deck candidates, chat conversation summaries — FR-91..FR-93
- Retiring the dev-only same-origin file route now that it's no longer needed — FR-94

### 4. Explicitly out of scope for this feature

- **Choosing the actual production vendor** (Cloudflare R2, AWS S3, Backblaze B2, DigitalOcean Spaces, etc.) — out of scope by design, not an oversight: the entire point of building against the S3 protocol is that this becomes a pure configuration decision (endpoint, region, credentials) made later, with zero code change required. See Open Items #1.
- **CDN-fronting** — `product.md` §8.3 says photos should be "served through a CDN." Whether the chosen vendor's URLs are already CDN-backed (true for R2, for instance) or a CDN needs fronting separately is a deployment-topology decision downstream of the vendor choice in the item above, not something this feature's code needs to know about — a presigned/public object URL works identically whether or not a CDN sits in front of it.
- **Multiple image resolutions / responsive delivery** (`product.md` §8.3 mentions "multiple resolutions for responsive delivery") — Feature 2's `ImageProcessorService` re-encodes to a single WebP output today; generating and storing multiple sizes is a real, distinct piece of work, not invented here.
- **Migrating existing photos from local disk to the new backend** — not needed: no real user data exists yet (pre-launch), and every e2e test creates and cleans up its own rows within a single run regardless of which provider is active.
- **Changing anything about the upload/scan/moderation pipeline** — this feature only replaces what happens to bytes *after* they're already validated, scanned, and re-encoded.

### 5. User flow

1. A client uploads a photo exactly as today (`POST /v1/profile/photos`) — malware-scanned, re-encoded, moderated, then handed to `storage.save()`. Unchanged.
2. Wherever a photo was previously exposed as just an `id`, the response now also includes a `url` — freshly generated on every response, not stored, so it's never stale even if the provider's signing scheme or expiry policy changes later:
   - `GET /v1/profile/me` — the caller's own photos.
   - `GET /v1/discovery/deck` — each candidate's photos.
   - `GET /v1/chat/conversations` — the other participant's primary photo.
3. The client loads the image directly from that URL — a request that never touches this API's origin, closing FR-31.
4. `GET /v1/profile/photos/:id/file` (the dev-only route) is gone; there is nothing left that needs it.

### 6. Functional requirements

#### 6.1 Storage interface and real implementation
- FR-89: `StorageProviderInterface` gains `getUrl(key: string): Promise<string>`, returning a **presigned, time-limited URL against a private bucket — never a permanent public link.** Decided explicitly in review, matching this project's security-by-default pattern used everywhere else (precise-location OFF by default, messaging-permission VERIFIED_ONLY by default, fail-closed malware scanning): a permanent public URL would stay fetchable by anyone who ever saw it — screenshotted, logged, scraped from a response — indefinitely, regardless of any later block/deck-exclusion/account-deletion action. Expiry is a config value (`PHOTO_URL_EXPIRY_SECONDS`, default 900 = 15 minutes — long enough that a normal client screen render doesn't race the expiry, short enough to meaningfully bound exposure if a URL leaks), read via `ConfigService` like every other tunable in this project, not hardcoded. This is also why FR-91..FR-93 generate the URL fresh on every response rather than storing it: a persisted URL would either go stale (broken image) or have to be persisted with its own expiry-tracking, neither of which is needed when it's simply recomputed per request.
- FR-90: A new implementation talks to a real object-storage backend over the S3 protocol (`@aws-sdk/client-s3` / `@aws-sdk/s3-request-presigner` — the standard SDK, works against any S3-compatible endpoint by design, not just AWS). Verified in **two stages**, decided explicitly in review: (a) day-to-day dev/test iteration against a real, locally-run S3-compatible server (MinIO — see Open Items #2 for why local here, unlike Neon/Upstash), and (b) **at least one real verification pass against an actual cloud S3-compatible vendor** (Cloudflare R2) — ✅ **done**, both stages, config-only (zero code change between vendors, the entire premise of building to "the S3 protocol"). See §9 acceptance criteria and `docs/architecture.md` §5.4 for the full R2 verification trail.

#### 6.2 Exposing photo URLs (the three call sites, FR-31 closure)
- FR-91: `ProfileService.getProfile()`'s `photos` array gains `url` alongside the existing `id`/`position`.
- FR-92: `DeckService.getDeck()`'s `DeckCandidate.photos` gains `url` the same way.
- FR-93: `ConversationService.listConversations()`'s `otherUser` gains a `primaryPhotoUrl` alongside the existing `primaryPhotoId` (additive — `primaryPhotoId` is not removed, per the Safe Update Policy).

#### 6.3 Retiring the dev-only shim
- FR-94: `GET /v1/profile/photos/:id/file` and `ProfileService.getPhotoFile()` are removed. This was explicitly documented as a temporary, dev-only stand-in when it was built (Feature 2), not a permanent contract — removing it here is closing an announced gap, not an undocumented breaking change.

#### 6.4 API conventions (carried over)
- FR-95: All endpoints require a valid access token, versioned under `/v1`, errors in RFC 7807 format, request bodies validated against explicit DTOs.

### 7. Data model additions

None. `Photo.storageKey` (Feature 2) is already a vendor-agnostic opaque string — this feature changes what's behind `StorageProviderInterface`, not the schema.

### 8. Security requirements (from §5, scoped to this feature)

- **Photos are never proxied through the API origin** — closing FR-31 for real, not just documenting the gap. A URL is handed to the client; the client fetches bytes directly from the storage vendor.
- **Encryption at rest** (`product.md` §5) is a vendor-selection requirement, not something this feature's code enforces — every mainstream S3-compatible vendor supports it, so the actual obligation is "pick one that has it enabled," tracked alongside the vendor decision itself (Open Items #1).
- **EU data residency** (`legal-checklist.md` Part D, `product.md` §8.3) is likewise a configuration/vendor-selection concern (bucket region), not enforced in code — flagged so it isn't lost between "the interface is vendor-agnostic" and "therefore nobody has to think about where the bucket actually lives."
- Generated URLs are produced fresh per API response, never persisted — avoids ever serving a stale or expired URL, and means a provider's signing/expiry policy can change without any data migration.

### 9. Acceptance criteria

- [ ] `ProductionSafetyService`'s check for `STORAGE_PROVIDER` passes (no longer flags a mock) once the real provider is wired.
- [ ] A photo uploaded through the real HTTP endpoint is verifiably retrievable from the real (dev/test) S3-compatible server directly — not just "the API claims success."
- [ ] `GET /v1/profile/me`, `GET /v1/discovery/deck`, and `GET /v1/chat/conversations` all return a working photo URL, fetchable with a plain HTTP client with no Authorization header and no dependency on this API being reachable.
- [ ] A returned photo URL is verifiably **not** a permanent public link: it carries a signature/expiry, and the *same* URL string, retried again after the configured expiry window, is rejected by the storage backend — not just "assumed to expire" because it looks presigned.
- [x] The full upload → URL → fetch → delete flow is verified at least once against a real external cloud vendor (proposed: Cloudflare R2), not only against the local MinIO instance — proving genuine S3-protocol portability, not just that the code works against the one implementation it was developed against. **Done**: real R2 credentials (`STORAGE_ENDPOINT` pointed at a real `*.r2.cloudflarestorage.com` account, `STORAGE_REGION=auto`) were swapped into `backend/.env` temporarily and the full real pipeline ran against them — `storage.e2e-spec.ts`'s presigned-URL expiry/signature-shape tests (2/2), `profile.e2e-spec.ts`'s full real upload→scan→moderate→store→fetch→delete flow (6/6, including the real-deletion-from-storage check), and `discovery`/`chat`/`report-block` e2e specs that assert real fetchable photo URLs (11/11) — all passed against the live R2 endpoint with zero code changes, config-only. `.env` was reverted to MinIO afterward for local dev; see `docs/architecture.md` §5.4 for the full trail, including one transient 503 (ClamAV/OpenAI contention under back-to-back real calls, not an R2/storage defect — reproduced clean on retry, twice) and the one sub-check *not* run against R2 (least-privilege cross-bucket denial — needs Cloudflare account-level admin credentials to provision a throwaway foreign bucket, not provided; already proven against MinIO via the identical S3-protocol code path).
- [ ] `GET /v1/profile/photos/:id/file` no longer exists (404/removed route, not just deprecated).
- [ ] Deleting a photo (`DELETE /v1/profile/photos/:id`) still actually removes the object from the real backend — the same real-deletion verification technique already used in Feature 2's e2e test, now against the real provider instead of local disk.
- [ ] All error responses conform to RFC 7807.

### 10. Open items (explicit decisions — flagged, not guessed silently)

1. **The actual production vendor is not chosen here.** `product.md` §17 already lists this as an open decision; this feature makes the code layer indifferent to the answer (any S3-compatible endpoint works unchanged), but someone still has to pick one, confirm its EU region + encryption-at-rest settings, and provision credentials before production can use it — a business/ops decision, not something to guess at in a requirements doc.
2. **DECIDED, and checked rather than assumed: dev/test backing store is a real, locally-run S3-compatible server (MinIO), reversing the Neon/Upstash precedent of always preferring a cloud service over a local Windows install — because that precedent's actual reason (native Windows support being genuinely poor for Postgres and especially Redis) doesn't apply here.** Verified directly before deciding, not asserted from memory: `winget install MinIO.Server` completed cleanly with no manual config file, no separate database/definitions directory (unlike `clamd`'s setup), no service-registration step; `minio.exe server <path>` started a real server on the first try; `curl` against it returned a genuine S3-protocol response (`AccessDenied` XML on the bucket root, `200` on the health-check endpoint) — real S3 traffic, not a stub. This is simpler than ClamAV's Windows setup, which this project already accepted as a real local install. **Because MinIO alone only proves one S3-compatible implementation works, not that the code is genuinely vendor-portable, FR-90 requires a second, real verification pass against an actual cloud vendor (Cloudflare R2's free tier proposed) before this feature counts as done** — that step needs real external credentials, requested once implementation is otherwise ready, the same way Neon's and Upstash's connection strings were obtained mid-feature rather than upfront.
3. **`primaryPhotoUrl` is added alongside `primaryPhotoId` in chat conversation summaries, not as a replacement.** Keeping the `id` around means a client that only needs to key/cache by photo identity doesn't have to parse a URL to get one — a minor design call, flagged rather than assumed not to matter.

---

## Feature 8: Real Content Moderation

**Status:** ✅ Shipped, reviewed, approved — second and final "unblocked mock" hardening item (`docs/roadmap.md`'s Production Readiness Checklist — same priority sequencing as malware scanning and photo storage before it). **This line was stale**, corrected 2026-09-17 after direct verification: confirmed the real, non-mock `OpenAiContentModerationProvider` plus the `ModerationFlag` review-queue model (`backend/src/common/moderation/`) and a real, current `backend/test/moderation.e2e-spec.ts` (6 tests).
**Source sections:** `product.md` §8.5 ("automated image moderation (nudity/violence classifiers) and text moderation (harassment, scam-pattern keyword/behavioral detection) on all profile content before publish, plus a human review queue for user reports — never rely on automated moderation alone for account-level actions like bans"), `legal-checklist.md` Part C ("Notice-and-action mechanism for illegal content/user reports, with a documented appeals process"; "design the reporting/moderation pipeline... so it can produce this data later without a rebuild")
**Depends on:** Feature 2 (`ContentModerationProviderInterface`, the three call sites), Feature 5 (`AdminModule`/`AdminGuard` — the review-queue surface reuses this exact pattern, not a new one), Feature 7 (`STORAGE_PROVIDER` — reused to hold flagged images so a human reviewer can actually see what was rejected).

### 1. What already exists vs. what this feature adds

**Already exists, unchanged:**
- `ContentModerationProviderInterface` (`moderateImage(data: Buffer)`, `moderateText(text: string)`, both returning `{approved, reason?}`) and `MockContentModerationProvider` (always approves, `isMock = true`), in a `@Global()` `ModerationModule`.
- All three call sites already wired correctly: `ProfileService.updateProfile()` (bio text), `ProfileService.uploadPhoto()` (the re-encoded WebP, after malware scan), `MessageService.sendMessage()` (chat text, after rate-limiting). Each already audit-logs a distinct rejection action (`PROFILE_TEXT_MODERATION_REJECTED`, `PROFILE_PHOTO_MODERATION_REJECTED`, `MESSAGE_TEXT_MODERATION_REJECTED`) and throws `422` with the vendor's `reason`. **None of this call-site wiring needs to change** — only what's behind the interface, and what happens to a rejection afterward.
- `AdminModule`/`AdminGuard`/the cursor-paginated list + resolve pattern from Feature 5 — this feature's review queue reuses the exact same shape (`GET`/`PATCH`, `AdminGuard`, oldest-first FIFO), not a new design.

**Missing — what this feature adds:**
- **No real vendor is wired** — `MockContentModerationProvider` always approves, meaning `product.md` §8.5's nudity/violence/harassment classifiers don't actually run on anything today.
- **Nothing is persisted when content is rejected.** A rejected bio edit, photo, or message is simply never written to the database — the 422 response and the audit-log entry are the *only* trace. This means, critically, **there is currently no way for a human to ever review a moderation decision** — not because a queue exists and is empty, but because the rejected content itself is gone the instant the request fails. `product.md` §8.5's "human review queue" cannot be built as a thin list-view over existing data the way Feature 5's report queue was; the content has to be deliberately retained somewhere first. This is the central design problem this feature solves — see §5 and Open Items #2.
- **No resilience around the vendor call exists at any of the three sites** — confirmed by reading all three: no timeout handling, no retry, and critically no defined behavior if the vendor is unreachable or errors. Today that would surface as an unhandled 500. FR-100.

### 2. Goal

Real vendor classifiers actually run on every profile bio, profile photo, and chat message before it's accepted — closing the gap where `MockContentModerationProvider` currently approves everything unconditionally — and every rejection is retained somewhere a human can actually see it and review it, closing the second gap where a rejection today leaves no reviewable trace at all. Consistent with `product.md` §8.5's explicit rule, a human reviewing a rejection can mark it reviewed for accountability and vendor-quality tracking; it does not, by itself, retroactively publish the content or take any account-level action — that stays a human-driven decision outside this feature's scope, same as Feature 5 left report resolution deliberately disconnected from enforcement.

### 3. In scope

- Real text + image moderation vendor(s), wired behind the unchanged `ContentModerationProviderInterface` — FR-96
- Fail-closed behavior on vendor timeout/error, mirroring the ClamAV precedent — FR-100
- A `ModerationFlag` record created on every rejection, retaining enough of the actual content for a human to evaluate it later — FR-97
- A minimal admin review surface (list + resolve), reusing Feature 5's `AdminModule`/`AdminGuard` pattern exactly — FR-98, FR-99
- Quarantined flagged photos cleaned up on account deletion, extending `AccountDeletionService` — FR-101

### 4. Explicitly out of scope for this feature

- **Automatically re-publishing content when an admin overturns a rejection.** Marking a flag `OVERTURNED` is a record of the decision (accountability, vendor-quality signal, satisfies `legal-checklist.md`'s "documented appeals process") — it does not recreate the `Photo` row, restore the bio text, or send the message. Doing that for real would mean building a distinct publish-on-appeal pipeline for three different content types with three different side effects; a materially larger feature than "review and record a decision," and not what was asked for. Flagged explicitly — see Open Items #3.
- **Any user-facing notification that their content is under review, or any appeal-request UI.** The review queue is an internal admin process, invisible to the end user — the same silence-by-design already established for Feature 5's report flow (the reported party is never told). A user who gets rejected still just sees the existing 422 response, unchanged.
- **"Scam-pattern keyword/behavioral detection"** (`product.md` §8.5's own phrase, and §5's "automated pattern detection for romance-scam behaviors... informed by documented 'pig butchering' patterns") — this is a distinct, larger risk-engine capability (cross-message/cross-session behavioral analysis), not a per-message content classifier. Confusing it with this feature's per-item moderation would silently under-scope a much bigger piece of future work. Not touched here; `ContentModerationProviderInterface.moderateText()` continues to be a single-message/single-field check only.
- **Moderating anything not already moderated today** (interests, display name, city, etc.) — this feature swaps the vendor behind the three existing call sites, it doesn't add new ones. `product.md` §8.5 says "all profile content," which is a real, pre-existing gap (display name and interests aren't moderated today either) — but that gap predates this feature and isn't silently expanded into scope here. Flagged for a separate decision, not assumed.

### 5. User flow

1. A user edits their bio, uploads a photo, or sends a message — exactly as today. `ProfileService`/`MessageService` call `moderateText()`/`moderateImage()` at the same points as now.
2. **On approval:** nothing changes from today's behavior.
3. **On rejection:** the existing 422 + audit-log behavior is unchanged, **and now additionally** a `ModerationFlag` row is created capturing the user, content type, the vendor's stated reason, and the content itself — the actual rejected text, or (for a photo) the flagged image bytes copied into a quarantine location in the same storage bucket Feature 7 already wired up, since the "real" upload was never persisted anywhere.
4. **On vendor failure** (timeout, 5xx, unparseable response): the request fails closed — a 503, the same posture as a `clamd` outage — rather than silently treating unscanned content as approved.
5. **Admin review (reused surface):** an admin calls `GET /v1/admin/moderation-flags?status=PENDING_REVIEW` to see the queue — including, for a flagged photo, a presigned URL to actually view it — then `PATCH /v1/admin/moderation-flags/:id` to mark it `UPHELD` or `OVERTURNED` with an optional note. Both actions are audit-logged, matching Feature 5's pattern exactly.

### 6. Functional requirements

#### 6.1 Real vendor(s), fail-closed
- FR-96: `ContentModerationProviderInterface` is implemented by a real provider calling actual text/image moderation vendor API(s) — see Open Items #1 for vendor selection, which needs a decision (and real API credentials) before this can be built and verified, the same as Redis/Upstash and the pending R2 verification did.
- FR-100: A vendor timeout or error is treated as **fail-closed** — the request is rejected (503, matching `ProblemDetailsFilter`'s existing transient-error convention) rather than the content being silently treated as approved. Mirrors `ClamAvMalwareScanProvider`'s exact fail-closed design from Feature 2, applied here to moderation instead of malware scanning.

#### 6.2 Retaining what was rejected, so it can be reviewed at all
- FR-97: On any rejection at any of the three call sites, a `ModerationFlag` row is created: `contentType` (`BIO_TEXT | PHOTO | MESSAGE`), the reporter's `userId`, the vendor's `reason`, and the content itself — `textContent` for bio/message, or `quarantineStorageKey` for a photo (the already-malware-scanned, already-re-encoded WebP bytes, written to the same `STORAGE_PROVIDER` bucket under a distinct key so `getUrl()` can generate a review URL for it the same way it already does for published photos). `contextRef` (a `matchId`, for a rejected message) is stored the same way Feature 4/5 already use it for `Report`.

#### 6.3 Minimal admin review surface (reusing Feature 5's exact pattern)
- FR-98: `GET /v1/admin/moderation-flags` lists flags (filterable by `status`, cursor-paginated oldest-first, same as `GET /v1/admin/reports`), restricted to `ADMIN` via the existing `AdminGuard` — no new guard, no new pagination logic.
- FR-99: `PATCH /v1/admin/moderation-flags/:id` sets `status: RESOLVED` with a required `resolution` (`UPHELD | OVERTURNED`) and an optional `resolutionNote`, stamps `resolvedAt`/`resolvedByAdminId`, restricted to `ADMIN`, and writes an `AuditLog` entry (`MODERATION_FLAG_RESOLVED`, actor = the admin) — same shape as `PATCH /v1/admin/reports/:id`.

#### 6.4 Integration with account deletion (Feature 6)
- FR-101: `AccountDeletionService` is extended to delete every quarantined photo (`ModerationFlag.quarantineStorageKey`, where set) from storage for the user being deleted, **before** the `User` row is deleted — exactly the same pattern already used for real `Photo` rows, extended to cover this second place a user's image bytes can live. `ModerationFlag` rows themselves cascade-delete with the `User` row (`onDelete: Cascade`), the same real-purge posture Feature 6 already established for `Match`/`Message` (an accepted, not accidental, consequence — see Feature 6 Open Items #3 for the precedent this follows).

#### 6.5 API conventions (carried over)
- FR-102: All endpoints require a valid access token (admin endpoints additionally require `ADMIN`), versioned under `/v1`, errors in RFC 7807 format, request bodies validated against explicit DTOs.

### 7. Data model additions

```
ModerationFlag
 ├─ id, userId, contentType (BIO_TEXT|PHOTO|MESSAGE)
 ├─ textContent (nullable — set for BIO_TEXT/MESSAGE)
 ├─ quarantineStorageKey (nullable — set for PHOTO)
 ├─ reason (the vendor's stated reason)
 ├─ contextRef (nullable — e.g. matchId for a rejected message)
 ├─ status (PENDING_REVIEW default | RESOLVED)
 ├─ resolution (nullable — UPHELD | OVERTURNED, set on resolve)
 ├─ resolutionNote, resolvedAt, resolvedByAdminId (nullable, onDelete: SetNull — mirrors Report.resolvedByAdminId)
 └─ createdAt

 @@index([status, createdAt])   -- FR-98 admin queue list

enum ModerationContentType { BIO_TEXT, PHOTO, MESSAGE }
enum ModerationFlagStatus { PENDING_REVIEW, RESOLVED }
enum ModerationFlagResolution { UPHELD, OVERTURNED }
```

`User` gains one new relation (`moderationFlagsResolved`, mirroring `reportsResolved` from Feature 5) for the `resolvedByAdminId` back-reference. `userId`'s own FK is `onDelete: Cascade` (FR-101).

### 8. Security requirements (from §5, scoped to this feature)

- **Fail-closed on vendor failure** (FR-100) — an unreachable moderation vendor must never be indistinguishable from "everything's fine," the same principle already enforced for malware scanning.
- **Quarantined flagged images are only ever exposed via the same presigned, time-limited URL mechanism Feature 7 built** (`STORAGE_PROVIDER.getUrl()`) — never a permanent link, and only reachable by an authenticated `ADMIN`, unlike a published profile photo's URL which any authenticated user can be handed.
- **Resource-level authorization**: the admin review endpoints act on `ModerationFlag` records, never expose one user's flag data to another non-admin user — there is no non-admin read path to `ModerationFlag` at all.
- Consistent with Feature 5's principle: resolving a flag is an accountability record, never itself an account-level enforcement action — `product.md` §8.5's explicit rule that automated moderation (and, by the same logic, a human's *review* of it) must not alone drive bans or similar actions.

### 9. Acceptance criteria

- [ ] `ProductionSafetyService`'s check for `CONTENT_MODERATION_PROVIDER` passes (no longer flags a mock) once the real provider is wired.
- [ ] A bio edit, photo upload, and message send that should genuinely fail moderation (real vendor call, real objectionable content, e.g. a standard moderation-API test string) are all rejected (422) exactly as today.
- [ ] Each of the three rejection types produces exactly one `ModerationFlag` row with the correct `contentType` and the actual content retrievable from it (`textContent` readable directly; a flagged photo's `quarantineStorageKey` resolves to a real, fetchable presigned URL via the same storage backend as Feature 7).
- [ ] Simulating a vendor timeout/error produces a 503, not a 500 and not a silent approval.
- [ ] `GET /v1/admin/moderation-flags` returns 403 for a non-admin caller, and the expected list (filterable by status) for an admin.
- [ ] `PATCH /v1/admin/moderation-flags/:id` resolves a flag with either resolution, stamps `resolvedAt`/`resolvedByAdminId`, and produces a `MODERATION_FLAG_RESOLVED` audit entry.
- [ ] Deleting an account (Feature 6's `DELETE /v1/users/me`) removes that user's quarantined flagged-photo files from storage, verified by direct read against the storage backend, the same technique already used for real `Photo` files.
- [ ] All error responses conform to RFC 7807.

### 10. Open items (explicit decisions — flagged, not guessed silently)

1. **Vendor selection is not decided here and blocks implementation, the same way it did for Storage/R2.** Unlike Storage, there is no simple "run a real instance locally for free" equivalent to MinIO for ML-based content classifiers — building and verifying this for real needs actual vendor API credentials from the start, not partway through. Two separate vendor decisions are actually needed (text and image can be different vendors):
   - **Text moderation**: OpenAI's Moderation API is a reasonable default candidate — free per-request, simple bearer-token auth, and its built-in categories (harassment, hate, sexual, violence, self-harm) map well onto "harassment" from `product.md` §8.5's text-moderation phrase.
   - **Image moderation** (nudity/violence classifiers specifically): candidates include AWS Rekognition (`DetectModerationLabels`), Google Cloud Vision (SafeSearch Detection), and Sightengine — each has *some* free allotment, but exact current limits/pricing aren't asserted here with confidence since terms change; whichever is chosen should have its actual free-tier terms confirmed at signup time, not assumed from this document.
   - Flagged here for a decision (and account creation) before FR-96 can be built, the same way Neon/Upstash/R2 needed real credentials provided mid-feature rather than guessed at upfront.
2. **Retaining the actual rejected content (not just metadata) is a deliberate choice, not a data-minimization oversight.** A review queue that only recorded "someone's bio was rejected for X reason" without the bio text itself would be unreviewable — a human couldn't judge a vendor's decision without seeing what it judged. This does mean `ModerationFlag` holds real user-authored content (including, for photos, images that were flagged for nudity/violence) — mitigated by admin-only access, presigned time-limited URLs for images (same as everything else in Feature 7), and cascading deletion on account removal (FR-101) rather than indefinite retention. Flagged as a real tradeoff, not something to gloss over.
3. **Overturning a flag doesn't republish the content (see §4).** If the actual product need is "a false-positive should be recoverable by the user without re-submitting from scratch," that's a materially larger feature (three separate publish-on-appeal pipelines) than what's built here, and should be scoped deliberately later, not discovered as a gap.
4. **`display name` and `interests` are still not moderated**, matching today's behavior — `product.md` §8.5 says "all profile content," which arguably includes these, but that gap predates this feature (Feature 2 never moderated them either) and isn't silently absorbed into this feature's scope. A future decision, not an oversight of this one.

---

## Feature 9: AI Prompt Search (text + voice)

**Status:** ✅ Shipped, reviewed, approved — first Phase 2/AI-layer feature (`product.md` §7.2's "AI Prompt Search," explicitly deferred out of Feature 3 — see that feature's §3 and Open Items #4). **This line was stale**, corrected 2026-09-17 after direct verification: confirmed the real `ai-search` module (`backend/src/modules/discovery/ai-search/`, real OpenAI extraction/embeddings, no mock) and a real, current `backend/test/ai-search.e2e-spec.ts` (12 tests).
**Source sections:** `product.md` §7.2 ("AI Prompt Search: free-text query → structured-output LLM call extracts filters... → hybrid structured-filter pre-pass + embedding-based semantic ranking against bios/interests"), §8.5 ("Prompt-to-filter parsing: LLM call using structured/function-calling output... not free-text parsing with regex"; "Semantic matching: embedding model over user bios/interests + the parsed prompt, cosine similarity ranking via pgvector, blended with the structured filter pre-pass"), §5 (rate limiting / abuse resistance)
**Depends on:** Feature 3 (`DeckService`'s exclusion/preference-filter logic and `DiscoveryPreferences` — reused, not duplicated), Feature 8 (the project's existing, working OpenAI integration and real `OPENAI_API_KEY` — see Open Items #1 for why this feature proposes reusing that vendor rather than opening a new one).

### 1. What already exists vs. what this feature adds

**Already exists, unchanged:**
- `DeckService.getDeck()`'s hard-exclusion `where` clause (self, incomplete profiles, already-swiped in either direction, blocked in either direction, the FR-79 messaging-permission gate) and `DiscoveryPreferences` (age range, gender, relationship goal, verified-only, active-this-week).
- A real, working OpenAI integration (`OPENAI_API_KEY`, active billing, `fetch`-based calls with no SDK dependency — Feature 8's precedent).
- `cursor.util.ts`'s `(sortKey, id)` keyset-pagination pattern, currently hardcoded to a `Date` sort key.

**Missing — what this feature adds:**
- **No AI search path exists at all.** `GET /v1/discovery/deck` is structured-filters-only, exactly as Feature 3 scoped it. There is no free-text or voice entry point anywhere in the system.
- **No embedding infrastructure exists.** Nothing in the schema stores a vector; pgvector is not enabled on the database; no code has ever called an embeddings API.
- **No audio-upload path exists.** `FileInterceptor`'s in-memory-buffer pattern (Feature 2's photo upload) is the closest precedent, but nothing today accepts or transcribes audio.
- **`cursor.util.ts` cannot paginate a ranked (non-timestamp) result set** — semantic-similarity ordering needs a numeric sort key, which the shared utility doesn't support today.

### 2. Goal

An authenticated user can describe who they're looking for in a single free-text sentence, in Persian, typed or spoken, and get back a real, ranked, cursor-paginated list of actual candidates from the database — never a fabricated one — filtered through the exact same safety/exclusion rules the structured deck already enforces (blocked users, already-swiped users, the verified-only floor), with the user seeing and explicitly confirming what the system understood from their prompt before any search actually runs.

### 3. In scope

- `POST /v1/discovery/ai-search/extract` — free-text prompt in, structured filter chips + the (possibly normalized) query text out. Nothing is searched yet. FR-103, FR-104.
- `POST /v1/discovery/ai-search/transcribe` — audio file in, transcribed Persian text + the same structured filter chips out (internally calls the identical extraction logic as the text path — one implementation, two entry points). FR-105..FR-108.
- `POST /v1/discovery/ai-search` — confirmed/edited filters + query text in, cursor-paginated ranked real candidates out. FR-109..FR-114.
- Rate limiting, separately configured for text vs. voice (voice materially more expensive per request). FR-115.
- Explicit, distinct failure behavior when the AI vendor is unreachable, with a documented client fallback to the existing `GET /v1/discovery/deck`. FR-116.

### 4. Explicitly out of scope for this feature

- **Matchmaker mode's "curated set" framing, Compatibility Score, and Smart Boost** (`product.md` §7.2) — this feature builds the AI Prompt Search mechanism specifically; the broader "Matchmaker" discovery mode as a distinct tab/experience, the longer-running Compatibility Score (which `product.md` §7.2 describes as "learned over time" from behavioral signals this project doesn't collect yet), and Smart Boost are separate, larger pieces of scope not silently absorbed here.
- **"Why You Two?" explainability text** — `product.md` §7.2 describes this for AI-suggested matches generally; this feature returns ranked candidates, not a per-candidate generated explanation. A future addition, not assumed here.
- **Distance-radius filtering** — still not built, for the exact reason Feature 3 already deferred it (§3, Open Items #2 there): no precise-location capture flow exists. A prompt mentioning a neighborhood/city still only matches against the free-text `city` field, same limitation as the structured deck.
- **Voice input for anything other than search** (e.g. voice notes in chat — `product.md` §19.3, explicitly a separate Phase 2 item with its own open questions) — this feature's Whisper integration is scoped to the search prompt only.
- **Real-time/streaming transcription** — the voice endpoint accepts a complete, already-recorded audio file and returns one final transcript; it does not stream partial results while the user is still speaking.
- **A general-purpose "chat with an AI matchmaker" conversational interface** — this is a single-turn prompt → filters → results flow, not a multi-turn conversation that remembers prior turns.

### 5. User flow

**Text:**
1. User types a free-text prompt (e.g. "یه نفر جدی، اهل کتاب، تو تهران، که ورزش هم دوست داشته باشه") and calls `POST /v1/discovery/ai-search/extract`.
2. Server extracts structured filters via a real LLM call (FR-104) and returns them as discrete, individually-labeled fields (e.g. `city: "تهران"`, `relationshipGoal: "SERIOUS"`) alongside the original text — never a search result yet.
3. Client renders these as chips/labels; the user reviews, can edit or remove any of them, and explicitly confirms.
4. Client calls `POST /v1/discovery/ai-search` with the confirmed filters and the query text, paginating with the returned cursor exactly like `GET /v1/discovery/deck`.

**Voice:**
1. User records up to the configured max duration and calls `POST /v1/discovery/ai-search/transcribe` with the audio file.
2. Server transcribes it with Whisper, forced to Persian (FR-105), discards the audio bytes immediately (FR-106), then runs the transcript through the exact same extraction call as the text flow (FR-108) — one implementation.
3. Server returns **both** the transcribed text and the extracted chips. Client shows the transcript itself (so the user can catch a mishearing) as well as the chips, exactly as in the text flow — the user can edit either before confirming.
4. Same as text step 4 from here — a distinct `POST /v1/discovery/ai-search` call, never triggered automatically from the transcription response.

**Either path, at search time:**
5. Server applies the hard structured-filter pre-pass (FR-109), reusing Feature 3's exact exclusion logic plus the confirmed filters — narrowing the real candidate pool.
6. Server embeds the confirmed query text and ranks the surviving candidates by cosine similarity against each candidate's precomputed bio/interests embedding (FR-111).
7. Server returns real `DeckCandidate` rows only, ranked, cursor-paginated (FR-113) — or an honest empty list if nothing matches (FR-114), never synthesized results.

### 6. Functional requirements

#### 6.1 Text extraction
- FR-103: `POST /v1/discovery/ai-search/extract` and `POST /v1/discovery/ai-search` are two distinct calls — extraction never executes a search by itself, and a search can only run against filters the client explicitly submits (i.e., the user has had the chance to see and edit them client-side). The server does not infer that silence means confirmation of anything beyond what's in the second request's body.
- FR-104: Filter extraction uses a real LLM call with structured/function-calling output (`product.md` §8.5 — explicitly not regex or hand-written free-text parsing). The output schema contains **only** filter parameters (city, age-range hints, gender/relationship-goal hints if stated, a normalized semantic-query string) — **never** candidate or profile data of any kind, which is what makes FR-114's no-hallucination guarantee structurally true rather than just a prompt instruction (see §6.4).

#### 6.2 Voice extraction
- FR-105: `POST /v1/discovery/ai-search/transcribe` accepts a single audio file (`multipart/form-data`, in-memory `FileInterceptor`, the same pattern as Feature 2's photo upload — no temp file), transcribes it via a real speech-to-text call **forced to Persian** (not auto-detected), and feeds the resulting text through the identical extraction call FR-104 uses for typed text — no separate/duplicated extraction logic for the voice path.
- FR-106: The uploaded audio bytes are held only in memory for the duration of the transcription call and are never written to disk, the database, or any `STORAGE_PROVIDER` bucket — discarded the instant transcription completes (or fails). Verified directly in acceptance testing, not assumed (§9).
- FR-107: Recordings are capped at a maximum duration (target: 30–45s, see Open Items #4 for how this is actually enforced) and validated against a fixed allow-list of audio formats before being sent to the transcription vendor; anything outside either bound is rejected before any vendor call is made, not after — oversized uploads via the existing global Multer `LIMIT_FILE_SIZE` handling (413, `ProblemDetailsFilter`'s established convention for that exact case), an unsupported format via a new explicit check (400). Two different, both-already-idiomatic status codes for two different kinds of rejection, not one artificial code forced onto both.
- FR-108: The transcribed text is returned to the client alongside the extracted filters (§5, Voice step 3) — it is never used to execute a search directly from within the transcription response; the same confirm-or-edit gate from FR-103 applies identically to the voice path.

#### 6.3 Two-stage retrieval: hard filter, then semantic ranking
- FR-109: The hard structured-filter pre-pass reuses `DeckService`'s exact exclusion `where`-clause construction (self, incomplete profiles, already-swiped in either direction — FR-38 — blocked in either direction — FR-67 — the FR-79 messaging-permission gate), extracted into a shared method both `DeckService.getDeck()` and this feature call — not reimplemented or copy-pasted.
- FR-110: **The verified-only floor (FR-47: defaults to `true`, "the system default must never be off") cannot be turned off by anything extracted from a prompt, typed or spoken.** Only the user's own `DiscoveryPreferences.verifiedOnly` toggle — set the same way it already is today, outside this feature — can do that. The extraction schema (FR-104) has no field capable of expressing "include unverified users," by construction, not by a filter applied after the fact that could be forgotten.
- FR-111: Among candidates surviving FR-109's hard filter, results are ranked by cosine similarity between an embedding of the confirmed query text and each candidate's precomputed bio/interests embedding (`User.bioEmbedding`, pgvector), computed via a parameterized raw SQL query (`Prisma.sql` tagged templates only — **never string-concatenated SQL**, since this is the first raw-SQL query in this codebase and the precedent matters for anything that follows it).
- FR-112: Candidate embeddings are **precomputed**, not computed per search request: `ProfileService.updateProfile()` recomputes `User.bioEmbedding` synchronously whenever `bio` or `interests` changes, in the same request that already calls `moderateText()` on that content (Feature 8) — one additional real vendor call in an existing flow, not a new background-job system. **A candidate with no `bioEmbedding` yet is not excluded from results** — excluding them would mean a user is invisible to AI Prompt Search from the moment they sign up until they happen to re-save their bio, directly working against the product's core goal of being seen (explicit decision, reversing this document's original draft). Instead: `ORDER BY (bioEmbedding <=> :queryEmbedding) ASC NULLS LAST, createdAt ASC, id ASC` — every un-embedded candidate that survives FR-109's hard filter is still returned, appended after every ranked candidate, ordered by recency among themselves rather than semantic relevance (which doesn't exist for them yet). See Open Items #3 for the backfill this still requires to make ranking meaningful for the *existing* user base on day one.

#### 6.4 No fabricated results
- FR-113: Results are cursor-paginated using a `(distance, createdAt, id)` keyset, where `distance` is nullable (FR-112's `NULLS LAST` ordering) — `cursor.util.ts` is extended to support this triple, not duplicated into a second, parallel pagination utility. `createdAt` breaks ties among un-embedded candidates (who share a `null` distance); `id` remains the final tiebreaker for the identical reason FR-36's `(createdAt, id)` tiebreaker exists: no earlier key in the tuple is guaranteed unique by itself.
- FR-114: If zero candidates survive FR-109's hard filter, or if a search legitimately returns nothing worth ranking, the response is an honest empty result — the same shape as any other zero-result page — never a model-generated or otherwise synthesized candidate. This is structurally guaranteed, not just tested for: every candidate returned by `POST /v1/discovery/ai-search` is a real row read from `User`/`Photo` via the FR-109/FR-111 query, and FR-104's extraction schema has no field through which profile-shaped data could enter the response at all.

#### 6.5 Abuse resistance and cost control
- FR-115: Text and voice each have their own configurable, independently-tuned rolling-window rate limit (`AI_SEARCH_TEXT_RATE_LIMIT_PER_MINUTE`, `AI_SEARCH_VOICE_RATE_LIMIT_PER_MINUTE` — voice defaults materially lower, since Whisper is billed separately from the text/embedding calls), enforced the same way as FR-50 (a DB row-count query over a trailing 60s window, `TooManyRequestsException`, an `AI_SEARCH_RATE_LIMIT_EXCEEDED` audit-log entry on the exceeded mode). Both `extract`/`transcribe` and the final `ai-search` call count against their respective mode's limit, since all three are real vendor calls with real cost.

#### 6.6 Vendor-failure handling
- FR-116: A failure at any real vendor call in this feature (extraction, transcription, or embedding) returns a clear, distinct `503` (`ProblemDetailsFilter`'s existing transient-error convention) rather than crashing (500) or returning a silently empty/degraded result. This is a **UX-availability fallback, not a security fail-closed** — unlike Feature 2/8's malware-scan/moderation posture (where an unreachable vendor must block the action for safety), a failed AI search has a safe, already-existing fallback: the response's `detail` explicitly names `GET /v1/discovery/deck` as the client's next step, since structured-filter search doesn't depend on any of this feature's vendor calls at all.

#### 6.7 API conventions (carried over)
- FR-117: All three endpoints require a valid access token, are versioned under `/v1`, validate request bodies against explicit DTOs, and return errors in RFC 7807 format.

### 7. Data model additions

```
User (new field)
 ├─ bioEmbedding   Unsupported("vector(1536)")?   -- FR-112: precomputed on bio/interests write; null is a valid, expected, non-excluding state (FR-112/FR-113's NULLS LAST ranking), not an error state

AiSearchRequest
 ├─ id, userId, mode (TEXT|VOICE), createdAt
 ├─ index (userId, createdAt)   -- FR-115: rate-limit window count query, mirrors Swipe's (actorId, createdAt)

enum AiSearchMode { TEXT, VOICE }
```

**Two raw-SQL-only additions Prisma's schema DSL cannot express**, both required and both handled as raw SQL inside a migration, not assumed to "just work":
- `CREATE EXTENSION IF NOT EXISTS vector;` on the database itself (Neon — needs to be confirmed to actually support this before relying on it, see Open Items #2), plus `previewFeatures = ["postgresqlExtensions"]` and `extensions = [vector]` in `prisma.config.ts`'s generator/datasource blocks so Prisma is aware of the type even though it can't model vector operations natively (`Unsupported("vector(1536)")` is read/written only via `$queryRaw`/`$executeRaw`, never through the normal Prisma Client query builder).
- A vector similarity index (`ivfflat` or `hnsw`, exact choice an implementation detail informed by pgvector's own current guidance at build time) on `User.bioEmbedding` — without one, FR-111's ranking query is a full table scan of every embedded user on every search, which will not scale even at moderate user counts.

### 8. Security requirements (from §5, scoped to this feature)

- **All raw SQL is parameterized via `Prisma.sql` tagged templates — never string interpolation/concatenation** (FR-111), the same standard this project already holds itself to everywhere else, now explicitly stated for the first raw-SQL query it's ever needed.
- **The verified-only floor cannot be bypassed via prompt content** (FR-110) — a deliberate, structural guard against a new injection surface this feature introduces that didn't exist before (a natural-language input feeding into a filter that gates account safety).
- **Resource-level authorization**: a user can only search as themselves; there is no field anywhere in any of the three request bodies that accepts another user's id.
- **No candidate data beyond `DeckCandidate`'s existing shape is exposed** (the same fields Feature 3 already established) — this feature changes ranking and entry points, not what's visible about a candidate.
- **Audio is never retained** (FR-106) — the closest thing to biometric-adjacent data this feature touches, even though it's used only for transcription, not voice-print identification; treated with the same "don't keep what you don't need" discipline as Feature 1's zero-retention liveness capture.
- **Rate limiting is dual-purpose here**: abuse resistance (same principle as FR-50) and real cost control, since every request in this feature — extraction, transcription, and search — is a billed external vendor call, unlike most of this API.

### 9. Acceptance criteria

- [ ] A realistic Persian prompt run through the real (not mocked) extraction endpoint produces the expected filter chips — checked against several representative prompts, not one cherry-picked example.
- [ ] At least one test sends a real audio file to the real Whisper API and asserts on the actual returned transcript (not a stubbed response) — the explicit standard requested for this feature, matching the EICAR/presigned-URL/least-privilege precedent of testing the real boundary, not a mock of it.
- [ ] A prompt that explicitly asks to include unverified users (e.g. "حتی کاربرهای تاییدنشده رو هم نشون بده") still only returns verified candidates unless the caller's own `DiscoveryPreferences.verifiedOnly` is separately `false` — a real security-boundary test, run against the real extraction call, not asserted from reading the code.
- [ ] A candidate the caller has blocked, been blocked by, or already swiped on never appears in AI-search results, verified the same way Feature 3/5's own exclusion tests are (real DB state, real query).
- [ ] With two or more real seeded candidates and a real embedding call, a semantically closer candidate ranks above a less relevant one for the same query — not asserted from an assumption that pgvector "should" work.
- [ ] A real candidate with no `bioEmbedding` yet (e.g. never having saved a bio) still appears in results when they pass the hard filter — after every ranked candidate, not omitted entirely — proving FR-112's "never excluded" decision is actually true of the query, not just the intent.
- [ ] Two consecutive `POST /v1/discovery/ai-search` calls, chaining the cursor, never return the same candidate twice and never skip one that existed at request time.
- [ ] A query matching no one returns an empty list, not an error and not a fabricated candidate.
- [ ] Exceeding the text and, separately, the voice rate limit each return 429 with the correct `AI_SEARCH_RATE_LIMIT_EXCEEDED` audit entry (unit-tested, matching Feature 3's own precedent for not re-verifying via HTTP given the request volume needed to trip it safely).
- [ ] Simulating a vendor failure (extraction, transcription, or embedding) returns 503 naming the `GET /v1/discovery/deck` fallback, not a 500 and not an empty 200.
- [ ] Directly verified (not assumed): after a `transcribe` call completes, the uploaded audio bytes are not present anywhere the app can reach them — no temp file, no `STORAGE_PROVIDER` object, no DB row containing the raw audio.
- [ ] All error responses conform to RFC 7807.

### 10. Open items (explicit decisions — flagged, not guessed silently)

1. ~~Vendor/model choice~~ — ✅ **Decided.** OpenAI for all three real calls: a structured-output-capable chat model for FR-104's extraction, `text-embedding-3-small` for FR-111/FR-112's embeddings (1536 dimensions, hence the schema in §7), and `whisper-1` for FR-105 with `language: "fa"` forced. Reuses the already-integrated account (real key, active billing, Feature 8's precedent) — no new vendor onboarding needed.
2. ~~pgvector support on Neon~~ — ✅ **Verified empirically against the real dev database, not assumed.** `pg_available_extensions` reports `vector` 0.8.6 (with `ivfflat`/`hnsw` access methods) available on this Neon instance; `CREATE EXTENSION vector` succeeded; a real temp-table cosine-distance query (`<=>`) ranked three known vectors in the mathematically correct order — checked through **both** the direct and the pooled (`DATABASE_URL`) connection strings, since the app's actual runtime queries go through the pooled one. No blocker.
3. ~~Existing/newly-registered users with no `bioEmbedding` yet~~ — ✅ **Decided: never excluded from results.** Full exclusion would make a brand-new user invisible to AI Prompt Search until they happen to re-save their bio — directly against the app's core goal of being seen. Resolved via FR-112/FR-113's `NULLS LAST` ordering: un-embedded candidates that pass the hard filter are still returned, just unranked (appended after every semantically-ranked candidate, ordered by recency among themselves). A one-time backfill script (batch-embed every existing `User` with a non-null `bio`) is still needed so the *existing* user base gets real ranking from day one, rather than everyone pre-dating this feature landing in the unranked tail together — in scope for this feature's implementation, not deferred.
4. ~~Audio-duration enforcement~~ — ✅ **Decided: a file-size ceiling, explicitly documented as a deliberate approximation.** Precisely enforcing "30–45 seconds" would need an audio-metadata/decoding dependency (e.g. `music-metadata`) this project doesn't have yet; the size cap is a coarser, dependency-free proxy for duration, **not a measurement of actual decoded duration** — a sufficiently dense/high-bitrate short clip could in principle hit the size ceiling before 30–45s of audio, and a very sparse/low-bitrate clip could in principle stay under it well past that. Recorded here explicitly so this gap reads as a known, intentional trade-off later, not a bug someone has to rediscover.
5. ~~Allow-listed audio formats/codecs for FR-107~~ — ✅ **Decided: confirm against the chosen vendor's (OpenAI/Whisper, per Open Items #1) real, current documentation at implementation time** rather than hardcoding a guessed list into this document.

---

## Feature 10: Super Like explanation, Smart Boost, "Why You Two?"

**Status:** ✅ Shipped, reviewed, approved — closes three items `product.md` §7.2 names but earlier features explicitly deferred: Super Like's "AI-generated match explanation" (Feature 3 §9 Open Items #4), Smart Boost (Feature 3 §3, Feature 9 §4), and "Why You Two?" explainability (Feature 3 §3, Feature 9 §4 — "a future addition, not assumed here"). **This line was stale**, corrected 2026-09-17 after direct verification: confirmed the real `boost`/`match-explanation` modules (`backend/src/modules/discovery/`, including the later grounding-check hardening documented in `docs/roadmap.md`'s Watch items) and a real, current `backend/test/match-explanation-boost.e2e-spec.ts` (12 tests).
**Source sections:** `product.md` §7.2 ("Swipe deck: like / pass / Super Like (with AI-generated match explanation)"; "Smart Boost: time-boxed visibility increase, constrained to users matching the requester's own filter/AI profile"; "'Why You Two?' explainability: every AI-suggested match includes a short, evidence-based reason grounded strictly in profile data the user actually entered — never invented content"), §15 (Smart Boost listed among MVP fast-follows).
**Depends on:** Feature 3 (`SwipeService`, `DeckService`, `MatchService`, `DiscoveryPreferences`), Feature 9 (the real OpenAI integration pattern, `cursor.util.ts`'s ranked-triple cursor, and the exact "resilient, fail-open, never block the underlying action" precedent `ProfileService.recomputeBioEmbedding()` established).

### 1. What already exists vs. what this feature adds

**Already exists, unchanged:**
- `SwipeAction.SUPER_LIKE` and `MatchSource.SUPER_LIKE` — a Super Like is already distinguishable end-to-end, it just carries no extra behavior today (Feature 3 §9 Open Items #4, verbatim: "no extra weight or quantity limit... AI-generated match explanation... out of scope").
- `GET /v1/discovery/matches` — lists the caller's matches with the other participant's basic profile; no explanation field exists on this response today.
- `cursor.util.ts`'s `(distance, sortKey, id)` ranked-triple cursor (Feature 9, FR-113) — built generically enough to reuse here for a boost tier instead of a semantic distance.
- A real, working OpenAI integration (`OPENAI_API_KEY`, `fetch`-based, no SDK) and the established "ground a generation call in only the real fields provided, fail open, never block the underlying action" pattern from Feature 9's embedding precompute.

**Missing — what this feature adds:**
- **No explanation of any kind is ever generated for a match** — `GET /v1/discovery/matches` returns only the fixed fields Feature 3 defined. `product.md`'s "Why You Two?" and Super Like's "AI-generated match explanation" are both entirely unbuilt.
- **No boost mechanism exists at all** — no way for a user to increase their own visibility, time-boxed or otherwise, and no ordering tier beyond `DeckService`'s plain `(createdAt, id)`.
- **No reciprocal-preference check exists anywhere in the codebase.** Every existing filter (`buildSafetyExclusionWhere`, `DiscoveryPreferences` filtering in `DeckService`/`AiSearchService`) is one-directional — "does the candidate satisfy the viewer's preferences" — never "does the viewer satisfy the candidate's own preferences," which Smart Boost's "constrained to the requester's own filter" needs.

### 2. Goal

A Super Like carries a short, real, evidence-grounded reason (generated once, at the moment it's sent) that surfaces to the other person if a match later forms from it. Every match — regardless of how it formed — gets its own "Why You Two?" reason, grounded strictly in what both users actually entered in their profiles, never invented. A user can activate a time-boxed Smart Boost that promotes them ahead of other candidates in a viewer's deck, but only for viewers the *booster's own* discovery preferences would also want to see — not a blanket visibility purchase.

### 3. In scope

- A shared, fail-open "match explanation" generation call, grounded only in fields both users actually set — FR-118..FR-121.
- `Match.whyYouTwo`, lazily generated on first read of `GET /v1/discovery/matches` and persisted — FR-122, FR-123.
- Synchronous explanation generation at Super Like time, stored on the `Swipe` row, reused (not regenerated) if that swipe later becomes a match — FR-124, FR-125.
- `POST`/`GET /v1/discovery/boost` — activate and check a time-boxed boost — FR-126, FR-127.
- Boost-aware deck ordering, reciprocally constrained to the booster's own `DiscoveryPreferences`, reusing Feature 9's ranked-cursor mechanism — FR-128, FR-129.
- Rate limiting on boost activation — FR-130.

### 4. Explicitly out of scope for this feature

- **A "who liked/super-liked me" inbox.** No such surface exists anywhere in this codebase today, and building one is real, separate scope (a new read model, new privacy/visibility questions of its own). Without it, there is no way for a recipient to see a Super Like's explanation *before* a match forms — see Open Items #1 for the resulting design consequence and the alternative this document does **not** silently assume.
- **Smart Boost affecting `POST /v1/discovery/ai-search` (Feature 9) ranking.** `product.md`'s "requester's own filter/**AI profile**" phrasing could be read as also promoting boosted users within AI Prompt Search's semantic ranking — but layering a boost tier on top of an already-tiered (ranked vs. unranked) semantic ordering compounds complexity in a way that deserves its own deliberate decision, not a silent merge. This feature's boost only affects `GET /v1/discovery/deck`. See Open Items #2.
- **Compatibility Score.** `product.md` §7.2 describes it as blending "behavioral signals (which past matches led to real conversations/dates), learned over time" — this project collects no such signal yet (Feature 3 and Feature 9 both already deferred this explicitly for the same reason). "Why You Two?" here is grounded in static profile fields only, never a learned score.
- **Any daily/lifetime quantity limit on Super Likes.** Still not specified anywhere in `product.md` (Feature 3's own Open Items #4 already made this call); not invented here either. The *rate limit* this feature adds (FR-130) is for boost activation only, a distinct concern from Super Like quantity.
- **Push/SMS/email delivery of an explanation.** Confirmed unchanged from Feature 6 (FR-82): no notification delivery mechanism exists in this codebase. Every explanation here is surfaced only via an existing pull-based REST read (`GET /v1/discovery/matches`), never pushed.

### 5. User flow

**Super Like:**
1. User A calls `POST /v1/discovery/swipes` with `action: SUPER_LIKE` on candidate B, exactly as today.
2. Server generates a real, grounded explanation from A's perspective about B (FR-124) and stores it on the `Swipe` row — the swipe still succeeds even if generation fails (FR-121).
3. If this swipe completes a mutual match (unchanged logic from Feature 3), the new match's `whyYouTwo` is set directly from that stored explanation (FR-125) — no second generation call.

**Regular match ("Why You Two?"):**
4. A mutual match forms via two plain `LIKE`s, exactly as today — no explanation exists yet.
5. Either participant calls `GET /v1/discovery/matches`. If that match's `whyYouTwo` hasn't been generated yet, the server generates and persists it now (FR-122), grounded in both participants' actual profile fields; if generation fails, the field is simply `null` this time and will be retried on a later read.

**Smart Boost:**
6. User calls `POST /v1/discovery/boost`. If they don't already have one active, a boost starts immediately for a configured duration (FR-126).
7. For the duration of the boost, any OTHER user whose own `DiscoveryPreferences` the booster satisfies sees the booster promoted ahead of non-boosted candidates in their `GET /v1/discovery/deck` results (FR-128) — never bypassing that viewer's own filters, only reordering within what they'd already see.
8. `GET /v1/discovery/boost` lets the booster check remaining time at any point.

### 6. Functional requirements

#### 6.1 Shared explanation generation (grounded, fail-open)
- FR-118: A shared generation call produces a short (1-2 sentence) explanation grounded **only** in fields both users have actually set: `bio`, `interests`, `city`, `datingIntent`, `gender`, and age (derived from `birthDate`). Reuses the real OpenAI integration pattern (Feature 9) — `fetch`-based, no SDK — with a system prompt that explicitly instructs the model to use only the facts supplied and never invent shared experiences, physical descriptions, or assumptions beyond them.
- FR-119: **Not prompt instruction alone — a second, real, structured-output verification call checks the generated explanation before it's ever persisted or returned**, mirroring FR-104/FR-110's "verify structurally, don't just trust the instruction" discipline rather than relying on the same call that might already be hallucinating to also self-report faithfully. Given the same fact set plus the generated text, this second call returns `{ grounded: boolean, unsupportedClaim: string | null }` (OpenAI Structured Outputs, `strict: true` — same mechanism as FR-104's schema). If `grounded: false`, the explanation is discarded — treated exactly like a generation failure (FR-121's fail-open path), **never surfaced**, not corrected or retried automatically. This is a real, additional vendor call (a deliberate cost, not an oversight) and is still not a perfect guarantee — a second LLM call can itself be wrong — but it is a genuine structural check that exists, not zero validation beyond prompt wording. See Open Items #3 for the honest limit of what this does and doesn't guarantee.
- FR-120: A grounding field that's `null`/unset for either participant is simply omitted from the prompt's context, not invented or guessed — a match between two sparse profiles gets a shorter, more generic explanation, never a fabricated specific one.
- FR-121: Generation is **fail-open, mirroring `ProfileService.recomputeBioEmbedding()`'s exact precedent, not FR-100/FR-110's fail-closed posture** — a vendor failure (generation *or* FR-119's grounding-check call) never blocks the swipe or hides the match; the explanation field is simply `null` until a later successful attempt. This is a UX nice-to-have, not a safety-relevant gate, so there is nothing to fail closed *for*.

#### 6.2 "Why You Two?" for every match
- FR-122: `Match.whyYouTwo` is generated lazily: the first time `GET /v1/discovery/matches` is called by either participant after a match exists with `whyYouTwo IS NULL`, the server generates it (FR-118) and persists it before returning — every subsequent read for that match returns the persisted value with no further vendor calls.
- FR-123: `GET /v1/discovery/matches`' response gains `whyYouTwo: string | null` per match (`null` only if generation hasn't succeeded yet).

#### 6.3 Super Like's own explanation
- FR-124: A `SUPER_LIKE` swipe synchronously generates an explanation (FR-118, grounded in the swiper's and the target's profiles) and stores it on the `Swipe` row (`Swipe.aiExplanation`) before the swipe response is returned. Fails open per FR-121 — the Super Like itself always succeeds.
- FR-125: When a match is created and its triggering swipe was a `SUPER_LIKE` with a non-null `aiExplanation`, `Match.whyYouTwo` is set directly from it at match-creation time (no duplicate generation call) — and the match response additionally carries `matchSource: 'SUPER_LIKE' | 'SWIPE'` (from the already-existing `Match.source`) so the client can frame a Super Like's explanation distinctly from a regular match's.

#### 6.4 Smart Boost — activation
- FR-126: `POST /v1/discovery/boost` creates a new `Boost` row for the caller (`startsAt: now`, `endsAt: now + BOOST_DURATION_MINUTES`) — rejected with `409` if the caller already has a `Boost` with `endsAt > now` (one active boost at a time, not stackable).
- FR-127: `GET /v1/discovery/boost` returns `{ active: boolean, endsAt: Date | null }` for the caller's current boost state.

#### 6.5 Smart Boost — deck ranking, reciprocally constrained
- FR-128: `GET /v1/discovery/deck` promotes a candidate with `Boost.endsAt > now` ahead of non-boosted candidates in the returned order — **but only if the viewer satisfies that candidate's own `DiscoveryPreferences`** (the viewer's age falls in the booster's `minAge`/`maxAge`, the viewer's `gender` is in the booster's `genderPref` if set, the viewer's `datingIntent` is in the booster's `relationshipGoalPref` if set) — the literal implementation of "constrained to users matching the requester's own filter." A boosted candidate the viewer's own filters would already exclude (FR-37..FR-49, unchanged) never appears at all, boosted or not — the boost only reorders within what the viewer's own preferences already allow through.
- FR-129: Ordering becomes a tiered `(boostTier, createdAt, id)` keyset — `boostTier = 0` for boosted-and-reciprocally-matching candidates, `1` otherwise — implemented by reusing `cursor.util.ts`'s existing `encodeRankedCursor`/`decodeRankedCursor` (Feature 9, FR-113) with the tier value standing in for the "distance" slot, rather than adding a third, parallel pagination utility.

#### 6.6 Abuse resistance
- FR-130: Boost activation is rate-limited (`BOOST_RATE_LIMIT_PER_DAY`, configurable, a first-pass placeholder like FR-50's 60/minute — not a data-driven figure), enforced with the same rolling-window DB-count pattern as FR-50/FR-115, counting the caller's own `Boost` rows created in the last 24 hours.

#### 6.7 API conventions (carried over)
- FR-131: All endpoints require a valid access token, are versioned under `/v1`, validate request bodies against explicit DTOs, and return errors in RFC 7807 format.

### 7. Data model additions

```
Swipe (new field)
 └─ aiExplanation   String?   -- FR-124: generated at Super Like time only; null for LIKE/PASS and on generation failure

Match (new fields)
 ├─ whyYouTwo   String?   -- FR-122/FR-125: lazily generated (regular) or copied from the triggering Swipe (Super Like)
 -- `source` already exists (FR-43, Feature 3) — reused as-is for FR-125's matchSource framing, not duplicated

Boost
 ├─ id, userId, startsAt, endsAt, createdAt
 ├─ index (userId, endsAt)   -- FR-126/FR-128: "is there an active boost" lookups
 ├─ index (userId, createdAt) -- FR-130: rate-limit window count query
```

`User` gains one new relation (`boosts`), `onDelete: Cascade` — a deleted user's boost history is purged with them, the same real-purge posture every other per-user table in this codebase already has.

### 8. Security requirements (from §5, scoped to this feature)

- **The reciprocal-preference check (FR-128) is a read-only reordering signal, never a bypass.** It is evaluated strictly *after* the viewer's own hard-exclusion/preference `where` clause (FR-37..FR-49, `buildSafetyExclusionWhere`) has already run — a boosted candidate the viewer's own filters exclude is never returned, boosted or not.
- **Boost activation is resource-scoped to the caller** — there is no field anywhere in the request accepting another user's id; a user can only boost themselves.
- **No new data exposure**: `whyYouTwo`/`aiExplanation` are built only from fields the *match's own two participants* already see about each other via the existing profile/deck/match responses — nothing new is revealed to a match's participants that Feature 2/3 didn't already expose to them.
- **Fail-open is a deliberate, scoped exception to this project's usual fail-closed default** (FR-121) — explicitly justified because nothing safety-relevant depends on an explanation existing; contrast this directly with FR-100/FR-110, which must never be relaxed the same way.

### 9. Acceptance criteria

- [ ] A real Super Like between two real seeded profiles with real bio/interests text produces a real, non-empty `Swipe.aiExplanation` — verified against the real vendor, not a mock.
- [ ] When that Super Like completes a match, `GET /v1/discovery/matches` returns `whyYouTwo` equal to the swipe's stored explanation and `matchSource: 'SUPER_LIKE'`, with no second vendor call made (verified by call-count, not just correct output).
- [ ] A match formed from two plain `LIKE`s has `whyYouTwo: null` immediately after matching, and a real, non-empty value after the first `GET /v1/discovery/matches` call — persisted, so a second call makes no further vendor call.
- [ ] A match between two profiles with **no** bio/interests set on either side (only `displayName` + `city`, the sparsest realistic complete profile — FR-34 requires at least a name/birthdate/photo to match at all) still returns either a real, generic-but-non-fabricated explanation, or `null` — checked explicitly for the specific failure mode this matters most for: the explanation must never mention an interest, a personality trait, or any specific detail that isn't derivable from `displayName`/`city`/age alone. This is the dedicated low-information test requested in review, not folded into the general "no bio" case above.
- [ ] FR-119's grounding-check call, run against a real explanation that's deliberately been tampered with to include a fabricated claim (e.g., an interest neither profile has), returns `grounded: false` — proving the verification call actually discriminates, not just that it always returns `true`.
- [ ] Simulating a vendor failure during explanation generation **or** during FR-119's grounding check still lets the Super Like/match-read complete successfully with `null`/unset explanation — never a 500, never a blocked swipe, and a `grounded: false` result is never surfaced to a user (checked as two separate cases, not one).
- [ ] `POST /v1/discovery/boost` twice in a row returns `409` on the second call while the first is still active; `GET /v1/discovery/boost` reflects `active: true` with a real remaining-time value in between.
- [ ] **Two separate, dedicated tests for FR-127's reciprocal check, not one combined test**: (a) a real boosted candidate whose `DiscoveryPreferences` the viewer *does* satisfy appears ahead of an otherwise-earlier, non-boosted candidate in `GET /v1/discovery/deck` — a real ordering test, not asserted from reading the query; (b) a real boosted candidate whose `DiscoveryPreferences` the viewer does *not* satisfy (e.g., outside the booster's stated age range) gets no promoting effect at all — appears in normal `(createdAt, id)` order (or not at all, if excluded for an unrelated reason) — proving the constraint discriminates in both directions, not just that it doesn't crash.
- [ ] Deck pagination remains correct (no duplicates, no skips) across a boosted/non-boosted tier boundary, chaining the cursor exactly as Feature 9's ranked-pagination tests already prove for the distance/un-ranked boundary.
- [ ] Exceeding the boost rate limit returns `429` with the matching audit-log entry (unit-tested, matching Feature 3/9's own precedent for not re-verifying via HTTP given the request volume needed to trip it safely).
- [ ] All error responses conform to RFC 7807.

### 10. Open items (explicit decisions — flagged, not guessed silently)

1. **Super Like's explanation is only ever visible to the recipient once a match forms — there is no pre-match "someone super-liked you, here's why" surface.** This is a direct, structural consequence of Open Items §4's "no who-liked-me inbox" scoping decision, not an oversight: today's codebase has no endpoint through which an un-matched recipient could see a swipe made against them at all, Super Like or otherwise. If the actual product intent is for the explanation to be part of what makes someone *want* to like back — i.e., shown *before* a match, as persuasion — that needs a real "likes you" surface built first, which is separate, larger scope than this document covers. Flagged for confirmation: is post-match-only delivery acceptable for this pass, or does this feature need to wait on (or absorb) that inbox?
2. **Smart Boost does not affect AI Prompt Search (Feature 9) ranking in this pass** — see §4. Confirm whether that's the right scope boundary, or whether boost-awareness in `POST /v1/discovery/ai-search` should be built now (a real, separate tier-merging design, not a small addition) or explicitly deferred to a later, dedicated pass.
3. ~~Whether grounding relies on prompt instruction alone~~ — ✅ **Decided: not prompt-only.** FR-119 adds a second, real, structured-output verification call that checks the generated explanation against the same fact set before it's ever persisted or shown; a failed check is discarded (fail-open, FR-121), never surfaced. This is still not a perfect guarantee — a second LLM call judging the first is a real, meaningful check, not an infallible one, and free-text generation retains irreducible hallucination risk no verification step fully eliminates. Flagged honestly as a real, accepted limitation of the *degree* of protection, not the *presence* of one. A dedicated low-information-profile test (name + city only, no bio) and a dedicated "does the grounding check actually discriminate" test (fed a deliberately fabricated claim) are both required acceptance criteria, not left implicit.
4. **`BOOST_DURATION_MINUTES` and `BOOST_RATE_LIMIT_PER_DAY` are placeholder values, not data-driven figures** — `product.md` specifies neither. Proposed defaults at implementation time (e.g., 30 minutes, once per day), confirmable/tunable via env var without a code change either way.
5. **Vendor/model choice**: proposed reuse of the same `gpt-4o-mini` chat model Feature 9's extraction already uses (no new vendor decision, consistent with every AI-feature decision so far in this project) — needs the same explicit confirmation every prior vendor choice has gotten.

---

## Feature 11: Conversational (text+voice) Profile Setup

**Status:** ✅ Shipped, reviewed, approved — a new, additional entry path into Feature 2's existing profile fields, agreed directly with the product owner rather than traced to a `product.md` section (unlike every feature before it, this one has no existing `product.md` anchor — flagged explicitly rather than fabricating a citation). This document reconstructs the agreed shape from the constraints reconfirmed at kickoff: a new entry path into Feature 2 (not a replacement for it), multi-step, reusing Feature 9's voice infrastructure, mandatory human confirmation on every extracted field before it's saved, and no permanent retention of the conversation itself. Every concrete design choice beyond those five constraints is written up explicitly in §10 Open Items for confirmation, the same as every other feature in this document — nothing here should be read as already locked in beyond what was actually agreed. **This line was stale**, corrected 2026-09-17 after direct verification: confirmed the real `conversational-setup` module (`backend/src/modules/profile/conversational-setup/`) and a real, current `backend/test/conversational-setup.e2e-spec.ts` (14 tests).
**Source sections:** None in `product.md` — see Status above.
**Depends on:** Feature 2 (`ProfileService`'s existing field validation, age check, and content-moderation calls — reused as the actual write path, not reimplemented), Feature 9 (the real Whisper transcription pattern — in-memory `FileInterceptor`, forced-Persian, zero audio retention — and the real structured-output extraction pattern), Feature 10 (the established "fail-open, real vendor call, never block the underlying non-AI action" precedent), `docs/architecture.md` §5.3 (the existing Redis instance, proposed as the ephemeral session store — see Open Items #2).

### 1. What already exists vs. what this feature adds

**Already exists, unchanged:**
- `PATCH /v1/profile`, `POST`/`DELETE /v1/profile/photos` — the entire existing profile-creation surface (Feature 2), including FR-19..FR-34's field validation, age check, and moderation hooks. This feature does not touch, wrap, or deprecate any of it.
- A real, working OpenAI integration (`fetch`-based, no SDK) and the exact Whisper transcription pattern (in-memory buffer, `language: "fa"` forced, audio discarded immediately — Feature 9 FR-105/FR-106) and structured-output extraction pattern (Feature 9 FR-104, Feature 10 FR-119) this feature reuses rather than reimplements.
- Redis, already running in production for the chat WebSocket pub/sub adapter (`docs/architecture.md` §5.3) — proposed (Open Items #2) as the ephemeral store for this feature's session state, rather than a new table or new vendor.

**Missing — what this feature adds:**
- **No conversational/guided entry point exists anywhere in the system.** Today, completing a profile means directly calling `PATCH /v1/profile` with known field names — there is no flow that asks the user natural-language questions and fills in fields from free-text or spoken answers.
- **No mechanism exists for confirming an AI-proposed value before it's saved.** Feature 9's chip-confirmation UX is the closest precedent (confirm-before-search), but nothing today confirms a proposed value before a *write* to a permanent record — this feature's confirm step is a materially higher-stakes gate than Feature 9's, since what's being confirmed becomes someone's stored identity data, not a transient search parameter.
- **No ephemeral, auto-expiring session concept exists in this codebase at all.** Every existing piece of state is either a permanent DB row or an in-memory value scoped to a single request; this feature needs multi-turn state that survives across several requests but is guaranteed to never become permanent.

### 2. Goal

An authenticated user who hasn't finished their profile can complete it by typing or speaking short, natural answers to a guided sequence of questions, one profile field at a time — with every value the system thinks it understood shown back to them in its exact final saved form for explicit confirmation or correction before anything is written, and with the back-and-forth conversation itself never outliving the session it happened in.

### 3. In scope

- `POST /v1/profile/conversational-setup/start` — begins a new ephemeral session for the caller. FR-132..FR-135.
- A text-turn endpoint and a voice-turn endpoint, sharing one extraction implementation — reusing Feature 9's real transcription pattern for voice. FR-136..FR-139.
- A per-field confirm endpoint that is the *only* path by which anything this feature produces reaches the real `User` row, routed through Feature 2's existing validation/moderation/age-check logic unmodified. FR-140..FR-142.
- Structural, not just procedural, non-retention of the turn-by-turn conversation. FR-143..FR-145.
- Explicit non-replacement of, and fallback to, Feature 2's existing endpoints. FR-146, FR-147.
- Rate limiting on session starts and on turns. FR-148.
- Exactly one analytics event (`profile_completed`, `product.md` §11) instrumented for real, carrying which entry path caused profile completion — the minimum needed to tell whether this feature's real OpenAI cost is justified, not a general analytics rollout. FR-150..FR-153.

### 4. Explicitly out of scope for this feature

- **Photo capture or upload via text/voice.** A photo cannot be meaningfully described into existence from a sentence; the existing `POST /v1/profile/photos` endpoint is untouched and is where photos still come from. The conversation may *mention* that a photo is still needed (Open Items #5), but adds no new photo-handling logic.
- **Replacing, wrapping, or deprecating `PATCH /v1/profile` or the photo endpoints.** They remain fully independent and fully usable at every point before, during, and after a conversational-setup session, whether or not that session ever existed.
- **A general-purpose conversational assistant.** This is a fixed, bounded sequence aimed at exactly the five Feature 2 fields (`displayName`, `birthDate`, `city`, `bio`, `interests`) — not a multi-topic chat, and not something that persists or "remembers" the user across separate profile-setup attempts once a session ends.
- **Voice input anywhere outside this flow** (chat voice notes, etc.) — out of scope here for the same reason Feature 9 scoped its own Whisper integration to search only.
- **Long-term conversation memory or personalization.** Nothing about how this feature phrases its questions is influenced by anything outside the fields still unfilled in the *current* session; there is no cross-session learning.

### 5. User flow

1. An authenticated user with an incomplete profile calls `POST /v1/profile/conversational-setup/start`. Server creates a new ephemeral session (Redis, TTL — FR-132) and returns a `sessionId`, the list of Feature 2 fields still unfilled, and an opening question.
2. User answers by typing (`POST .../:sessionId/message`) or speaking (`POST .../:sessionId/voice`, transcribed exactly like Feature 9's voice search — FR-137). Either way, the server runs the answer through one shared extraction call (FR-138) that identifies, at most, one target field and a candidate value, and generates the next question (FR-139).
3. The response shows the user the transcript (voice only, so a mishearing is catchable — same reasoning as Feature 9 §5 Voice step 3) and the proposed field + value **in its final, resolved form** (e.g. an actual calendar date, not "you said you were born in year X") — nothing has been saved yet.
4. User explicitly confirms or edits the proposed value and calls `POST .../:sessionId/confirm` with the field name and the (possibly edited) value. Server writes it through the exact same path `PATCH /v1/profile` already uses — same validation, same age check, same content-moderation call for `bio`. A rejection (e.g. under-18, failed moderation) is reported back the same way Feature 2 already reports it; the session stays open so the user can try a different answer for that field.
5. Steps 2–4 repeat until every fillable-via-conversation field is either confirmed or the user chooses to skip it. When all are resolved (or the user ends early — FR-135), the server's final message points the user at the existing photo-upload endpoint to finish (Open Items #5) — this feature's own responsibility ends there.
6. At every point — natural completion, explicit early end, or silent TTL expiry — the turn-by-turn conversation itself is gone once the session is gone (FR-143). Only whatever was actually confirmed in step 4 persists, as ordinary `User` fields indistinguishable from data entered by typing.

### 6. Functional requirements

#### 6.1 Session lifecycle
- FR-132: `POST /v1/profile/conversational-setup/start` creates a new session keyed by a server-generated `sessionId`, stored only in the ephemeral store (Open Items #2), never in Postgres.
- FR-133: A session belongs to exactly one user (the caller at creation time); every subsequent call scoped to a `sessionId` must belong to the caller, checked on every request (403/404 otherwise, not a silent cross-user read).
- FR-134: A session has a configurable TTL (default: 30 minutes of inactivity, extended on each turn) after which it expires automatically and is unrecoverable — a call against an expired or unknown `sessionId` returns 404, requiring a fresh `start`.
- FR-135: An explicit end/abandon call discards the session immediately, without waiting for the TTL — the client can trigger this the moment the user exits the flow.

#### 6.2 Turn handling (text + voice, one implementation)
- FR-136: `POST .../:sessionId/message` accepts free text and runs it through the extraction call in FR-138.
- FR-137: `POST .../:sessionId/voice` accepts a single audio file (`multipart/form-data`, in-memory `FileInterceptor` — Feature 2/9's exact pattern, no temp file), transcribes it via the real Whisper call forced to Persian (Feature 9 FR-105, reused verbatim, not reimplemented), and feeds the resulting text into the identical FR-138 extraction call the text path uses — one implementation, two entry points, exactly mirroring Feature 9 FR-108. The audio itself follows FR-106's exact non-retention rule (restated as FR-145 below).
- FR-138: The extraction call is a real structured-output LLM call whose response schema can name **at most one** target field, drawn only from the fixed enum `{displayName, birthDate, city, bio, interests}`, plus a candidate value already shaped the way Feature 2 expects it (e.g. an ISO date for `birthDate`, an array for `interests`) — the schema has no field capable of naming anything outside that enum or of carrying free-form profile data beyond one candidate value, the same structural-narrowness discipline as Feature 9 FR-104 and Feature 10 FR-119.
- FR-139: The same call also returns the next question to ask, generated only from which of the five fields remain unfilled in this session — never referencing anything outside the current session's own state — and a `completed: boolean` flag once all fillable-via-conversation fields have been confirmed.

#### 6.3 Mandatory per-field human confirmation before persistence
- FR-140: A field proposed by FR-138's extraction is never written to the `User` row directly from a turn response. A turn response only ever proposes; it never persists.
- FR-141: `POST .../:sessionId/confirm` is the only endpoint in this feature that writes to `User`. It requires the client to explicitly submit a field name and a value (the proposed one, or an edited one) and runs that value through **exactly** the validation, age-check, and content-moderation logic `PATCH /v1/profile` already enforces (FR-19/20/21/22/23, FR-33) — no separate, looser code path, and no exemption because the value originated from a conversation.
- FR-142: The value shown to the user for confirmation is its fully resolved, final form — e.g. a parsed calendar date rendered as an actual date, not a restatement of what the user said — so a mis-transcription or a mis-parsed value is human-catchable before FR-141 ever runs, not just theoretically correctable after the fact. **For `birthDate` specifically** (the highest-risk field — Open Items #1): the proposed value names **both** the calendar interpretation and the resulting Gregorian date explicitly, e.g. `"شمسی ۱۳۷۰/۵/۱۲ → میلادی ۱۹۹۱/۰۷/۳۰"`, never the bare Gregorian date alone — a wrong calendar assumption is only catchable if the assumption itself, not just its numeric output, is shown.

#### 6.4 No permanent retention of the conversation
- FR-143: The full turn-by-turn conversation — every user utterance, every transcript, every generated question — exists only inside the ephemeral session store for that session's lifetime and is never written to Postgres or any other permanent store, at any point, on any path (including error/retry paths — the same "hard invariant, must hold even in error/retry paths" standard Feature 1 FR-14 already set for biometric capture data).
- FR-144: Only a value that has actually passed FR-141's confirm step becomes permanent, and only as an ordinary `User` row field — there is no `ConversationTurn`/transcript table anywhere in the schema, by construction, not by a retention policy that could be misconfigured.
- FR-145: A voice turn's audio bytes follow Feature 9 FR-106's exact rule: held in memory only for the duration of the transcription call, never written to disk, the database, or any `STORAGE_PROVIDER` bucket, discarded the instant transcription completes or fails.

#### 6.5 Non-replacement of, and fallback to, the existing flow
- FR-146: `PATCH /v1/profile` and the photo endpoints remain fully independent and fully functional regardless of whether a conversational-setup session exists, is mid-flight, was abandoned, or expired — a user is never blocked from completing their profile the original way.
- FR-147: A failure at any real vendor call in this feature (extraction or transcription) returns a distinct `503` naming `PATCH /v1/profile` as the fallback (mirrors Feature 9 FR-116) — the session itself is left open/resumable rather than corrupted, but the user is never stuck waiting on this feature specifically to finish their profile.

#### 6.6 Abuse resistance
- FR-148: Session starts and individual turns are each independently rate-limited (mirrors Feature 9 FR-115's text/voice split — every turn here is a billed vendor call), enforced the same rolling-window pattern as FR-50/FR-115, with its own `CONVERSATIONAL_SETUP_*_RATE_LIMIT` config and audit-log action on the exceeded case.

#### 6.7 API conventions (carried over)
- FR-149: All endpoints require a valid access token, are versioned under `/v1`, validate request bodies against explicit DTOs, and return errors in RFC 7807 format.

#### 6.8 `profile_completed` analytics instrumentation (scoped narrowly — not a general analytics rollout)
- FR-150: A new `AnalyticsEventProviderInterface` (`track(event: string, userId: string, properties: Record<string, unknown>): Promise<void>`) is introduced, following this codebase's established interface-abstraction pattern (Feature 1's `OtpProviderInterface`/`LivenessProviderInterface`, Feature 2's `StorageProviderInterface`) — application code never depends on a specific analytics vendor's shape. `product.md` §11's full event taxonomy and its proposed EU-hosted vendor (PostHog EU Cloud or equivalent) remain **entirely out of scope** here — this interface exists to carry exactly one event (FR-152), not to instrument the other 17 events §11 lists.
- FR-151: The only implementation for now is a `MockAnalyticsEventProvider` that persists each call to a new `AnalyticsEvent` table (§7) rather than only logging it — a deliberate departure from the OTP/liveness mocks' log-only precedent, because the reason this event is being instrumented at all is to let a real, later decision ("was this feature's OpenAI cost justified?") be answered by querying real accumulated data, not by grepping logs. A real vendor swap (per `product.md` §11) stays a distinct, future, explicitly-flagged decision (`docs/roadmap.md`), exactly like every other mocked provider in this project.
- FR-152: `profile_completed` fires exactly once per user, at the exact moment `ProfileService`'s existing completion check (Feature 2 FR-34) transitions `profileCompletedAt` from unset to set — never re-fired on a later edit, matching FR-34's own "set once, first time only" semantics. Its only property is `source: 'FORM' | 'CONVERSATIONAL'`, reflecting which endpoint made the specific write that crossed the completion threshold — `PATCH /v1/profile` directly, or this feature's FR-141 confirm endpoint. This requires threading an optional `source` parameter (defaulting to `'FORM'`) through `ProfileService`'s existing shared write path, not adding a second, parallel write path for the conversational case.
- FR-153: The event's `properties` payload carries only structural/behavioral metadata (`source`, timestamp, `userId`) — **never** the actual field values that were confirmed (no bio text, no birth date, no city, no interests) — the same minimal-data-collection discipline this project already applies everywhere else (Feature 1's zero-retention liveness capture, Feature 9's zero audio retention, this feature's own FR-143).

### 7. Data model additions

```
No new columns on User — "which entry path completed this profile" is
deliberately NOT stored on the User row (FR-152); it lives only in the
AnalyticsEvent row the completing write emits.

AnalyticsEvent (FR-150/151)
 ├─ id, userId, event (String — "profile_completed" for now, not an enum,
 │    since FR-150's interface is generic even though only one event is
 │    wired up in this feature), properties (Json), createdAt
 ├─ index (userId, event)   -- "how did this user's profile get completed"
 ├─ index (event, createdAt) -- the actual query this feature exists to
 │    answer: source breakdown of profile_completed over time

ConversationalSetupSession — Redis only, NOT a Prisma model (FR-132, FR-143/144):
 ├─ sessionId, userId, createdAt, expiresAt (TTL, refreshed per turn)
 ├─ confirmedSoFar: a working cache of this session's own already-confirmed
 │    field names, for UX only (so the flow doesn't re-ask a filled field) —
 │    the real `User` row, updated by FR-141, is still the only source of
 │    record; this cache is disposable and reconstructable from it.
 ├─ recentTurns: a bounded window (last N turns only, not the full history)
 │    kept solely to give the extraction call short-term context — never
 │    grows unbounded, never survives past the session TTL.
```

`AnalyticsEvent` gains an `onDelete: Cascade` relation to `User`, the same real-purge posture every other per-user table in this codebase already has — a deleted user's event history is purged with them, not retained as an orphaned analytics record.

### 8. Security requirements (from §5, scoped to this feature)

- **No exemption from Feature 2's existing checks for a conversationally-sourced value** (FR-141) — the same "no field is exempt because it seems low-risk" posture Feature 2 §7 already states, now explicitly re-affirmed for a new input mechanism feeding the same fields.
- **The extraction schema is structurally narrow, not prompt-narrow** (FR-138) — it cannot name a field outside the fixed five, and cannot carry more than one candidate value per turn, by the shape of the schema itself, the same "structural guarantee over trust" doctrine as Feature 9 FR-104 and Feature 10 FR-119.
- **No permanent conversation retention is a hard invariant, not a cleanup job** (FR-143) — there is no table to forget to clean up, because there is no table.
- **Session-scoped resource-level authorization** (FR-133) — a session id is only ever usable by the user it was created for.
- **Rate limiting is dual-purpose**: abuse resistance and cost control, since every turn and every session start is a billed real vendor call — same posture as Feature 9 §8.
- **The `profile_completed` event carries no profile content, ever** (FR-153) — `source` is the only property, by construction of the call site, not by a redaction step that could be forgotten. `AnalyticsEvent.properties` being a free-form `Json` column is a deliberate, narrow exception to "don't add a column nothing constrains," justified only because FR-150's interface is generic by design while this feature wires up exactly one call site with exactly one property — a second event added later without a similar audit would be a real thing to watch for, not a precedent to build on freely.

### 9. Acceptance criteria

- [ ] A real multi-turn text conversation, run against the real extraction endpoint, correctly identifies each of the five fields across separate turns — not one cherry-picked prompt.
- [ ] A real voice turn (a real audio file, a real Whisper call) produces both a transcript and a correctly-extracted field, matching Feature 9's real-audio standard rather than a stubbed transcription.
- [ ] Confirming a value the user has **edited away from** the AI's proposed value persists the edited value, not the original proposal — proving confirmation is a real gate, not a decorative echo.
- [ ] An extracted `bio` value that fails real content moderation is rejected at confirm time (422), exactly as a directly-typed bio would be under Feature 2 FR-33 — the same real moderation call, not skipped for this path.
- [ ] An extracted `birthDate` implying under-18 is rejected at confirm time (400), exactly as Feature 2 FR-20 already requires — not silently accepted because it arrived via conversation.
- [ ] After a session ends — completed, explicitly abandoned, and separately, left to expire via TTL — a direct database query confirms no table anywhere contains the turn-by-turn conversation text, checked directly and explicitly for all three end states, not assumed from one of them.
- [ ] Directly verified (not assumed): a voice turn's audio bytes are not present anywhere the app can reach them once transcription completes — no temp file, no `STORAGE_PROVIDER` object, no DB row.
- [ ] A user who never starts (or who fully abandons) a conversational-setup session can still complete their profile via `PATCH /v1/profile` and the existing photo endpoints with zero friction — proving this feature is additive, not a dependency.
- [ ] A simulated vendor failure mid-conversation returns 503 naming `PATCH /v1/profile` as the fallback, and the session remains open/resumable afterward rather than being silently corrupted.
- [ ] Session-scoped authorization: a second real user cannot read, post a turn into, or confirm a field into a session created by the first user (403/404, not a silent cross-user effect).
- [ ] Exceeding the session-start rate limit, and separately the per-turn rate limit, each return 429 with the matching audit-log entry.
- [ ] Completing a profile via `PATCH /v1/profile` directly emits a real, persisted `profile_completed` `AnalyticsEvent` row with `source: 'FORM'`; completing one via this feature's confirm endpoint emits one with `source: 'CONVERSATIONAL'` — both checked against a real DB row, not asserted from reading the call site.
- [ ] `profile_completed` fires exactly once per user even if the completing field is later edited again (re-running `PATCH`/confirm after completion never emits a second row) — proving FR-152's "set once" semantics actually holds, not just FR-34's.
- [ ] A real `AnalyticsEvent.properties` payload for `profile_completed` is inspected directly and contains only `source` — never a bio, birth date, city, or interests value, proving FR-153's no-profile-content rule holds in practice, not just in the schema's shape.
- [ ] All error responses conform to RFC 7807.

### 10. Open items (explicit decisions — flagged, not guessed silently)

1. ~~Persian-calendar / natural-date-parsing risk for `birthDate`~~ — ✅ **Decided, and identified as the highest-risk item in this feature.** A spoken or typed answer like "متولد ۱۳۷۲ام" mixes calendar systems with the stored Gregorian `birthDate`, with a direct legal consequence if misresolved (Feature 2 FR-20's under-18 gate). FR-142 now requires the confirmation UI to name **both** the calendar interpretation and the resulting Gregorian date explicitly (e.g. `"شمسی ۱۳۷۰/۵/۱۲ → میلادی ۱۹۹۱/۰۷/۳۰"`), not the bare Gregorian number alone — a wrong calendar assumption is only catchable if the assumption itself is visible, not just its numeric output. The actual date-resolution mechanism (LLM-driven vs. a dedicated calendar/date-parsing library the LLM's raw text feeds into) is still an implementation-time choice, but whichever is picked must produce both halves of that display string.
2. ~~Ephemeral session store~~ — ✅ **Decided: reuse the existing Redis instance** (`docs/architecture.md` §5.3, currently used only for chat WebSocket pub/sub) under a new key prefix and its own TTL, rather than a new table (which would need its own cleanup logic and would risk becoming a de facto permanent store, undermining FR-143) or a new vendor.
3. ~~One active session per user, or several concurrent ones?~~ — ✅ **Decided: one.** Starting a new session implicitly ends any existing one for the same user.
4. ~~Whether to record which entry path (form vs. conversational) completed a profile~~ — ✅ **Decided, reversing the original draft's "not tracked" proposal.** Not for privacy reasons (the original concern) but a product one: without knowing which path actually causes profile completion, there's no way to judge whether this feature's real, ongoing OpenAI cost is worth it. Resolved by **not** adding a column to `User` (the privacy instinct behind the original "no" was right) but instead wiring up exactly one real analytics event, `profile_completed` (already named in `product.md` §11), carrying a `source: 'FORM' | 'CONVERSATIONAL'` property — see the new §6.8 (FR-150..FR-153) and the new `AnalyticsEvent` table in §7. This is scoped narrowly: it instruments the one event this feature's own existence puts in question, not a general rollout of §11's full taxonomy, which remains exactly as deferred as it was before this feature.
5. ~~Whether the conversation may verbally point the user at the existing photo upload once profile-fillable fields are done~~ — ✅ **Decided: yes**, strictly as a final natural-language message pointing at `POST /v1/profile/photos` — no new photo-related endpoint, logic, or schema field in this feature.
6. ~~A maximum turn count per session~~ — ✅ **Decided: 20 turns (config-tunable)**, to bound the cost/length of an open-ended back-and-forth before the flow itself suggests falling back to the manual form.
7. ~~Vendor/model choice~~ — ✅ **Decided: reuse the same `gpt-4o-mini` chat model and `whisper-1` transcription** Features 9 and 10 already use — no new vendor onboarding.

---

## Feature 12: Share My Date

**Status:** ✅ Shipped, reviewed, approved — `product.md` §4 names this "elevated to a primary feature, not a buried settings option"; §15 lists it among the explicit MVP fast-follows; §7.3 is its only functional spec: "private link with date/time/location/verified-partner-photo, shareable with a trusted contact." **This line was stale**, corrected 2026-09-17 after direct verification: confirmed the real `date-share` module (`backend/src/modules/date-share/`, including the public, unauthenticated controller) and a real, current `backend/test/date-share.e2e-spec.ts` (12 tests).
**Source sections:** `product.md` §2 (target audience: "needs safety reassurance for real-world meetups — drives Share My Date and safe-calling features"), §4, §7.3, §9 (data-model sketch: `DateShareLink { id, user_id, match_id, datetime, location_text, expires_at, token }`), §11 (`date_shared` analytics event), §15. `backend/prisma/schema.prisma`'s own header comment has named this entity as pending since Feature 1 ("Other entities (CallSession, DateShareLink) are added when their owning feature ships").
**Depends on:** Feature 3 (`Match` — this feature sits entirely on top of an existing match, never standalone), Feature 7 (`StorageProviderInterface.getUrl()` — the partner's photo is served through the exact same real, presigned, time-limited S3 URL mechanism already built, not a new one), Feature 5 (block-state awareness — see Open Items #3), Feature 6 (`PATCH /v1/users/me/privacy` — this feature's new opt-out toggle, FR-171..FR-173, extends that existing endpoint rather than adding a new one), `CryptoService` (Feature 1's `generateOpaqueToken()`/HMAC-hash pattern, extended with one new method), Feature 11's `AnalyticsEventProviderInterface` (reused unchanged to instrument `date_shared` — see §6.6).

### 1. What already exists vs. what this feature adds

**Already exists, unchanged:**
- `Match` (userAId/userBId, `@@unique([userAId, userBId])`) — this feature's link always resolves "the other participant" from it, never invents a separate relationship concept.
- `StorageProviderInterface.getUrl(key)` — real, presigned, time-limited (`PHOTO_URL_EXPIRY_SECONDS`), freshly signed on every call, never persisted (Feature 7, FR-89). This feature reuses it as-is for the partner's photo; it does not build a second photo-URL mechanism.
- `CryptoService.generateOpaqueToken()` (`crypto.randomBytes(32)` → base64url) and its HMAC-hash-at-rest pattern (`hashRefreshToken()`'s exact shape, Feature 1) — a proven precedent for "a high-entropy bearer secret, stored only as a hash, exact-match looked up."
- The "dedicated `*-rate-limit.service.ts` against a persisted DB counter, `TooManyRequestsException`, an audit-log entry on the exceeded case" pattern (FR-50, FR-115, FR-130, FR-148) — reused here for both axes this feature needs (per-user creation, per-IP lookup).
- `ProblemDetailsFilter` — applies automatically to any new exception this feature throws; no new wiring needed.
- Feature 6's `PATCH /v1/users/me/privacy` (`UpdatePrivacyDto`, `SettingsService.updatePrivacy()`) — already the home for privacy-category toggles (`preciseLocationEnabled`, `messagingPermission`); this feature extends it with one more field rather than building a second settings surface.

**Missing — what this feature adds:**
- **No mechanism exists anywhere in this codebase for exposing any data to a party who isn't an authenticated account holder.** Every controller in this project so far either requires `JwtAuthGuard` or is public only for pre-authentication bootstrapping (`AuthController`'s OTP/refresh endpoints, which touch only the caller's own not-yet-authenticated session). This is the first genuinely public, unauthenticated *read* endpoint exposing another user's data (a match partner's photo, name, and meeting details) to a third party with no account at all.
- **No `DateShareLink` model, no share-token generation/hashing, no per-IP lookup rate limiting exists.**
- **No prior feature has needed a token whose validity window depends on a *future* event time** (the date's own `datetime`), rather than a fixed duration from creation — every existing TTL in this codebase (OTP, refresh tokens, photo URLs, boost, conversational-setup sessions) counts forward from *now*.

### 2. Goal

A user in a real match can generate a private, time-limited link — containing when and where a planned date is, plus their match partner's verified photo and name — and send that link through any channel they choose to someone they trust, so that person has enough real information to help if something goes wrong, without that person ever needing an account, and without the link exposing anything about the sharer's account beyond what's needed for this one purpose.

### 3. In scope

- `POST /v1/discovery/matches/:matchId/date-share` — create a link for a specific match's planned date. FR-154..FR-159.
- `GET /v1/discovery/matches/:matchId/date-share` — list the caller's own links for that match (active and expired/revoked), so they can see what they've already shared. FR-160.
- `DELETE /v1/discovery/matches/:matchId/date-share/:linkId` — revoke a link early. FR-161.
- `GET /v1/date-share/:token` — the public, unauthenticated view a trusted contact opens. FR-162..FR-167.
- Per-IP rate limiting on the public lookup endpoint specifically (brute-force resistance for an unauthenticated endpoint — a new abuse-resistance shape this codebase hasn't needed before). FR-168, FR-169.
- `date_shared` analytics instrumentation, reusing Feature 11's `AnalyticsEventProviderInterface` unchanged. FR-170.
- A new privacy toggle, `allowInSafetyShares` (default on), letting a user opt out of appearing in *other* users' Share My Date links — surfaced through Feature 6's existing `PATCH /v1/users/me/privacy`, checked at link-creation time. FR-171..FR-173.

### 4. Explicitly out of scope for this feature

- **`date_feedback_submitted`** (`product.md` §11) — a distinct, separate analytics event about how the date actually went, implying its own (unbuilt) post-date feedback UI/endpoint. Nothing here collects or infers that.
- **Live location sharing / real-time tracking during the date.** `product.md` §7.3's "Share My Date" is a static plan (time, place, who) shared once, not an ongoing location feed — that would be a materially different (and materially more sensitive) feature, not silently folded in here.
- **Geocoding, maps, or structured place data.** `locationText` is free text, exactly like `city` (Feature 2) and Feature 3/9's already-deferred precise-location work — no new location-precision capability is added by this feature.
- **Safe-calling** (`product.md` §2's "drives Share My Date **and safe-calling** features") — a separate, unbuilt feature (`CallSession`, per the schema header comment) with its own requirements pass, not bundled here just because it's named alongside this one in product.md.
- **Automatic link revocation on unmatch or block** — no "unmatch" flow exists yet in this codebase, and whether an existing link should auto-revoke on a block is a real product decision, not obviously implied. See Open Items #3.
- **Notifying the trusted contact of anything** (link creation, upcoming expiry, etc.) — Feature 6 already established that no notification-delivery mechanism exists in this codebase (FR-82); the sharer sends the link themselves, through whatever external channel they choose.

### 5. User flow

1. Two matched users (Feature 3) plan a date outside the app. The sharer calls `POST /v1/discovery/matches/:matchId/date-share` with `{ datetime, locationText }`.
2. Server verifies the caller is a real participant of that match (FR-155), that the *other* participant is verified (FR-156 — the feature's entire safety premise is a *verified* partner's photo), and that the other participant hasn't opted out of appearing in Share My Date links (FR-173). It generates a high-entropy token (FR-158), stores only its hash (FR-159), and returns the token (embedded by the client into a shareable URL) plus its `expiresAt`.
3. The sharer sends that link to a trusted contact through any channel outside the app (SMS, WhatsApp, email — this feature doesn't care which).
4. The trusted contact opens the link. No login, no app install. `GET /v1/date-share/:token` returns the date's time and location, the sharer's display name, and the partner's display name plus a real, freshly-generated, time-limited photo URL (FR-163..FR-165) — and nothing else about either person's account.
5. The link stops working (a generic, uninformative 404 — FR-167) once its `expiresAt` passes (FR-157, anchored to the date's own `datetime`, not link-creation time) or the sharer revokes it early (`DELETE`, FR-161).

### 6. Functional requirements

#### 6.1 Creating a link
- FR-154: `POST /v1/discovery/matches/:matchId/date-share` requires a valid access token and an explicit `{ datetime: ISO 8601 string, locationText: string (1-200 chars) }` body.
- FR-155: The caller must be `userAId` or `userBId` on the referenced `Match`. Reuses Feature 4's existing `ConversationAccessService.assertParticipant()`/`otherParticipant()` exactly (404 if the match doesn't exist, 403 if it exists but the caller isn't a participant) rather than a second, parallel authorization check — this is a deliberate departure from Feature 11's uniform-404 posture for its own ephemeral sessions (FR-133): a `Match` is a durable, already-shared resource both participants already know exists, unlike a private per-user session, so there's no equivalent privacy reason to hide "this match exists but isn't yours" behind a generic 404.
- FR-156: The *other* participant (not the caller) must have `livenessStatus: true` at creation time, or the request is rejected (409) — this feature's entire safety premise is showing a **verified** partner's photo (`product.md` §7.3's own wording); a link cannot be created promising something that isn't true.
- FR-157: `expiresAt` is computed from the submitted `datetime`, not from creation time: `expiresAt = datetime + DATE_SHARE_LINK_BUFFER_HOURS`. A `datetime` in the past is rejected (400) — sharing a plan for a date that's already happened has no safety value. This is the first TTL in this codebase anchored to a *future business event* rather than counted forward from "now" (every prior TTL — OTP, refresh tokens, photo URLs, boost, conversational-setup sessions — counts from creation); a fixed "N hours from creation" TTL would be actively wrong here, since a date planned three days out could expire before it even happens.
- FR-158: The raw share token is generated via `CryptoService.generateOpaqueToken()` (Feature 1's existing 32-byte/base64url primitive) — reused, not reinvented.
- FR-159: Only the token's hash is ever persisted (`DateShareLink.tokenHash`), via a new `CryptoService.hashShareToken()` method mirroring `hashRefreshToken()`'s exact HMAC-with-a-dedicated-secret shape — the raw token exists only in the creation response and whatever the sharer forwards it through; the database can never leak a usable token, even in a full data breach.

#### 6.2 Managing links
- FR-160: `GET /v1/discovery/matches/:matchId/date-share` lists the caller's own `DateShareLink` rows for that match (active, expired, and revoked, distinguishable by `expiresAt`/`revokedAt`) — never another user's links, never the raw token (already discarded server-side per FR-159; only `id`, `datetime`, `locationText`, `expiresAt`, `revokedAt`, `createdAt` are returned).
- FR-161: `DELETE /v1/discovery/matches/:matchId/date-share/:linkId` sets `revokedAt` (never a hard delete — the row's existence is what lets FR-160 show history). Resource-level authorization: only the link's own creator may revoke it (403/404 otherwise).

#### 6.3 The public view
- FR-162: `GET /v1/date-share/:token` requires no access token — the one deliberately unauthenticated read endpoint in this codebase, scoped as narrowly as possible (see §8).
- FR-163: The token is looked up by re-hashing the presented value with the same `hashShareToken()` and comparing against `tokenHash` — never a linear scan or a raw-token column.
- FR-164: A token that doesn't match any row, or matches a row that's expired (`expiresAt` in the past) or revoked (`revokedAt` set), all produce the **exact same generic 404** ("this link is no longer valid") — deliberately never distinguishing "never existed" from "expired" from "revoked" in the response, so nothing about token space, link lifecycle, or a specific match/user is inferable from the failure shape.
- FR-165: A valid lookup returns exactly: the sharer's `displayName`, the partner's `displayName` and a freshly-generated presigned photo URL (via the existing `StorageProviderInterface.getUrl()`, FR-89's exact mechanism — never a stored/permanent URL), the shared `datetime`, and `locationText`. Nothing else — no phone-derived data, no bio, no interests, no other photos, no chat history, no other matches, no indication the sharer or partner have any other activity in the app at all.
- FR-166: If the partner's `livenessStatus` has changed to `false` since the link was created (a rare edge case — verification is not currently revocable elsewhere in this codebase, but this feature must not assume that can never change), the lookup fails the same generic way as FR-164 rather than showing a now-inaccurate "verified" claim.
- FR-167: No lookup, successful or not, is ever logged in a way that reveals the token itself (not in `AuditLog.metadata`, not in application logs) — only that *a* lookup happened, for FR-169's rate-limit counting.

#### 6.4 Abuse resistance
- FR-168: Link creation is rate-limited per user (mirrors FR-50/FR-115/FR-130/FR-148's exact pattern — a rolling-window count against `DateShareLink.createdAt`, `TooManyRequestsException`, a `DATE_SHARE_LINK_RATE_LIMIT_EXCEEDED` audit entry).
- FR-169: The public lookup endpoint (FR-162) is rate-limited **per IP**, not per user (there is no authenticated user) — a new `DateShareLinkLookupAttempt` table (`id`, `ip`, `createdAt`) mirrors `OtpRequest`'s existing per-IP axis (FR-4) for the identical reason: an unauthenticated, token-guessable endpoint needs brute-force resistance independent of any account.

#### 6.5 API conventions (carried over)
- (Covered by FR-154/FR-162 above for auth posture.) All responses — including the public one — are versioned under `/v1` and return errors in RFC 7807 format; `ProblemDetailsFilter` applies with no new wiring.

#### 6.6 `date_shared` analytics instrumentation (reuses Feature 11's infrastructure unchanged)
- FR-170: A successful link creation (FR-154) fires `date_shared` via the existing `AnalyticsEventProviderInterface` (Feature 11, `common/analytics/`) with properties `{ }` or, at most, non-identifying structural metadata (e.g. hours-until-date, never `locationText`/`datetime` verbatim, never any name) — no new provider, no new abstraction, the second real call site for infrastructure Feature 11 built specifically to be reused this way.

#### 6.7 Opting out of appearing in others' Share My Date links
- FR-171: `User` gains a new privacy field, `allowInSafetyShares` (boolean, **default `true`**) — off by default would silently defeat the feature's own safety purpose for most users, since Share My Date only has value if the partner can actually be shown; on by default, with a real, visible way to turn it off, is the correct default-safe-but-not-default-silent posture (the same reasoning already governing every other privacy default in this codebase — Feature 6 FR-78's `messagingPermission: VERIFIED_ONLY`/`preciseLocationEnabled: false` defaults, just inverted here because the safety value runs the opposite direction).
- FR-172: Surfaced through Feature 6's existing `PATCH /v1/users/me/privacy` (write) and `GET /v1/users/me/settings` (read) — `UpdatePrivacyDto`/`UserSettings` gain one more field, not a new endpoint. Feature 6's original requirements/acceptance criteria are unchanged by this; this FR is the amendment record for the new field.
- FR-173: Checked at link-creation time (FR-154), alongside FR-156's verification check: if the *other* participant has `allowInSafetyShares: false`, creation is rejected with the same `409` FR-156 already uses (a consistent "this specific date-share link cannot be created right now" failure shape, not two different error meanings for two different consent-adjacent reasons) — never a link with the photo/name silently omitted. A link that shows nothing safety-relevant about the partner has no value and would be a confusing, half-working artifact rather than a real alternative.

### 7. Data model additions

```
User (new field, FR-171)
 ├─ allowInSafetyShares  Boolean  @default(true)

DateShareLink
 ├─ id, userId (the sharer), matchId
 ├─ user      User   @relation(fields: [userId], ..., onDelete: Cascade)
 ├─ match     Match  @relation(fields: [matchId], ..., onDelete: Cascade)
 ├─ datetime      DateTime   -- the planned date's own time (FR-157's anchor)
 ├─ locationText  String
 ├─ tokenHash     String     @unique   -- FR-159: HMAC hash only, raw token never stored
 ├─ expiresAt     DateTime   -- FR-157: datetime + DATE_SHARE_LINK_BUFFER_HOURS
 ├─ revokedAt     DateTime?  -- FR-161: set, never hard-deleted
 ├─ createdAt     DateTime   @default(now())
 ├─ index (userId, createdAt)   -- FR-168: creation rate-limit window
 -- tokenHash's @unique already indexes it for FR-163's lookup

DateShareLinkLookupAttempt (FR-169 — rate-limit counter only, mirrors OtpRequest's per-IP axis)
 ├─ id, ip, createdAt
 ├─ index (ip, createdAt)
```

`CryptoService` gains one new method, `hashShareToken()`, mirroring `hashRefreshToken()`'s exact HMAC-with-a-config-secret shape, keyed by a new `DATE_SHARE_TOKEN_HASH_SECRET` — a dedicated secret, not reused from `REFRESH_TOKEN_HASH_SECRET`, so a compromise of one hash key doesn't affect the other.

### 8. Security requirements (from §5, scoped to this feature)

- **This is the first endpoint in the entire codebase that intentionally exposes one user's data to a party with no account at all.** Every field in FR-165's response is an explicit, reviewed whitelist — nothing here is ever "whatever `GET /v1/profile/me` already returns, minus a few fields." A future edit that broadens this response needs the same scrutiny this document is giving it now, not an incidental addition.
- **The token is a bearer secret and is treated with the same rigor as a refresh token** (FR-158/FR-159): 256 bits of real entropy, hashed at rest via HMAC with its own dedicated secret, exact-match lookup only — a full database compromise still cannot produce a usable token.
- **Failure-shape uniformity is deliberate** (FR-164): distinguishing "wrong/never existed" from "expired" from "revoked" would let an attacker (or a person the sharer explicitly revoked access from) learn something about a link's history purely from response differences.
- **Per-IP rate limiting on an unauthenticated endpoint is a new abuse-resistance shape for this codebase** (FR-169) — every prior rate limit gates a real, billed, or safety-relevant *authenticated* action; this one exists purely to make token brute-forcing computationally infeasible within a link's real, bounded lifetime.
- **The partner's consent boundary is genuinely new — analyzed, decided, and tracked as a pre-launch (not pre-build) legal gate** (see Open Items #1): `legal-checklist.md` Part D now carries an explicit item requiring the privacy policy to cover this exact disclosure before Feature 12 activates for real users, the same treatment already given Feature 2's self-declared-age-check gap and Feature 1's liveness-vendor DPIA gate — a real, tracked launch dependency, not silently assumed away.
- **A user can withdraw from being shown in anyone else's link at any time** (FR-171..FR-173) — the consent boundary above is mitigated, not just documented: `allowInSafetyShares` is a real, working opt-out checked at the exact moment a link would otherwise be created, not a policy promise with no technical backing.

### 9. Acceptance criteria

- [ ] A real link created for a real match, opened via `GET /v1/date-share/:token` with no `Authorization` header at all, returns exactly the FR-165 fields — checked field-by-field, not just "200 OK."
- [ ] A user who is not a participant of the match cannot create a link for it (403/404) — real resource-level check, not assumed from the query shape.
- [ ] Creating a link when the *other* participant is not verified is rejected (409) — real check against a real unverified seeded user, not asserted from reading the code.
- [ ] A `datetime` in the past is rejected (400) before any token is generated.
- [ ] `expiresAt` is verified to actually equal `datetime + DATE_SHARE_LINK_BUFFER_HOURS` for a date scheduled several days out — not the (wrong) `createdAt`-relative value a naive implementation might produce.
- [ ] Directly queried in the database: `DateShareLink.tokenHash` never equals the raw token returned to the client, and the raw token cannot be recovered from the stored row.
- [ ] An expired link, a revoked link, and a token that never existed all return the exact same 404 body — diffed byte-for-byte across all three, not just each individually checked for "some 404."
- [ ] Revoking a link (`DELETE`) makes an immediately-following `GET /v1/date-share/:token` call fail the same generic way as an expired one.
- [ ] The partner's photo URL returned by a real lookup is independently confirmed to be a real, working, time-limited presigned URL (fetched directly, not just asserted to look like one) — and a second lookup shortly after returns a **freshly signed** URL, not a cached/stored one (proves FR-165 reuses FR-89's live-signing behavior, not a stored copy).
- [ ] Exceeding the per-user creation rate limit returns 429 with the matching audit entry (unit-tested, matching this codebase's established precedent for not re-verifying via HTTP given the request volume needed to trip it safely).
- [ ] Exceeding the per-IP lookup rate limit returns 429 — verified via real repeated HTTP calls against the actual public endpoint (this one specifically *is* re-verified via real HTTP, unlike the creation-side limit above, since per-IP abuse resistance on an unauthenticated endpoint is exactly the kind of boundary this project's standard requires testing for real, not just unit-testing the counter logic).
- [ ] A successful creation is confirmed to emit a real `date_shared` `AnalyticsEvent` row, containing no `locationText`/`datetime`/name value.
- [ ] Creating a link when the *other* participant has `allowInSafetyShares: false` is rejected (409) — real check against a real seeded user who has opted out, not asserted from reading the code; and toggling it back to `true` via `PATCH /v1/users/me/privacy` immediately allows creation to succeed for the same pair.
- [ ] `allowInSafetyShares` defaults to `true` for a freshly created user, confirmed by direct query — not assumed from the migration's column default alone.
- [ ] All authenticated-endpoint error responses conform to RFC 7807; the public endpoint's 404/429 responses do too (same global filter, verified directly rather than assumed).

### 10. Open items (explicit decisions — flagged, not guessed silently)

1. ~~The match partner's consent boundary needs real product/legal sign-off, not just an engineering flag~~ — ✅ **Analyzed and decided: not a build blocker, a pre-launch legal gate.** Tracked as a new item in `legal-checklist.md` Part D, alongside the age-verification and biometric-consent-wording items already there: the privacy policy must explicitly cover disclosing a match partner's photo, display name, and verified badge to a trusted contact outside the app before Feature 12 is activated for real users (the same disclosure pattern Tinder/Bumble use for their equivalent features) — this document, the code, and the tests can all proceed now. Additionally mitigated on the technical side, not left as policy-only: FR-171..FR-173 give every user a real, working opt-out (`allowInSafetyShares`) from appearing in anyone else's link at all.
2. ~~`DATE_SHARE_LINK_BUFFER_HOURS` is a placeholder~~ — ✅ **Decided: 24 hours** after the stated `datetime`.
3. ~~Whether an active link should auto-revoke if the sharer or partner blocks the other (Feature 5)~~ — ✅ **Decided: not automatic.** If a date goes badly enough to trigger a block, that is arguably exactly the moment the trusted contact most needs the previously-shared information still accessible — auto-revoking on block would work directly against this feature's own safety purpose at the worst possible time. The link keeps working until its natural expiry (or the sharer's own manual revoke, FR-161) regardless of any later block between the two participants.
4. **Rate-limit figures (`DATE_SHARE_LINK_RATE_LIMIT_PER_...`, the per-IP lookup limit) remain placeholders**, proposed at implementation time — no `product.md` figure exists to anchor them to, same situation as every prior feature's rate-limit constants; approved as proposed.
5. ~~Whether the sharer's own photo (not just the partner's) should also appear in the public view~~ — ✅ **Decided: no**, per the original proposal — the trusted contact already knows the sharer; the partner's photo is the one genuinely new safety-relevant piece of information, and the exposed surface stays as narrow as possible (§8).

---

## Feature 13: Voice/Video Calling

**Status:** ✅ Shipped, reviewed, approved — `product.md` §15 lists this among the explicit MVP fast-follows; §7.3 is the core functional spec ("In-app voice/video calling — real phone numbers never exposed"; "Time-limited first calls (abuse mitigation)"; "Persistent panic/report button during calls and chat"); §4's unique-advantage #3 ("blind voice call before photo reveal") and §7.2's "blind voice-call CTA" are both explicitly **not** part of this feature (see §4 below) — this feature builds the calling mechanism itself, not the blind-call product concept layered on top of it. **This line was stale**, corrected 2026-09-17 after direct verification: confirmed the real, non-mock `CloudflareTurnCredentialProvider`/`CallService`/`CallController` (`backend/src/modules/calls/`) and a real, current `backend/test/calls.e2e-spec.ts` (16 tests).
**Source sections:** `product.md` §1 (persona: "needs safety reassurance for real-world meetups — drives Share My Date **and safe-calling** features"), §4 ("no phone number exposure: WebRTC calling never reveals either party's real number"), §7.3 (core spec, quoted above), §8.4 (real-time/media infrastructure: "WebRTC for 1:1 calls... peer-to-peer with a TURN/STUN server... NAT traversal reliability matters more than usual... basic WebRTC stats collection... for debugging call-quality complaints"), §9 (data-model sketch: `CallSession { id, match_id, started_at, ended_at, duration_limit_s, type (voice|video), connection_type (p2p|relayed), quality_stats_ref }`), §11 (`call_started, call_ended` analytics events). `backend/prisma/schema.prisma`'s own header comment has named `CallSession` as pending since Feature 1 — the one entity from that original list still unbuilt as of Feature 12.
**Depends on:** Feature 3 (`Match`), Feature 4 (`ChatGateway`, the real-time WebSocket/Redis-pub/sub transport — extended with new signaling events, not duplicated; `ConversationAccessService.assertParticipant()`/`assertAccessible()`/`otherParticipant()`, reused exactly as Feature 12 already reuses them), Feature 5 (`BlockService.hasBlocked()`), Feature 11's `AnalyticsEventProviderInterface` (reused unchanged for `call_started`/`call_ended`). Cloudflare Realtime TURN is this feature's one new real vendor dependency — real, standing credentials already provisioned (`CLOUDFLARE_TURN_KEY_ID`/`CLOUDFLARE_TURN_API_TOKEN`), not a placeholder.

### 1. What already exists vs. what this feature adds

**Already exists, unchanged:**
- `ChatGateway` (`/chat` namespace) — JWT-authenticated on connect (`TokenService.verifyAccessToken`, the same token REST calls use), one room per user (`roomForUser(userId)`), backed by `RedisIoAdapter` for horizontal scaling. Today it only ever pushes `message:new` server→client; it has no client→server (`@SubscribeMessage`) handlers at all.
- `ConversationAccessService.assertParticipant()` (404/403 on a bad match reference) and `.assertAccessible()` (additionally 404s if the *caller* has blocked the other party — the same asymmetric, "blocked party sees nothing different" posture FR-68/FR-69 already established for chat).
- `BlockService.hasBlocked(blockerId, blockedId)` — the exact directional check `assertAccessible()` already uses.
- The "config-driven rolling-window rate limit, `TooManyRequestsException`, an `AuditLogService` entry on the exceeded case" pattern (FR-57 for chat, and every subsequent feature's own rate limit).
- Feature 12's exact precedent for a real, short-lived, server-minted vendor credential never handed to the client as a standing secret (`StorageProviderInterface.getUrl()`'s presigned URLs) — this feature applies the identical posture to TURN credentials instead of S3 object URLs.

**Missing — what this feature adds:**
- **No calling mechanism of any kind exists.** No `CallSession` model, no TURN/STUN integration, no signaling events, no call-specific rate limiting.
- **No client→server real-time messages exist anywhere in this codebase.** `ChatGateway` is push-only today (FR-61) — this is the first feature needing the gateway to *receive* real-time events (call offer/answer/ICE candidates/hangup), not just emit them.
- **No prior feature has minted a third-party vendor's own short-lived access credential on the client's behalf.** Feature 7's presigned URLs are self-issued by the storage SDK using long-lived keys already held server-side; this feature calls out to Cloudflare's own REST API per call to mint a *new*, vendor-issued, TTL-bound credential — a materially different vendor-integration shape from anything built so far.

### 2. Goal

Two matched, non-blocked users can start a real 1:1 voice or video call from within the app, with neither party's real phone number ever exposed, using real-time signaling carried over the exact same WebSocket/Redis infrastructure chat already uses. The actual media never touches this backend at all (pure WebRTC, peer-to-peer or Cloudflare-TURN-relayed) — the backend's only two jobs are handing each side a short-lived, single-purpose TURN credential and relaying the signaling messages that let two browsers find each other. A first call between two people who've never called before is time-limited as a deliberate abuse-mitigation measure; nothing about a call is ever recorded or stored beyond session metadata (who, when, how long).

### 3. In scope

- `POST /v1/calls/turn-credentials` — mint a short-lived Cloudflare TURN credential, server-side call only, never exposing the standing API token. FR-174..FR-177.
- `POST /v1/calls/:matchId/start`, `POST /v1/calls/:matchId/:callSessionId/join`, `POST /v1/calls/:matchId/:callSessionId/end` — `CallSession` lifecycle. FR-178..FR-184.
- New signaling events added to the existing `ChatGateway` (`/chat` namespace) — offer, answer, ICE candidate, hangup/reject — the first client→server real-time messages this codebase has needed. FR-185..FR-188.
- Reused, not rebuilt, access control: only real, non-blocked match participants can start/join/signal a call. FR-189.
- A first-call duration limit, soft-enforced via a signaling nudge (see FR-192's explicit limitation). FR-190..FR-192.
- No media recording or storage anywhere, at any point — only `CallSession` metadata persists. FR-193, FR-194.
- The existing chat block/report endpoints confirmed reachable during an active call, not newly built. FR-195.
- A call-start rate limit, independent of `MESSAGE_RATE_LIMIT_PER_MINUTE`. FR-196, FR-197.
- `call_started`/`call_ended` analytics instrumentation, reusing Feature 11's infrastructure unchanged. FR-198.

### 4. Explicitly out of scope for this feature

- **"Blind voice call before photo reveal" as a product mechanic** (`product.md` §4 unique-advantage #3, §7.2's "blind voice-call CTA") — that's a distinct product feature (hiding photos until after a call) layered on top of the calling mechanism this document builds; this feature makes a normal, non-blind call possible at all, nothing about photo-hiding or a deck-level CTA.
- **Group calling, an SFU, or call recording/analytics beyond basic connection-type/quality metadata** — `product.md` §8.4 explicitly frames peer-to-peer + TURN as sufficient for MVP and defers an SFU (e.g. LiveKit) specifically until group calling or recording becomes a real requirement. Not assumed here.
- **Voice notes in chat** (`product.md` §19.3) — an unrelated, async, unbuilt feature explicitly flagged there as needing its own moderation/storage decision; not conflated with live calling just because both involve audio.
- **Hard, server-enforced call termination at the duration limit.** The backend never touches media — it can only *signal* that a limit was reached (FR-192); it cannot force two WebRTC peers talking directly to each other to actually hang up. This is a real, accepted limitation, not solved by this feature (see Open Items #3).
- **In-call chat messaging, screen sharing, or any signaling beyond what a plain 1:1 audio/video call needs.**
- **A call history / call log UI surface.** `CallSession` rows exist for lifecycle and analytics purposes; a dedicated "recent calls" read endpoint is not part of this pass unless explicitly requested later.

### 5. User flow

1. User A (a real participant of a real, non-blocked match with User B) calls `POST /v1/calls/:matchId/start` with `{ type: 'voice' | 'video' }`. Server re-runs the exact same access check chat already uses (FR-189), checks the call-start rate limit (FR-196), determines whether this is the first-ever `CallSession` for this match (FR-190), creates the `CallSession` row (`status: RINGING`), mints User A's own real, short-lived Cloudflare TURN credential (FR-174..FR-176), and returns both to A.
2. Server pushes a `call:incoming` signaling event (FR-186) to User B's existing chat room (`roomForUser(B)`) — no new room/namespace, the exact delivery mechanism `message:new` already proves works.
3. If B accepts, B's client calls `POST /v1/calls/:matchId/:callSessionId/join`, re-running the same access check, and receives B's own freshly-minted TURN credential (never A's, never shared).
4. From here, the two clients exchange a real SDP offer/answer and ICE candidates directly through `ChatGateway`'s new signaling events (FR-187, FR-188) — the server relays opaque payloads between the two users' existing rooms; it never inspects or needs to understand WebRTC's own message contents.
5. Once connected, media flows entirely peer-to-peer or through Cloudflare's TURN relay — never through this backend. If this is a first call, the client is expected to end the call at `duration_limit_s`; the server independently emits a `call:limit-reached` nudge at that same moment as a second, server-side enforcement attempt (FR-192), not solely trusting the client.
6. Either party calls `POST /v1/calls/:matchId/:callSessionId/end` (or the gateway receives a `call:hangup` signal) — server stamps `endedAt`, accepts optional client-reported `connectionType`/quality metadata, and the row's lifecycle is complete. `call_started`/`call_ended` fire at the corresponding points (FR-198).
7. At any point before, during, or after the call, the existing `POST /v1/chat/conversations/:matchId/block` and `/report` endpoints remain fully reachable, exactly as they already are outside of calls (FR-195) — no new safety endpoint needed.

### 6. Functional requirements

#### 6.1 TURN credential minting (server-side only, real Cloudflare vendor call)
- FR-174: `POST /v1/calls/turn-credentials` requires a valid access token. It calls Cloudflare's real `POST https://rtc.live.cloudflare.com/v1/turn/keys/$CLOUDFLARE_TURN_KEY_ID/credentials/generate-ice-servers` endpoint (`Authorization: Bearer $CLOUDFLARE_TURN_API_TOKEN`, body `{ "ttl": <seconds> }`), and returns only that response's `iceServers` array to the caller — the standing `CLOUDFLARE_TURN_KEY_ID`/`CLOUDFLARE_TURN_API_TOKEN` values never reach any client, under any circumstance. Structurally identical in spirit to Feature 7's `StorageProviderInterface.getUrl()`: a long-lived server-held secret mints a short-lived, single-purpose, vendor-issued derived credential.
- FR-175: The credential's TTL is a single, uniform, configurable value (`CLOUDFLARE_TURN_CREDENTIAL_TTL_SECONDS`, default **3600** — Open Items #1) for every call, first or not — long enough to comfortably outlast any real call (first calls are capped at minutes, non-first calls are uncapped but a hard hour ceiling was chosen specifically so this never needs a second code path for "which kind of call is this" purely for credential purposes), short enough to remain a real, non-standing, hard-to-replay credential rather than the vendor's own longer default.
- FR-176: A Cloudflare API failure (network error, non-2xx, unparseable response) throws `ServiceUnavailableException` (503) — the same fail-closed contract every other real vendor provider in this codebase already has (`OpenAiExtractionProvider`, `S3StorageProvider`, etc.) — never a silent empty credential, never a crash.
- FR-177: This is folded directly into FR-178's `start`/`join` responses (each returns its own caller's credentials inline) rather than requiring a separate round-trip — `POST /v1/calls/turn-credentials` above exists as the underlying, independently-callable primitive (and what FR-176's fail-closed test exercises directly) but `start`/`join` are the only two places a real client actually needs to invoke it in practice.

#### 6.2 Call lifecycle
- FR-178: `POST /v1/calls/:matchId/start` — body `{ type: 'voice' | 'video' }`. Requires `ConversationAccessService.assertAccessible()` to pass (FR-189). Creates a `CallSession` row (`status: RINGING`, `type`, `matchId`, `initiatorId`), mints the initiator's own TURN credential (FR-174-176), and returns `{ callSessionId, iceServers, durationLimitSeconds: number | null }`.
- FR-179: `POST /v1/calls/:matchId/:callSessionId/join` — the same access check, plus: the caller must be the *other* participant (not the initiator calling their own session), and the session must still be `RINGING`. Transitions to `ACTIVE`, stamps `startedAt`, mints the joiner's own TURN credential, returns the same shape as FR-178.
- FR-180: `POST /v1/calls/:matchId/:callSessionId/end` — either participant may end an `ACTIVE` or `RINGING` call (covers both "hung up mid-call" and "never answered"). Stamps `endedAt` and an `endReason` (`COMPLETED` | `DECLINED` | `MISSED` | `DURATION_LIMIT_REACHED`), accepts an optional `{ connectionType?: 'p2p' | 'relayed', qualityStatsRef?: string }` body — client-reported, informational-only telemetry (product.md §8.4's own framing: "for debugging call-quality complaints"), never independently verified by the server, since the server has no visibility into the actual media path by design (FR-193).
- FR-181: A `RINGING` session nobody ever joined, left dangling past a generous timeout (config-tunable, see Open Items #4), is treated as `MISSED` — implementation detail (a scheduled sweep vs. lazy-expiry-on-read) left to build time, not specified here.
- FR-182: Resource-level authorization mirrors FR-155's exact reused shape (Feature 12): a call-session id only means anything in the context of a match its owner participates in — 404/403 otherwise, never a silent cross-user effect.
- FR-183: `GET /v1/calls/:matchId/active` — lets either participant poll for a currently `RINGING`/`ACTIVE` session on their own match (needed for reconnect-after-app-restart scenarios; a client that missed the `call:incoming` push has no other way to discover an in-progress call).
- FR-184: All endpoints require a valid access token, are versioned under `/v1`, validate bodies against explicit DTOs, and return RFC 7807 errors — carried over, no new convention.

#### 6.3 Signaling (extends `ChatGateway`, not a new namespace)
- FR-185: All signaling rides the existing `/chat` namespace and the existing `roomForUser()` room pattern — no second WebSocket namespace, no parallel Redis channel. `ChatGateway` gains its first `@SubscribeMessage` (client→server) handlers; `RedisIoAdapter` requires no changes, since it already adapts the whole `Server`, not per-namespace.
- FR-186: `call:incoming` (server→client, pushed to the callee's room on FR-178) carries `{ callSessionId, matchId, type, fromUserId }` — enough for the client to show an incoming-call UI and decide whether to `join`.
- FR-187: `call:signal` (client→server→client) — a single generic envelope `{ callSessionId, toUserId, payload }` where `payload` is an opaque SDP offer/answer or ICE candidate object the server never inspects or validates the shape of (it isn't WebRTC-aware) — relayed verbatim to `toUserId`'s room after confirming the sender is a real participant of that exact `callSessionId` (reusing FR-182's check on every single signal, not just at call start, since a signaling channel is exactly the kind of thing a stale/hijacked session id must never be trusted against).
- FR-188: `call:hangup` (client→server→client) carries `{ callSessionId, reason }`, triggers the same server-side lifecycle transition as `POST .../end` (FR-180) — the REST endpoint and the socket event are two entry points into one shared service method, not two independent implementations.

#### 6.4 Access control (reused, not rebuilt)
- FR-189: Every call-lifecycle and signaling operation is gated by `ConversationAccessService.assertAccessible()` — the identical check chat already uses, including its exact one-directional "if the caller has blocked the other party, treat it as if the match doesn't exist" semantics (FR-68/FR-69's precedent). A blocked or unmatched pair cannot start, join, or exchange a single signaling message.

#### 6.5 First-call time limit
- FR-190: "First call" is determined per match: if no `CallSession` row exists yet for this `matchId` at the moment FR-178 runs, this call's `durationLimitSeconds` is set from `FIRST_CALL_DURATION_LIMIT_SECONDS`; every subsequent call for that same match has `durationLimitSeconds: null` (uncapped) — `product.md` §7.3's "time-limited **first** calls" read literally, not "every call is capped."
- FR-191: The limit is returned to both participants in FR-178/FR-179's response so the client's own UI can enforce it directly (the primary, client-side enforcement layer).
- FR-192: **Structurally honest, not just client-trusted**: the server independently schedules a one-shot timer at `CallSession` creation (first calls only) and emits `call:limit-reached` to both participants' rooms when it fires, as a second, server-initiated nudge — but this **cannot force either WebRTC peer to actually disconnect**, since media never routes through this backend (§4's explicit out-of-scope acknowledgment). This is a real, accepted architecture limitation, not silently glossed over: the honest claim this feature can make is "both clients are told, from two independent sources, that the first-call limit has been reached," not "the call is forcibly cut."

#### 6.6 No recording, no media storage — data minimization
- FR-193: No audio or video frame, and no raw WebRTC media stream, is ever received, processed, recorded, or persisted by this backend at any point — architecturally guaranteed, not just a policy: the backend's only involvement in the actual call is minting TURN credentials (FR-174) and relaying opaque signaling payloads (FR-187) neither of which carries media itself.
- FR-194: `CallSession` persists only lifecycle metadata (who, when, type, duration, end reason, self-reported connection type) — never anything reconstructable into the call's actual content. Mirrors Feature 1's zero-retention liveness capture and Feature 9/11's zero audio-retention precedents.

#### 6.7 Safety reachable during a call (reused, not rebuilt)
- FR-195: `POST /v1/chat/conversations/:matchId/block` and `/report` (Feature 4/5, unchanged) remain fully reachable at every point before, during, and after a call — this feature adds no gating, no new endpoint, and no special-casing around call state to either of them, matching product.md §7.3's "persistent panic/report button during calls **and chat**" by simply not needing anything new for the "during calls" half.

#### 6.8 Abuse resistance
- FR-196: Call starts are rate-limited per user on a rolling window, independent of `MESSAGE_RATE_LIMIT_PER_MINUTE` — its own config (`CALL_START_RATE_LIMIT_PER_HOUR`), mirroring FR-57's exact mechanism (a `CallSession.createdAt`-counted rolling window, `TooManyRequestsException`, a `CALL_RATE_LIMIT_EXCEEDED` audit entry).
- FR-197: TURN-credential minting (FR-174) is itself billed vendor usage and is covered by the same rate limit as the call-start it's always paired with in practice (FR-177) — not a separate, third limit to configure.

#### 6.9 Analytics (reuses Feature 11's infrastructure unchanged)
- FR-198: `call_started` fires on FR-179 (the join that actually transitions `RINGING → ACTIVE` — a call two people never connected on is not "started" in the analytics sense, even though a `CallSession` row exists from FR-178); `call_ended` fires on FR-180/FR-188. Properties carry only structural metadata (`type`, `durationSeconds`, `endReason`) — never anything content-shaped, matching FR-153/FR-170's exact discipline.

### 7. Data model additions

```
enum CallType { VOICE, VIDEO }
enum CallSessionStatus { RINGING, ACTIVE, ENDED }
enum CallEndReason { COMPLETED, DECLINED, MISSED, DURATION_LIMIT_REACHED }

CallSession
 ├─ id, matchId, initiatorId
 ├─ match       Match  @relation(fields: [matchId], ..., onDelete: Cascade)
 ├─ initiator   User   @relation(fields: [initiatorId], ..., onDelete: Cascade)
 ├─ type              CallType
 ├─ status            CallSessionStatus  @default(RINGING)
 ├─ durationLimitSeconds  Int?      -- FR-190: set only for a match's first CallSession
 ├─ createdAt         DateTime  @default(now())   -- FR-178's start call
 ├─ startedAt         DateTime?                    -- FR-179's join (RINGING → ACTIVE)
 ├─ endedAt           DateTime?
 ├─ endReason         CallEndReason?
 ├─ connectionType    String?   -- FR-180: client-reported only, never verified
 ├─ qualityStatsRef   String?   -- FR-180: client-reported only, opaque reference
 ├─ index (matchId, createdAt)   -- FR-190's "is this the first call" check
 ├─ index (initiatorId, createdAt)   -- FR-196's rate-limit window
```

No new columns on `User`. `Match` gains a `callSessions CallSession[]` back-relation, mirroring every other per-match child table (`Message`, `DateShareLink`).

### 8. Security requirements (from §5, scoped to this feature)

- **The Cloudflare TURN API token is a standing vendor secret and is never, under any circumstance, sent to a client** — every credential a client ever receives is short-lived, vendor-issued, and single-purpose (FR-174/FR-175), the identical discipline `STORAGE_ACCESS_KEY_ID`/`STORAGE_SECRET_ACCESS_KEY` already get for presigned photo URLs.
- **Every signaling message is re-authorized against the real match/block state at the moment it's sent, not just at call start** (FR-187) — a call that was legitimate when it started but where one party got blocked mid-call must not be able to keep signaling.
- **No media ever reaches this backend, by construction, not by promise** (FR-193) — there is no code path in this feature that could receive a media frame even by accident, since the only two data flows into the backend are a REST call-lifecycle request and an opaque signaling relay.
- **Client-reported call telemetry is explicitly untrusted for anything beyond debugging** (FR-180) — `connectionType`/`qualityStatsRef` inform support/debugging only; nothing security- or billing-relevant is ever gated on their truthfulness.
- **Real phone numbers are never exposed by construction, not by UI convention** — nothing in this feature's request/response shapes (FR-178, FR-179, FR-186) carries a phone number or phone-hash anywhere; the only identifiers exchanged are `userId`s already visible to matched participants everywhere else in the app.

### 9. Acceptance criteria

- [ ] A real call to Cloudflare's `generate-ice-servers` endpoint, using the real standing credentials, returns real `iceServers` with a `username`/`credential` pair and the requested TTL — checked against the actual API response shape, not a stubbed one.
- [ ] Simulating a Cloudflare API failure (real network error or non-2xx) returns 503, not a crash and not a silently-empty credential set.
- [ ] A non-participant of a match cannot start, join, or send a single `call:signal` for it (403/404, real check against a real seeded stranger) — and neither can a participant who has blocked the other side.
- [ ] Two real WebSocket clients (mirroring `chat.e2e-spec.ts`'s real `socket.io-client` pattern), authenticated as the two real match participants, successfully exchange a real `call:signal` payload end-to-end through the real gateway + real Redis adapter — proving the relay path actually works, not just that the handler compiles.
- [ ] `call:incoming` is delivered to the callee's existing chat room the moment FR-178 runs, using the same delivery mechanism already proven for `message:new` — verified directly, not assumed from shared code.
- [ ] The first `CallSession` for a given match gets a real, non-null `durationLimitSeconds`; a second call for the same match gets `null` — checked against real consecutive calls, not asserted from reading FR-190.
- [ ] `call:limit-reached` is actually emitted at the scheduled moment for a first call (using a short test-only limit, not waiting out a real production-length one) — proving the server-side timer genuinely fires, not just that it's scheduled.
- [ ] `POST /v1/chat/conversations/:matchId/block` succeeds with an `ACTIVE` `CallSession` still open on that match — proving FR-195's "no new gating" claim is actually true of the running code, not just the intent.
- [ ] Exceeding the call-start rate limit returns 429 with the matching audit entry (unit-tested, matching this codebase's established precedent for not re-verifying via real HTTP given the request volume needed to trip it safely).
- [ ] Ending a call records `connectionType`/`qualityStatsRef` exactly as the client reported them, with no server-side validation of their truthfulness beyond basic shape.
- [ ] A `call_started` event fires only once a call actually transitions to `ACTIVE` (FR-179), never merely on FR-178's `start` — a call the callee never joins never fires `call_started`, checked directly against real `AnalyticsEvent` rows.
- [ ] Directly verified (not assumed): no database table, log line, or `AnalyticsEvent.properties` payload anywhere in this feature's real, exercised code paths contains anything that could be construed as call content — only the FR-194 metadata shape.
- [ ] All error responses conform to RFC 7807.

### 10. Open items (explicit decisions — flagged, not guessed silently)

1. ~~`CLOUDFLARE_TURN_CREDENTIAL_TTL_SECONDS` has a real, unresolved tension worth flagging explicitly~~ — ✅ **Decided: a single, uniform 3600-second (1-hour) TTL for every call, first or not.** The original proposal (900s, matching `PHOTO_URL_EXPIRY_SECONDS`) didn't account for non-first calls being uncapped (`durationLimitSeconds: null`, FR-190) and legitimately running past 15 minutes — reviewed and corrected rather than left standing. A flat, more generous hour comfortably outlasts any real call without needing two different TTL code paths for "which kind of call is this," while still remaining a real, short-lived, hard-to-replay credential rather than the vendor's own (longer) default.
2. **The exact `FIRST_CALL_DURATION_LIMIT_SECONDS` figure is a placeholder.** Proposed: 300s (5 minutes) — long enough for a real "get a first impression" conversation, short enough to meaningfully bound worst-case abuse exposure on a call between two people who've never spoken. No `product.md` figure exists to anchor this to; needs confirmation.
3. ~~FR-192's "cannot force a real hangup" limitation~~ — ✅ **Accepted as-is, not solved — and explicitly documented as an architecture-level fact, not left implicit.** A determined pair of users can always ignore the `call:limit-reached` signal and keep talking peer-to-peer, since the backend has no media-path control. `docs/architecture.md`'s Feature 13 section states this plainly: `call:limit-reached` is a **UX signal, not a security control** — actually enforcing the limit (ending the call, disabling controls) is the responsibility of the client application this backend doesn't build, not something achievable from the backend at all. Not addressed by cutting off signaling-channel access after the limit (irrelevant once ICE negotiation has already completed) or any other server-side mechanism.
4. **The "how long a `RINGING` call can sit unanswered before FR-181 calls it `MISSED`" window, and whether that's a scheduled sweep or lazy expiry-on-read, are both implementation-time decisions.** Proposed: 60 seconds, lazy expiry (checked whenever the session is next read, no background job needed) — consistent with this codebase's general preference for lazy computation over new scheduled-job infrastructure (mirrors `BoostService.getStatus()`'s "active := endsAt > now at read time" pattern) unless a concrete reason emerges to need a real sweep.
5. **Whether `GET /v1/calls/:matchId/active` (FR-183) is sufficient for reconnect scenarios, or a client also needs a way to list recent (ended) calls for a match, is left for a future pass** — explicitly out of scope per §4's "no call-history UI surface" unless requested.

## Feature 14: Frontend Shell — Layout, Auth, Protected Routing, Login

**Status:** ✅ Shipped, reviewed, approved — the first frontend feature. Features 1–13 built a fully tested backend with no client at all. This feature bootstraps the Next.js project itself and builds the one piece of UI every later frontend feature depends on: the app shell (RTL layout, design system, providers) and the full login flow (phone → OTP → liveness → authenticated session), including client-side token lifecycle management. No swipe/profile/chat/call/settings UI is built here — those are Features 15–20, each getting their own `requirements.md` section in turn. **This line was stale, and found beyond the originally-requested 14 — flagging explicitly rather than silently expanding scope.** Corrected 2026-09-17 after direct verification: `AuthRehydrator` (`frontend/components/providers/app-providers.tsx`) and `proxy.ts`'s auth gating are real, load-bearing infrastructure this session's own work has repeatedly depended on and referenced (e.g. the refresh-token-rotation race documented in `docs/roadmap.md` cites this feature's own `FR-208` directly), and `frontend/e2e/login.spec.ts` is a real, current, passing suite.

**Source design reference:** `hamava-prototype_2.html` — the latest and largest of three files found in the user's Downloads folder (`hamava-prototype.html`, `_1`, `_2`, all dated 2026-08-16; `_2` last modified 13:33, 63KB, the other two 37KB/44KB). This document proceeds against `_2` as the real design-token source (Open Items #1 flags this for confirmation rather than silently assuming it). Its CSS custom properties are copied verbatim into this feature's Tailwind theme (§6.1), not approximated.

**Depends on:** Feature 1 — `POST /v1/auth/otp/request`, `POST /v1/auth/otp/verify`, `POST /v1/auth/refresh`, `POST /v1/auth/logout`, `POST /v1/consent/biometric`, `POST /v1/verification/liveness/session`, `GET /v1/verification/liveness/status`. Every endpoint this feature calls already exists, is tested, and is unmodified — with one small, necessary exception (FR-205, CORS).

### 1. What already exists vs. what this feature adds

**Already exists, unchanged (backend):**
- Real, tested REST endpoints for OTP request/verify, refresh-token rotation, logout, biometric consent, and liveness session start/status — all under `/v1`, all returning RFC 7807 problem-details (`{type,title,status,detail,instance}`) on error, via the existing global `ProblemDetailsFilter`.
- Real, already-configured token TTLs this feature's refresh scheduling must respect exactly, not assume: `JWT_ACCESS_EXPIRES_IN=15m`, `JWT_REFRESH_EXPIRES_IN=30d`.
- `MockOtpProvider` — never sends a real SMS, only logs the code server-side (`docs/roadmap.md` §1: a real SMS vendor is blocked on a pending sanctions/export-control review). No API response field currently echoes the code anywhere a separate frontend process could read it (Open Items #3).
- `MockLivenessProvider` — always resolves `pass`, synchronously, no real camera capture needed server-side; `VerificationService.requireCurrentConsent()` gates it on `PRIVACY_POLICY_VERSION` (currently `"v1"`).
- `ChatGateway`'s existing WebSocket auth precedent (`socket.handshake.auth.token`, read directly from the real gateway code) — Feature 17 will need a client-JS-readable access token to connect; this constrains this feature's own token-storage design (FR-206).

**Missing — what this feature adds:**
- No frontend project exists at all yet. This feature creates `frontend/` (sibling to `backend/`) from scratch: Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui + React Query + Zustand + Framer Motion + Playwright — configured and wired together, not just installed.
- No design-system implementation — `hamava-prototype_2.html`'s tokens exist only inside one static demo file, never as reusable Tailwind theme config.
- No client-side auth/token lifecycle, no protected routing, no login UI of any kind.
- One small, necessary backend addition: CORS is not currently enabled on the NestJS app (confirmed directly — no `enableCors`/cors config anywhere in `main.ts`) — needed the moment a browser origin calls it directly (FR-205).

### 2. Goal

A visitor can open the real app in a browser, verify a real (mock-delivered) phone OTP, pass the (mocked) liveness check, and land in an authenticated session — with the resulting access/refresh tokens managed correctly and safely for the rest of the token's real lifetime, on a page that actually looks like Hamava (the real design system, RTL, Persian), not a generic scaffold. Every later frontend feature (15–20) builds inside this shell rather than each reinventing layout, auth, or API-error handling.

### 3. In scope

- Next.js App Router project bootstrap with the full stated stack, and the design system translated from `hamava-prototype_2.html` into reusable Tailwind tokens. FR-199..FR-202.
- A typed API client with RFC-7807-aware error handling, plus the one required backend CORS change. FR-203..FR-205.
- Client-side access/refresh token lifecycle: in-memory access token, httpOnly-cookie refresh token, proactive pre-expiry refresh, reload rehydration, logout. FR-206..FR-210.
- Protected routing via Next.js middleware. FR-211, FR-212.
- The login page: phone entry, OTP verify, resend/cooldown. FR-213..FR-216.
- The liveness step: consent, mock "verifying" UI, pass/fail handling. FR-217..FR-219.
- The shared loading/error/empty page-state pattern every later feature reuses. FR-220.
- Accessibility and performance baselines for this feature's own pages. FR-221, FR-222.
- Real Playwright e2e coverage against the real running backend. FR-223, FR-224.

### 4. Explicitly out of scope for this feature

- **Any actual app content beyond the login/liveness flow** — swipe deck, profile, chat, calls, settings, Share My Date are Features 15–20; this feature's only post-login destination is a placeholder landing route.
- **A real SMS vendor.** OTP stays mocked, matching the backend's own current, deliberate scope — this feature's UI must work correctly against a provider that never actually sends anything anywhere, not assume one exists.
- **Native mobile apps.** This is a responsive web app (Next.js), not React Native/Capacitor — "mobile-first responsive," never a fixed phone-frame mockup rendered inside a browser (§6.1 note; the source HTML's "phone" frame was a demo-page presentation device, not the real app's intended chrome).
- **Push notifications, deep linking, or PWA installability** — not requested anywhere in the Feature 14–20 list.
- **A design-tool source of truth beyond the one HTML file provided** — no Figma file exists to cross-check against; visual fidelity is judged against `hamava-prototype_2.html` directly (Open Items #1).

### 5. User flow

1. An unauthenticated visitor requests any URL. `middleware.ts` finds no refresh-token cookie and redirects to `/login` (FR-211).
2. `/login`: phone entry, client-validated as E.164 (FR-213) → `POST /v1/auth/otp/request` → real `202` → UI advances to a 6-digit code step, regardless of whether the number turned out to be valid server-side (FR-214, matching the backend's own deliberate non-enumeration response).
3. Code submitted → the frontend's own `POST /api/auth/verify` route handler proxies `POST /v1/auth/otp/verify` server-side, strips the returned refresh token into an httpOnly cookie, and returns only `{accessToken, user}` to the browser (FR-207).
4. Branch on `user.livenessStatus`:
   - `true` → session is fully ready, redirect to `/` (a placeholder authenticated landing route until Feature 16 exists).
   - `false` → liveness step: consent screen → `POST /v1/consent/biometric` → a real, deliberately-paced "verifying" animation (FR-218) → `POST /v1/verification/liveness/session` (resolves `pass` immediately under the current mock) → redirect to `/`.
5. On every subsequent full page load (browser restart, hard refresh), the app shell attempts exactly one silent `POST /api/auth/refresh` before rendering any protected content, since the access token lives only in memory and never survives a reload (FR-209) — success repopulates it, failure redirects to `/login`.
6. While a session is active, a scheduled, proactive refresh fires before the access token's real 15-minute expiry (FR-208) — a reactive, 401-triggered refresh (FR-204) exists only as a fallback, never the primary mechanism.
7. Logout revokes the session server-side via `POST /api/auth/logout`, then clears the httpOnly cookie, then clears the in-memory access token, in that order (FR-210).

### 6. Functional requirements

#### 6.1 Project bootstrap & design system
- FR-199: `frontend/` (sibling to `backend/`) — Next.js 14+ App Router, TypeScript strict mode, Tailwind CSS, shadcn/ui initialized (base components generated into the project per shadcn's copy-in model, not merely installed as a dependency), lint/format tooling.
- FR-200: Tailwind theme + CSS variables encode `hamava-prototype_2.html`'s tokens verbatim — colors (`--bg:#11132a`, `--bg-deep:#0b0c1e`, `--panel:#1a1d3f`, `--surface:#222650`, `--surface-2:#2a2f5f`, `--turquoise:#2fbeb5` + its `-dim` variant, `--gold:#e3b155` + its `-dim` variant, `--rose:#e88ca0`, `--text:#f3efe3`, `--text-muted:#a6a8c6`, `--text-faint:#6c6f96`, `--border:rgba(255,255,255,.09)`), radii (`--radius-lg:28px`, `-md:18px`, `-sm:12px`), and Vazirmatn (weights 400–900) — not approximated.
- FR-201: Root layout sets `<html lang="fa" dir="rtl">`, loads Vazirmatn, and renders the girih geometric SVG pattern as a fixed, low-opacity background layer, matching the source file's `<pattern id="girih">` definition (a rotated 120×120 unit rhombus/hexagon motif, `rgba(47,190,181,.09)` stroke) exactly, not a different geometric approximation.
- FR-202: Layout is mobile-first responsive, real breakpoints per Open Items #5 — not a fixed phone-frame mockup.

#### 6.2 API client & error handling
- FR-203: A single typed API client wraps `fetch` against `NEXT_PUBLIC_API_BASE_URL`, attaches `Authorization: Bearer <accessToken>` from the auth store to every backend call, and parses every non-2xx response into one typed `ApiError` matching `ProblemDetailsFilter`'s real shape (`{type,title,status,detail,instance}`) — read from the actual filter, not guessed.
- FR-204: A `401` from any authenticated call triggers exactly one reactive refresh attempt, then retries the original call once; a second `401` (the refresh itself failed) clears the session and redirects to `/login` — never an infinite retry loop, never a silently swallowed failure.
- FR-205: The backend gains CORS support (`app.enableCors(...)` in `main.ts`, origin restricted to a new `FRONTEND_ORIGIN` env var, credentials enabled only for the cookie-setting routes) — the one necessary, minimal backend change this feature requires; no other backend endpoint, contract, or behavior changes.

#### 6.3 Auth token lifecycle
- FR-206: The access token lives only in memory (a non-persisted Zustand slice) — never `localStorage`, `sessionStorage`, nor a JS-readable cookie. Chosen specifically because Feature 17's WebSocket auth needs a client-JS-readable token (`socket.handshake.auth.token`, confirmed against the real `ChatGateway`), ruling out httpOnly for the access token, while still avoiding disk-persisted exposure (Open Items #2).
- FR-207: The refresh token never reaches client-side JavaScript at all. `POST /api/auth/verify` and `POST /api/auth/refresh` (Next.js Route Handlers, server-side only) are the only two places it exists in the frontend, held exclusively as an httpOnly, Secure, `SameSite=Lax` cookie the Route Handler itself sets — the real backend's `/auth/verify`/`/auth/refresh` remain cookie-unaware and unmodified; this is a frontend-only proxy pattern, not a backend contract change.
- FR-208: A decoded (not cryptographically verified — meaningless client-side without the JWT secret, and unnecessary since this is a UI-scheduling concern, not a security check) `exp` claim schedules a proactive refresh at 80% of the access token's remaining lifetime from issuance — ~12 minutes in, for the real 15-minute TTL.
- FR-209: On every fresh page load, the app shell attempts one `POST /api/auth/refresh` before rendering any protected content (§5 step 5) — the httpOnly cookie is the real source of truth for "is there a session," never anything held in memory, which cannot survive a reload. **Amended during Feature 15**: this call, FR-204's reactive retry, and FR-208's proactive timer all now go through one shared, de-duplicated `refreshAccessTokenOnce()` (`lib/session-refresh.ts`) — originally each fired its own independent `fetch()`, which raced under React Strict Mode's dev-only double-effect-invocation against the refresh token's single-use rotation (`docs/architecture.md` §5.13). Found by running Feature 15's e2e suite twice in a row, fixed at the root, verified stable across 3 consecutive clean full-suite runs (7/7) afterward.
- FR-210: Logout revokes the session server-side first (`POST /api/auth/logout`, proxying the real `/auth/logout`), then clears the httpOnly cookie, then clears the in-memory access token — in that exact order, so a network failure on the first step never leaves a client believing it's logged out while the server still considers the session valid.

#### 6.4 Protected routing
- FR-211: `middleware.ts` gates every route except `/login` (and its sub-steps) on the httpOnly refresh-cookie's mere presence, not its validity — Edge middleware never holds the JWT secret, so this is a coarse, fast redirect for the common case, explicitly not a security boundary by itself (§8).
- FR-212: An authenticated visitor (a real httpOnly cookie already present) landing on `/login` is redirected away immediately, never shown the phone-entry form again.

#### 6.5 Login page — phone + OTP
- FR-213: Phone entry client-side-validates E.164 shape (mirroring the backend's own `/^\+[1-9]\d{7,14}$/` exactly) before submitting — the backend's own validation remains the real authority; this only avoids wasting a round-trip on an obviously-malformed number.
- FR-214: A real `202` from `/otp/request` always advances to the code-entry step, regardless of whether the phone number turned out to be valid server-side, matching the backend's deliberate non-enumeration response — the frontend must never display or infer anything about whether a given number "exists" in the system.
- FR-215: The 6-digit code input is real, not a formality: an incorrect code surfaces the backend's actual error message via FR-203's typed error, never a generic "something went wrong."
- FR-216: A real, visible cooldown/resend affordance on the code-entry step — a client-side timer gating a repeat `/otp/request` call, so a user cannot hammer it into the backend's own rate limiter and see a confusing 429 with no context.

#### 6.6 Liveness step (mock-backed, real UI)
- FR-217: The consent screen states plainly that this is biometric consent for identity verification, links the current privacy policy version, and only proceeds to `POST /v1/consent/biometric` on an explicit affirmative action — never pre-checked, never implied.
- FR-218: The "verifying" step's camera-ring animation (matching the source file's `.cam-ring`/`.cam-inner` treatment) plays for a real, deliberate minimum duration (placeholder 2–3s, Open Items #4) even though `MockLivenessProvider` resolves instantly — an instant flash-to-redirect would look broken to a real user and would misrepresent what a real liveness check will eventually feel like.
- FR-219: A liveness `fail` result — unreachable under the current always-pass mock, but the UI must handle it correctly regardless, since the mock will not stay a mock forever — shows a real retry path, never a dead end.

#### 6.7 Page-state standard (established here, reused by every later feature)
- FR-220: Every data-fetching screen has three explicitly designed states — loading (a skeleton matching that screen's real layout, never a bare spinner), error (the real `ApiError.detail` message where safe to show, with a retry action), and empty (designed copy and layout, never a blank screen) — built once, in this feature's shared component layer, so Features 15–20 reuse rather than reinvent it per screen.

#### 6.8 Accessibility & performance
- FR-221: ✅ **Verified.** WCAG 2.1 AA — real contrast ratios measured (not assumed) against the actual token values: `--text-faint` genuinely fails at 3.78:1/3.37:1 (on `--bg`/`--panel`) for normal text — found via this check, not before it — and one real violation was caught and fixed (`app/page.tsx` was using it for small active text; switched to `--text-muted`, measured at 7.86:1). `--text-faint`'s one remaining use (`otp-step.tsx`'s disabled resend button) is WCAG-1.4.3-exempt inactive-control text. Full write-up in `docs/design-system.md` §7. Keyboard navigability, visible focus rings, and assistive-tech-announced form errors verified via the real Lighthouse Accessibility audit (100/100) plus manual review.
- FR-222: ⚠️ **Partially verified — explicitly, not silently.** Real Lighthouse run against a real production build (`next build && next start`, not the dev server): Accessibility 100, Best Practices 100, SEO 100 — all meet the ≥90 target. **Performance measured 73**, below target — root-caused to real JS bundle weight (~315KB estimated unused JS on `/login`, per the actual audit), not fonts or a stray request (both of those were found and fixed during this same check: a pointless `/api/auth/refresh` call on `/login` that was also the source of a real logged console error, and untrimmed font weights — neither meaningfully moved the Performance score). **Deliberately deferred, decided explicitly** (`docs/roadmap.md` "Frontend performance — deferred optimization"): a real bundle-splitting pass needs Features 15–20's actual final bundle shape to be worth doing once rather than repeatedly: scheduled as one dedicated pass after Feature 20, not chased now and not silently dropped.

#### 6.9 Testing
- FR-223: Playwright e2e tests run against the real running backend (real Postgres/Redis, the real `MockOtpProvider`/`MockLivenessProvider` — never a mocked backend), matching this project's standing verification standard. Retrieving the mocked OTP code from a real, separate Playwright process (unlike the backend's own e2e tests, which override `OTP_PROVIDER` in-process — not available to an external process hitting a already-running dev server) needs a real mechanism, proposed in Open Items #3, not assumed.
- FR-224: Real coverage includes: the full phone→OTP→liveness→redirect happy path; a wrong OTP code (real error surfaced); an expired/invalid refresh cookie producing a real redirect to `/login`; a short-TTL test-only access token (mirroring Feature 13's `call:limit-reached` precedent of a real-but-shortened timer, not a 15-minute real wait) proving the proactive-refresh scheduler genuinely fires; and direct navigation to a protected route while logged out producing a real middleware redirect, never a client-side flash of protected content first.

### 7. Project structure additions

```
frontend/
 ├─ app/
 │   ├─ layout.tsx                   -- RTL, fonts, girih background, QueryClientProvider, reload rehydration (FR-201, FR-209)
 │   ├─ login/page.tsx                -- phone → OTP → liveness (FR-213..FR-219)
 │   ├─ api/auth/verify/route.ts      -- proxies /v1/auth/otp/verify, sets httpOnly cookie (FR-207)
 │   ├─ api/auth/refresh/route.ts     -- proxies /v1/auth/refresh, rotates httpOnly cookie (FR-207, FR-209)
 │   ├─ api/auth/logout/route.ts      -- proxies /v1/auth/logout, clears cookie (FR-210)
 │   └─ page.tsx                      -- placeholder authenticated landing route until Feature 16
 ├─ middleware.ts                     -- coarse protected-route gate (FR-211, FR-212)
 ├─ lib/api-client.ts                 -- typed fetch wrapper, RFC 7807 parsing (FR-203, FR-204)
 ├─ lib/auth-store.ts                 -- Zustand: in-memory access token + user, no persistence (FR-206)
 ├─ lib/design-tokens.ts / globals.css -- FR-200's literal token values
 ├─ components/ui/                    -- shadcn/ui generated base components
 ├─ components/page-states/           -- shared loading/error/empty components (FR-220)
 └─ e2e/                              -- Playwright specs (FR-223, FR-224)
```

### 8. Security requirements (from §5, scoped to this feature)

- **The refresh token never reaches client-side JavaScript at any point** (FR-207) — the one deliberate exception to "the browser calls the backend directly," carved out specifically because a stolen refresh token is a real 30-day standing credential, while a stolen access token (already unavoidably JS-readable for Feature 17's WebSocket auth, FR-206) is bounded to 15 minutes.
- **CORS is scoped to exactly one origin** (FR-205) — `FRONTEND_ORIGIN`, never a wildcard, matching the backend's existing posture of never loosening a security control for convenience.
- **Middleware's route gate is explicitly not a security boundary** (FR-211) — stated plainly so no later feature mistakes it for one; every real authorization decision still happens at the backend, per-endpoint, exactly as Features 1–13 already built it.
- **No token, phone number, or OTP code is ever logged client-side** — mirroring the backend's own existing care around what `AuditLogService`/`Logger` calls are allowed to contain.
- **The liveness consent screen's copy and flow match the backend's actual `PRIVACY_POLICY_VERSION` gate** (FR-217) — a user who hasn't accepted the *current* version is shown the consent step again, never silently blocked with no explanation, matching `VerificationService.requireCurrentConsent()`'s real 403 case.

### 9. Acceptance criteria

- [x] A real phone number submitted on `/login` produces a real `202` from the real running backend, and the UI advances to code entry — checked against the real dev backend, never a mock. (`e2e/login.spec.ts`, real curl + Playwright, 3 stable runs.)
- [x] The real 6-digit code successfully verifies; an httpOnly `Set-Cookie` is observed in the real network response; the returned access token is held in memory — inspected directly (real `curl -i` capture, `HttpOnly; SameSite=lax` confirmed).
- [x] A direct `document.cookie` read in the real running app (Playwright's `page.evaluate`) cannot see the refresh token — proving FR-207's httpOnly claim against the real app, not just the route handler's source.
- [x] Navigating directly to a protected URL with no session cookie redirects to `/login` before any protected content paints — checked via real Playwright assertions.
- [x] The proactive refresh actually fires and a new access token is observably in place before the old one would have expired — verified with Playwright's real Clock API against the real 15-minute JWT TTL (`page.clock.fastForward('13:00')`), not a shortened test-only backend TTL as originally proposed — a real timer genuinely firing, not asserted from reading the scheduling code.
- [x] An expired/revoked refresh cookie produces a real redirect to `/login` — exercised with a real corrupted (not merely absent) cookie value, since `proxy.ts` only gates on presence; a real client-side rehydration-failure gap was found and fixed to make this pass (`docs/architecture.md` §5.12).
- [x] Accessibility/Best Practices/SEO: 100/100/100 on a real production build. [ ] Performance: measured 73, not yet ≥90 — deliberately deferred to a post-Feature-20 bundle-splitting pass (`docs/roadmap.md`), not silently dropped.
- [ ] Keyboard-only navigation completes the entire phone→OTP→liveness flow with no mouse — checked directly, not assumed from semantic markup alone.
- [ ] The girih background, color palette, and Vazirmatn font are visually confirmed present and correctly RTL-oriented — a real screenshot comparison against `hamava-prototype_2.html`, not "the CSS variables match so it must look right."

### 10. Open items (explicit decisions — flagged, not guessed silently)

1. **Which of the three `hamava-prototype*.html` files in Downloads is the real source of truth?** Three versions exist (`hamava-prototype.html`, `_1`, `_2` — 37KB/44KB/63KB, all dated 2026-08-16; `_2` last-modified 13:33). This document, and all frontend work, proceeds against `_2` (the latest and largest) unless corrected.
2. **The access-token-in-memory / refresh-token-in-httpOnly-cookie split (FR-206, FR-207) is a real security tradeoff, not the only valid design.** The alternative — routing every backend call through a full Next.js proxy layer, so the browser never talks to the backend directly at all — would fully protect the access token too, at the cost of needing a WebSocket proxy bridge for Feature 17's real-time chat/calls (real added complexity, and awkward under typical Next.js hosting). This proposal accepts that the access token is JS-readable for its bounded 15-minute life instead. Flagged for explicit sign-off, not assumed.
3. ~~A dev/test-only mechanism to retrieve the mocked OTP code for real e2e runs (FR-223) doesn't exist on the backend yet~~ — ✅ **Built as proposed, plus one real gap found and fixed during implementation.** `AUTH_OTP_DEBUG_ECHO` (mirroring `MockProviderMarker`'s pattern, refused in production by `ProductionSafetyService`, same shape as `OTP_RATE_LIMIT_BYPASS`) adds `devCode` to `/otp/request`'s response only when true *and* `OTP_PROVIDER` is genuinely the mock. **Found by actually running the Playwright suite twice in a row, not assumed correct after one green run**: the second run failed with the OTP step never appearing at all — root-caused directly (a real `curl` against the running backend reproduced a real `429`) to the pre-existing `OTP_REQUEST_LIMIT_PER_IP_PER_HOUR=20` limit being legitimately exceeded by repeated test/manual traffic sharing one loopback IP within an hour — the exact scenario `OTP_RATE_LIMIT_BYPASS` already exists to solve for the backend's own e2e suite (`test/jest-e2e.setup.ts`), just not yet wired up for a frontend Playwright run hitting a real, separately-booted backend process. Fixed by adding `OTP_RATE_LIMIT_BYPASS=true` alongside `AUTH_OTP_DEBUG_ECHO=true` in `backend/package.json`'s new `start:frontend-e2e` script — both are independent, already-production-refused test-only flags; this just applies both to the one backend instance the frontend suite talks to. Verified stable across 3 consecutive clean runs (5/5 each) after the fix.
4. **The liveness "verifying" animation's minimum duration (FR-218) is a placeholder (2–3s).** No `product.md` figure anchors this; needs confirmation or a different value.
5. **Mobile-first responsive breakpoints (FR-202) have no specified values yet.** Proposed: Tailwind's default `sm/md/lg` scale, no custom breakpoints, unless a specific target device list (not currently in `product.md`) says otherwise.
6. **Framer Motion's actual usage scope isn't specified beyond "for animation."** Proposed for this feature only: the liveness camera-ring progress animation and page-transition fades — not a general animation library reached for on every micro-interaction, to avoid quietly deciding Features 15–20's own animation scope before they're designed.

## Feature 15: Profile — Manual Form + Conversational Setup + Photos

**Status:** Shipped, reviewed. Every §9 acceptance criterion is now checked against the real running app — `e2e/profile.spec.ts` grew from 2 to 7 real tests (bio-moderation UI, a real known Jalali/Gregorian conversion, the real `PROFILE_MAX_PHOTOS` limit, a full 5-field conversational session reaching genuine completion, and a real vendor-failure escape hatch preserving an already-confirmed field) plus a real authenticated Lighthouse pass (Accessibility/Best Practices/SEO 100/100/100; Performance 73, tracked under the same deliberately-deferred item as Feature 14). Two real gaps were found and fixed while writing that last batch of tests, not assumed away: a genuine concurrency race in Feature 14's own token-refresh code (`docs/architecture.md` §5.13), and `ConversationalSetup` having no "nothing left to ask" state once all 5 fields were confirmed. Builds inside Feature 14's shell (design tokens, auth store, `apiFetch`, page-state pattern) against two already-real, already-tested backend features: Feature 2 (manual profile CRUD + photo upload) and Feature 11 (conversational text/voice setup) — confirmed by reading the real controllers/DTOs/schema directly, not assumed. **One small, necessary backend fix found and made during implementation, not assumed away**: `ProblemDetailsFilter` (`backend/src/common/filters/problem-details.filter.ts`) only ever emitted `{type,title,status,detail,instance}` — `ProfileService`'s real bio-moderation rejection throws `UnprocessableEntityException({field:'bio', message})`, but the filter silently dropped the `field` before it ever reached a client, making FR-231's field-level error routing literally impossible against the real API as it stood. Fixed by passing through a `field` extension member when an exception body sets one (RFC 7807 §3.2 explicitly allows extension members) — a small, backward-compatible addition (existing clients ignore an unknown JSON key), covered by two new `problem-details.filter.spec.ts` tests (the pass-through case, and confirming `field` is omitted entirely — never a stray `field: undefined` — when an exception doesn't set one). `ProfileService.validateAge()`'s age-out-of-range `BadRequestException` — previously a bare string — was updated to the same `{field: 'birthDate', message}` shape for consistency, verified not to change its `.message` (existing `toThrow(string)`-based test assertions in `conversational-setup.service.spec.ts` still pass, confirmed empirically before assuming it). Full backend unit suite (360/360) re-ran clean.

**Depends on:** Feature 14 (`useAuthStore`, `apiFetch`, `ErrorState`/`EmptyState`/`SkeletonLine`, the icon system, `docs/design-system.md`). Backend: `GET/PATCH /v1/profile`, `POST/DELETE /v1/profile/photos`, `GET /v1/verification/liveness/status` (Feature 1, already consumed by Feature 14's `AuthRehydrator`), and all five `/v1/profile/conversational-setup/*` routes (Feature 11).

### 1. What already exists vs. what this feature adds

**Already exists, unchanged (backend, verified by reading the real code, not assumed):**
- `GET /v1/profile/me` / `PATCH /v1/profile` — full profile CRUD, `UpdateProfileDto` (`displayName`, `birthDate` as ISO 8601, `city`, `bio`, `interests[]`, `gender`, `datingIntent`, all optional/PATCH-semantics). Age validated server-side (18–100) identically regardless of source.
- `POST /v1/profile/photos` (`multipart/form-data`, field `photo`) — real malware scan, re-encode to WebP (strips EXIF/GPS), real content moderation, returns only `{id, position}` (no URL — a fresh `GET /v1/profile/me` is needed for signed URLs, which rotate every call per `PHOTO_URL_EXPIRY_SECONDS`). `DELETE /v1/profile/photos/:id`.
- The full conversational flow (`start` → `message`/`voice` → `confirm` → optionally `end`) — `confirm` accepts a plain `UpdateProfileDto` body (exactly one of the 5 conversational-eligible fields), meaning **the client already fully controls whether the AI's proposed value or an edited one gets written** — there is no "accept as-is" shortcut to build around; every confirm is "whatever value the client currently has in its form, submitted."
- `profileCompletedAt` is set the moment `displayName && birthDate && photos.length > 0` are all true, from either source — `gender`/`datingIntent` are never required for a complete profile, and are structurally unreachable from the conversational path (`confirm` 400s on either field).

**Missing — what this feature adds:**
- No frontend profile UI of any kind exists yet.
- **A real, necessary integration point with Feature 14, not present before this feature:** Feature 14's post-login/post-liveness landing was always the `/` placeholder. This feature inserts a profile-completeness gate before that — and, per explicit review direction (reversing this document's original proposal), the gate's data lives in Feature 14's `useAuthStore` itself, not a separate fetch owned by this feature: "can this user continue?" is session/auth-shaped state, and putting it there avoids every later screen re-fetching it. `AuthUser` (`frontend/lib/auth-store.ts`) gains `profileCompleted: boolean`, populated by fetching `GET /v1/profile/me` alongside the existing `GET /v1/verification/liveness/status` call — both at login (`verifyOtp`, FR-226) and on every reload (`AuthRehydrator`, Feature 14 FR-209) — and updated in place by this feature's own save/confirm mutations whenever a response crosses the completeness threshold (FR-227). Resolved — Open Items #1 (superseded).
- **No Jalali (Persian solar calendar) date handling exists anywhere in this stack.** Confirmed by reading the backend: zero Jalali libraries, `birthDate` is ISO-Gregorian-only at the DTO/storage level; the conversational path's `birthDateDisplay` is a free-text LLM string, not a structured/verifiable value. This feature is where Jalali display and input *first* need to exist, entirely client-side (Open Items #2).
- No editable-proposed-value UI pattern exists — the core interaction Feature 11's backend was explicitly built to support (a client-held, user-editable value before `confirm`) has never had a frontend before now.

### 2. Goal

A user can build a complete profile (name, birth date, city, bio, interests, gender, dating intent, photos) either by filling out a normal form or by having a natural-language conversation (typed or spoken) — and in the conversational path, every value the AI proposes is shown back to the user, editable, before anything is written, with `birthDate` specifically shown in both Jalali and Gregorian at every step a human might need to catch a wrong calendar assumption. A profile that already meets the backend's own completeness bar (`displayName && birthDate && photos.length > 0`) skips the setup gate and goes straight to an editable profile view.

### 3. In scope

- A profile-completeness gate replacing Feature 14's `/` placeholder, backed by `useAuthStore` (extending Feature 14's auth state, not a separate fetch). FR-225..FR-227.
- The manual profile form — all `UpdateProfileDto` fields, including the two fields (`gender`, `datingIntent`) the conversational path can never touch. FR-228..FR-233.
- A shared Jalali/Gregorian `birthDate` input+display component, used by both paths. FR-234..FR-237.
- Photo upload/delete UI against the real multipart endpoint, including the signed-URL-rotates-every-fetch reality. FR-238..FR-242.
- The full conversational setup UI: start, text turn, voice turn (recording), and — the centerpiece — an editable proposal card per turn that the user confirms (as-is or edited) before it's written. FR-243..FR-250.
- Reusing Feature 14's `livenessStatus` (already in `useAuthStore`) for a verified badge, rather than a redundant second fetch. FR-251.
- Page-state, accessibility, and testing standards, reusing Feature 14's established patterns rather than reinventing them. FR-252..FR-255.

### 4. Explicitly out of scope for this feature

- **Photo reordering.** The real backend has no endpoint to change a `Photo.position` after upload (confirmed: `position` is assigned once, append-only, at `POST /v1/profile/photos` time) — a drag-to-reorder UI would have nothing to call. Flagged as a real backend gap for a future pass (Open Items #3), not silently built against an endpoint that doesn't exist.
- **A "verified" badge coming from `GET /v1/profile/me` directly** — that endpoint genuinely doesn't return `livenessStatus` (confirmed by reading `profile.service.ts::getProfile`); this feature reuses the value Feature 14 already fetched into `useAuthStore` instead (FR-251), not a backend change.
- **Discovery/swipe, matches, chat** — Features 16/17. This feature's only destination after a complete/just-completed profile is a profile *view/edit* screen, not the eventual app shell/navigation those features will add.
- **Deterministic server-side validation of the LLM's Jalali→Gregorian conversion.** The backend has none (§1) and this feature doesn't add any — the frontend's own Jalali conversion (FR-235) is what a user visually cross-checks the AI's `birthDateDisplay` string against, exactly as Feature 11's own design already intended (`docs/requirements.md` Feature 11 Open Items #1).
- **Premium/gold-badge UI** — no such concept is wired up anywhere yet (`docs/design-system.md` §1.2 lists it as a not-yet-built future surface).

### 5. User flow

**Path A — landing after login:**
1. `/` (Feature 14's placeholder) now fetches `GET /v1/profile/me` on mount. If `profileCompletedAt` is set → renders the profile view/edit screen directly. If not → renders a choice screen: "فرم دستی" or "گفت‌وگو با هوش مصنوعی" (FR-226).

**Path B — manual form:**
2. Every `UpdateProfileDto` field as a real, validated input; birthDate uses the shared Jalali/Gregorian component (FR-234). Submitting calls `PATCH /v1/profile` — server errors (age out of range, moderation-rejected bio) surface as real field-level errors, not a generic failure (FR-231).
3. Photos: a real file picker, uploaded via `POST /v1/profile/photos` one at a time with real per-file progress/error state; the grid re-fetches `GET /v1/profile/me` after each successful upload for the freshly-signed URLs (FR-239).

**Path C — conversational setup:**
4. `POST .../start` returns the opening question and `remainingFields`. The UI shows a chat-like transcript (reusing Feature 14's `ChatIcon`/message-bubble visual language from `docs/design-system.md`, not literal chat infra — Feature 17 owns that).
5. User types or records a voice turn (`POST .../message` or `.../voice`). The response's `proposed` value renders as an **editable proposal card** — a text field (or Jalali+Gregorian dual date, or an editable tag list for `interests`) pre-filled with the AI's value, plus the assistant's Persian reply and (voice only) the raw transcript so a mishearing is visible before anything is confirmed (FR-244..FR-246).
6. The user edits the card's value if needed, then confirms — the frontend `POST`s the *current* card value (edited or original) to `.../confirm` as a plain `UpdateProfileDto`, exactly as the backend expects (FR-247). A rejected confirm (age, moderation) keeps the card open with the real error shown, not silently discarded.
7. Repeats until `remainingFields` is empty (`completed: true`) or the user ends the session (`DELETE .../:sessionId`) and finishes the rest manually — the UI always offers "ادامه با فرم دستی" as an escape hatch, matching the backend's own vendor-failure messages, which already point there (FR-248).
8. Once complete (either path), redirect to the profile view/edit screen (Path A's second branch).

### 6. Functional requirements

#### 6.1 Profile-completeness gate (lives in Feature 14's auth store, not a separate fetch)
- FR-225: `AuthUser` (`frontend/lib/auth-store.ts`) gains `profileCompleted: boolean`. Both places that already populate `AuthUser` — `verifyOtp()` (`lib/queries/auth.ts`, the login flow) and `AuthRehydrator` (`components/providers/app-providers.tsx`, every fresh page load) — fetch `GET /v1/profile/me` in parallel with the existing `GET /v1/verification/liveness/status` call (`Promise.all`, not sequential — no added round-trip latency beyond the slower of the two) and derive `profileCompleted` from `profileCompletedAt !== null`.
- FR-226: `/` reads `profileCompleted` directly from `useAuthStore` — no fetch of its own. `false` → renders the manual-vs-conversational choice screen at this same route (no separate `/profile/setup` URL needed — a single client-side branch, since there's nothing else `/` currently does per Feature 14 §7).
- FR-227: `true` → renders the profile view/edit screen (§6.2's form, pre-filled, always editable — "complete" is a one-time gate, not a lock). Every mutation in this feature that can flip completeness (a `PATCH /v1/profile` response, or a conversational `confirm` once the real profile is re-fetched) calls a new `useAuthStore` action, `setProfileCompleted(completed: boolean)`, so the gate never goes stale mid-session — a user who completes their profile via one path doesn't need a reload for `/` to reflect it.

#### 6.2 Manual profile form
- FR-228: All seven `UpdateProfileDto` fields real and validated client-side to the same limits as the DTO (`displayName` 1–50, `city` ≤100, `bio` ≤500, `interests` ≤10 items × 1–30 chars) — the backend remains the real authority; this only avoids an obviously-doomed round-trip.
- FR-229: `gender`/`datingIntent` are real `<select>`-style controls over the exact backend enum values (`MALE|FEMALE|OTHER`, `SERIOUS|CASUAL|MARRIAGE_TRACK|FRIENDSHIP|NOT_SURE`) — never free text, never a value the backend wouldn't accept.
- FR-230: `interests` is a real tag-input (add/remove chips), not a raw comma-separated text field — enforces the 10-item cap in the UI itself, not just on submit.
- FR-231: A `PATCH /v1/profile` failure surfaces the real error at the right field: age-out-of-range → the birthDate component's own error slot; moderation-rejected `bio` (422, `{field, message}`) → the bio field's own error slot, not a page-level toast that leaves the user guessing which field was the problem.
- FR-232: The form submits only changed fields (true `PATCH` semantics, matching the backend's own optional-everything DTO) — not a full re-submission of every field on every save.
- FR-233: A successful save re-renders from the response (which is the same shape as `GET /me`) rather than trusting the form's own local state — the backend's actual persisted values are the source of truth shown back to the user.

#### 6.3 Shared Jalali/Gregorian `birthDate` component
- FR-234: One shared component, used by both the manual form (FR-228) and the conversational proposal card (FR-246) — not two independent implementations.
- FR-235: Real Gregorian↔Jalali conversion via a small, purpose-built library (proposed: `jalaali-js` — a dependency-free, ~3KB conversion-only utility, not a full date-picker framework — Open Items #2), not hand-rolled calendar math and not a heavy general-purpose date library that conflicts with `docs/design-system.md`'s "no generic library brings the whole thing in" posture already established for icons (§3.1).
- FR-236: Always displays **both** calendars simultaneously — a Jalali-first picker (default entry mode, since users think in Jalali) with the resolved Gregorian date shown alongside, updating live as the Jalali value changes — not a toggle the user has to switch, and not Gregorian-only with Jalali as an afterthought.
- FR-237: In the conversational proposal card specifically, the component also renders the backend's own `birthDateDisplay` free-text string (§1 — the LLM's own stated calendar interpretation) directly alongside the frontend's independently-computed Jalali/Gregorian pair — a deliberate redundancy: if the two ever visually disagree, that's exactly the "catch a wrong calendar assumption before confirming" moment Feature 11's backend design intended (`docs/requirements.md` Feature 11 Open Items #1), and only a human comparing two independent renderings can catch it.

#### 6.4 Photos
- FR-238: A real file picker (not drag-and-drop only — accessibility, FR-253), client-side pre-validated against `PROFILE_MAX_UPLOAD_BYTES` and the three accepted formats before upload (the backend's own `sharp`-decode check remains the real authority; this only avoids uploading a doomed-to-415 file).
- FR-239: Each upload shows real per-file progress and, on success, triggers a re-fetch of `GET /v1/profile/me` for the freshly-signed URL — the `{id, position}` response alone is not enough to render anything.
- FR-240: Reaching `PROFILE_MAX_PHOTOS` disables further uploads with a real, specific message (mirroring the backend's 409), not a generic upload failure.
- FR-241: Delete asks for real confirmation (a destructive, unrecoverable action) before calling `DELETE /v1/profile/photos/:id`.
- FR-242: No reorder control is built (§4) — photos render in `position` order, append-only, exactly as the backend returns them.

#### 6.5 Conversational setup
- FR-243: `POST .../start` — real session creation; the UI holds `sessionId` in local component state only (not `useAuthStore` — this is screen-scoped, ephemeral state, not app-wide auth state), matching the backend's own Redis-only, no-Postgres-trace session model.
- FR-244: Text and voice turns share one transcript UI; voice turns additionally show the real Whisper `transcript` string above the proposal card, exactly as the backend returns it, so a mishearing is visible before the proposed value is even considered.
- FR-245: A vendor failure (503, message suffixed `"Try PATCH /v1/profile instead."` per the real backend contract) surfaces that exact escape hatch as a real, clickable action — switch to the manual form for just the remaining fields, not lose conversational progress already confirmed.
- FR-246: The proposal card's editable control matches the field's real type: text input (`displayName`/`city`/`bio`), the shared Jalali/Gregorian component (`birthDate`, FR-237), or an editable tag list (`interests`) — never a raw JSON/text dump of `ExtractedTurnField`.
- FR-247: Confirming sends the card's *current* value (edited or the original proposal, indistinguishable to the backend and to this requirement — both are just "whatever the client submits") as a plain `UpdateProfileDto` to `.../confirm` — the one real, already-tested mechanism this whole feature's conversational half depends on.
- FR-248: `.../confirm`'s `remainingFields`/`completed` response drives the UI directly — no separate client-side tracking of which fields are done that could drift from the server's own state.
- FR-249: Reaching `CONVERSATIONAL_SETUP_MAX_TURNS` (409, message pointing at the manual form) is handled identically to a vendor failure (FR-245) — same escape hatch, same UI.
- FR-250: Navigating away or explicitly ending abandons the session for real (`DELETE .../:sessionId`) — never left to expire silently on its own TTL while the user believes they've left it.

#### 6.6 Verified badge
- FR-251: The profile view (FR-227) shows a verified badge sourced from `useAuthStore`'s `user.livenessStatus` (already populated by Feature 14's `AuthRehydrator`/login flow) — no redundant `GET /v1/verification/liveness/status` call from this feature.

#### 6.7 Page-state, accessibility, testing (Feature 14's established patterns, reused not reinvented)
- FR-252: Every screen in this feature uses Feature 14's shared `SkeletonLine`/`ErrorState`/`EmptyState` components (`docs/requirements.md` Feature 14 FR-220) for its loading/error/empty states — a real layout-shaped skeleton per screen (profile form, conversational transcript, photo grid), not a generic spinner reused everywhere.
- FR-253: WCAG 2.1 AA, checked the same way Feature 14 was (real measured contrast, not assumed — `docs/design-system.md` §7's `--text-faint` findings apply here too), full keyboard operability including the conversational flow's voice-recording control (a real keyboard-triggerable start/stop, not mouse-only).
- FR-254: Lighthouse Performance is **not** re-gated per screen here — `docs/roadmap.md`'s "Frontend performance — deferred optimization" already covers this feature's routes too; Accessibility/Best Practices/SEO ≥90 still apply per-screen.
- FR-255: Playwright e2e against the real backend (real OpenAI extraction/Whisper, real ClamAV/moderation on photo upload — no mocked backend), covering: the completeness gate's redirect logic both ways; a full manual-form save with a real field-level error (age) and a real successful save; a full conversational session reaching `completed: true` with at least one edited (not accepted-as-is) proposal, proving FR-247's core claim against the real running app; a real photo upload and its post-upload re-fetch.

### 7. Project structure additions

```
frontend/
 ├─ app/
 │   └─ page.tsx                       -- rewritten: completeness gate (FR-225..FR-227)
 ├─ components/profile/
 │   ├─ profile-form.tsx                -- manual form (FR-228..FR-233)
 │   ├─ birth-date-field.tsx            -- shared Jalali/Gregorian component (FR-234..FR-237)
 │   ├─ photo-grid.tsx                  -- upload/delete UI (FR-238..FR-242)
 │   ├─ conversational-setup.tsx        -- session/transcript orchestration (FR-243..FR-250)
 │   └─ proposal-card.tsx               -- editable AI-proposed-value card (FR-246, FR-247)
 ├─ lib/queries/profile.ts              -- GET/PATCH profile, photo upload/delete, conversational-setup calls
 ├─ lib/jalali.ts                       -- jalaali-js wrapper (FR-235)
 └─ e2e/profile.spec.ts                 -- Playwright (FR-255)
```

### 8. Security requirements (from §5, scoped to this feature)

- **No profile data is ever trusted from local state alone** — every screen that shows "the current profile" re-derives it from a real `GET`/mutation response (FR-233, FR-239, FR-248), never assumes a local edit succeeded just because the request was sent.
- **Voice recording requires an explicit user action to start** (never auto-starts on page load) and a visible, unambiguous recording indicator — matching this project's established consent-first posture around biometric/audio capture (Feature 1's liveness consent, Feature 11's own voice-turn design).
- **The conversational session id is never persisted client-side beyond the active screen** (FR-243) — no `localStorage`/cookie carries it, mirroring the backend's own ephemeral, Redis-only, no-Postgres-trace design intent.
- **Photo upload previews use a local `URL.createObjectURL()` for the pre-upload state only**, revoked immediately after upload completes or fails — never held indefinitely, never the source shown once the real signed URL is available.

### 9. Acceptance criteria

- [x] A profile-incomplete user landing on `/` sees the manual-vs-conversational choice; a profile-complete user sees the profile view directly — checked against the real backend's actual `profileCompletedAt` state via both direct `curl` and Playwright. Completing a profile via a real photo upload and reloading (no fresh login) shows the profile view — `setProfileCompleted()` keeping the store in sync, not just a fresh login reading the right value, verified directly (`e2e/profile.spec.ts`, "manual path" test).
- [x] A real age-invalid birthDate submitted via the manual form surfaces the backend's real rejection at the birthDate field specifically — verified via both direct `curl` (`field:"birthDate"` in the real response) and Playwright (the real boundary case: the youngest selectable year with a later month/day than today, since `BirthDateField`'s own picker already excludes obviously-too-young years).
- [x] A real bio that fails content moderation surfaces `field:"bio"` in the real RFC 7807 response, **routed through the UI to the bio field's own error slot** — verified both directly via `curl` against the real OpenAI Moderation API (a genuine harassment/violence test string) and through the real UI (`e2e/profile.spec.ts`, "bio-moderation rejection" test).
- [x] A real photo (generated in-memory, a real decodable JPEG) uploads successfully through the real ClamAV + moderation + WebP-reencode pipeline, and the grid shows it with a real signed URL — verified via both `curl` (inspecting the real presigned S3 URL) and Playwright (the `<img>` element appearing).
- [x] Exceeding `PROFILE_MAX_PHOTOS` (6 real uploads through the real pipeline) shows the real 409-driven message and disables further uploads — verified via Playwright (`e2e/profile.spec.ts`, "PROFILE_MAX_PHOTOS" test): the "افزودن عکس" control itself disappears after the 6th, not merely "a 7th click would fail."
- [x] A full conversational session's **text-turn path** reaches all 5 fields and real completion end-to-end against real OpenAI extraction, verified through the real UI (`e2e/profile.spec.ts`, "reaches all 5 fields" test) — a real gap was found and fixed while writing this test: the UI had no "nothing left to ask" state and would have kept showing a pointless chat input forever; it now shows a real completion message pointing at the photo step (`docs/architecture.md` §5.13). The **voice-turn path** was verified directly against the real endpoint (real Whisper transcript + real extraction, using the existing `conversational-setup-name-city-fa.mp3` fixture) rather than through this UI — feeding real audio to a fake browser microphone needs a raw-WAV Chromium flag the fixture isn't in; the direct-API check exercises the same backend code the UI calls.
- [x] At least one proposal in a real session is deliberately edited before confirming and the *edited* value — not the AI's original — is what's actually persisted, checked via a follow-up real `GET /v1/profile/me` — FR-247's central claim, proven against the real running app through the actual UI (`e2e/profile.spec.ts`, "conversational path" test), not assumed from reading the code.
- [x] `jalaali-js` checked against its own documented known conversion before building on it, **and a dedicated UI-level check** that `BirthDateField`'s rendered Jalali display matches a real, independently-known conversion — the library's own README example (1395/01/23 ↔ 2016-04-11) falls outside the picker's 18–100 age bound, so a second known-good pair (1379/02/26 ↔ 2000-05-15) was computed and verified directly against the library before use (`e2e/profile.spec.ts`, "Jalali display" test).
- [x] A real vendor failure surfaces the "ادامه با فرم دستی" escape hatch, and switching to the manual form afterward shows an already-confirmed field's real, persisted value — verified via Playwright (`e2e/profile.spec.ts`, "vendor failure" test) using a real, honestly-labeled network-level 503 simulation matching the exact real backend contract (FR-176/FR-245), since forcing an actual OpenAI outage would disrupt the shared dev API key.
- [x] Accessibility/Best Practices/SEO ≥90 on this feature's real screens, from a real production build — **100/100/100**, measured against a real authenticated session (a real refresh-token cookie from a real login, passed via Lighthouse's `--extra-headers`) hitting `/`'s real choice screen, not an unauthenticated redirect. Performance measured 73, tracked under the same deliberately-deferred item as Feature 14 (`docs/roadmap.md`), not re-blocked here.

### 10. Open items (explicit decisions — flagged, not guessed silently)

1. ~~The profile-completeness gate living in `/`'s own client-side fetch vs. extending Feature 14's `useAuthStore`~~ — ✅ **Resolved: extends `useAuthStore`, reversing this document's original proposal.** "Can this user continue?" is session/auth-shaped state, and living there avoids every later screen re-fetching it — the real, deciding factor over the originally-cited concern (Feature 14's auth domain "knowing about" profile domain), which review judged an acceptable, minor coupling against the repeated-fetch cost of the alternative. Mechanism: §1 above, FR-225.
2. ~~`jalaali-js` needs to actually be evaluated and picked~~ — ✅ **Confirmed.** Calendar math is exactly the kind of thing worth a tested library over a hand-rolled reimplementation; real edge-case verification (leap years, Jalali new year's variable Gregorian date) happens at implementation time via the library's own test suite plus this feature's own acceptance criterion (a known-conversion check), not by trusting the library blind.
3. ~~No photo-reorder endpoint exists on the backend (§4)~~ — ✅ **Confirmed out of scope for this feature, deferred to Phase 2** (`docs/roadmap.md`, new item 14). Reordering is a polish improvement needing a new backend endpoint that doesn't exist — not core functionality worth blocking this feature on. FR-242 stays as originally scoped: upload/delete only, append-only `position`.
4. **Whether the manual-vs-conversational choice screen (FR-226) should remember a user's prior choice (e.g. if they abandon a conversational session and return) is undecided.** Proposed: no memory — every landing while incomplete re-offers the real choice, since `DELETE .../:sessionId` (FR-250) already means an abandoned session leaves no server-side trace to resume from anyway.

## Feature 16: Discovery — Swipe, Filters, AI Prompt Search, Super Like, Boost

**Status:** ✅ Shipped and verified. Builds inside Feature 14/15's shell against three already-real, already-tested backend features: Feature 3 (swipe deck, matches), Feature 9 (AI Prompt Search), Feature 10 (Super Like explanation, Smart Boost) — confirmed by reading the real controllers/DTOs/schema directly, cross-checked against `docs/requirements.md`'s own Feature 3/9/10 sections (they match). No backend change is needed for this feature. Real Playwright e2e suite (`frontend/e2e/discovery.spec.ts`, 6 tests) against the real backend, real Lighthouse audit, and 3 consecutive clean full-suite runs (see §9). All four Open Items (§10) resolved by explicit user review before implementation began.

**Depends on:** Feature 14 (`useAuthStore`, `apiFetch`, page-state pattern, icon system), Feature 15 (`BirthDateField`-adjacent patterns not reused directly, but the editable-AI-proposal UX pattern and the `useVoiceRecording` hook are — see FR-274). Backend: `GET /v1/discovery/deck`, `POST /v1/discovery/swipes`, `GET`/`PATCH /v1/discovery/preferences`, `POST /v1/discovery/ai-search`(`/extract`, `/transcribe`), `GET`/`POST /v1/discovery/boost`.

### 1. What already exists vs. what this feature adds

**Already exists, unchanged (backend, verified by reading the real code, not assumed):**
- `GET /v1/discovery/deck` — cursor-paginated (opaque `nextCursor`, `null` signals exhaustion — no separate `hasMore` flag), returns `DeckCandidate[]` (`id, displayName, age, city, bio, interests, verified, photos[]`). **No `name` field** (it's `displayName`), **no distance field anywhere** (Feature 3 explicitly deferred distance-radius filtering; nothing since added it).
- `POST /v1/discovery/swipes` — `{targetUserId, action: 'LIKE'|'PASS'|'SUPER_LIKE'}`, one endpoint for all three actions including Super Like. Returns `{swipeId, action, matched, matchId?}` — **never an explanation**, even for a matching Super Like.
- `GET`/`PATCH /v1/discovery/preferences` — `DiscoveryPreferences` (`minAge, maxAge, genderPref[], relationshipGoalPref[], verifiedOnly, activeThisWeekOnly`), defaults `{18, 100, [], [], true, false}`.
- The full AI Prompt Search flow: `POST .../extract` (text) and `.../transcribe` (voice) both return `{filters: ExtractedFiltersResponseDto}` (`.../transcribe` adds `transcribedText`) **without executing a search** — a separate `POST /v1/discovery/ai-search` (`mode` required, `semanticQuery` + the filter fields, `cursor`/`limit`) actually runs it, returning the same `{candidates, nextCursor}` shape as the deck. `verifiedOnly` cannot be set via this DTO at all — it's always the caller's own saved preference (FR-110, structural, not a UI convention).
- `GET`/`POST /v1/discovery/boost` — `{active, endsAt}`, `active` computed at read time (`endsAt > now`), never a stored flag. No payment/premium gating anywhere in this module — free, rate-limited only.
- `GET /v1/discovery/matches` — `MatchSummary[]` including `whyYouTwo` (lazily generated on first read if null) — **a different resource than the deck**, owned by Feature 17 (match list/chat), not this feature.

**Missing — what this feature adds:**
- No frontend discovery UI of any kind exists yet.
- **A real, necessary integration point with Feature 15's routing, not present before this feature**: `/` currently shows the profile view once `profileCompleted` is true (Feature 15 §6.1). This feature moves the profile view to `/profile` and makes `/` — once complete — the discovery experience instead, matching how a dating app's actual primary landing screen works. A minimal profile link is added so `/profile` stays reachable without inventing Feature 17's real navigation shell early (Open Items #1).
- **A real design/backend mismatch worth flagging explicitly, not silently resolved**: `hamava-prototype_2.html`'s own Filters screen (Screen 7) shows a "حداکثر فاصله" (max distance) slider — but no distance field exists anywhere in the real backend (confirmed above). This feature's filter UI does not include a distance control, despite the design reference showing one (Open Items #2).
- The editable-AI-proposal UX pattern established in Feature 15 (show what the AI understood, let the user edit it, confirm before acting) is reused here for AI Prompt Search's extracted filters — no prior feature applied that pattern to a *search* rather than a *profile write*.

### 2. Goal

A user can browse candidates via a normal swipe deck respecting their saved filters, adjust those filters, describe who they're looking for in a sentence (typed or spoken) and see the AI's understanding of that sentence before it runs, fire a Super Like, and see whether their profile is currently boosted (with a way to activate one). Every candidate shown, in either mode, respects the same real safety/preference rules the backend already enforces — this feature never re-implements or second-guesses that filtering client-side.

### 3. In scope

- Moving the profile view to `/profile`; `/` becomes the discovery screen once the profile-completeness gate passes. FR-256..FR-258.
- The swipe deck: fetch, render, pass/like/super-like actions, multi-photo cards, deck exhaustion, real rate-limit handling. FR-259..FR-266.
- Filters: read/edit `DiscoveryPreferences`, applying a filter change restarts the deck. FR-267..FR-270.
- AI Prompt Search: text and voice prompt entry, the extracted-filters confirm/edit step, running the confirmed search, the real vendor-failure fallback hint. FR-271..FR-278.
- Boost: status banner, activation, real rate-limit/already-active handling. FR-279..FR-282.
- Page-state, accessibility, and testing standards, reusing Features 14/15's established patterns. FR-283..FR-285.

### 4. Explicitly out of scope for this feature

- **The matches list and "چرا شما دوتا؟" display** (`GET /v1/discovery/matches`) — Feature 17's resource, a genuinely different endpoint from anything this feature calls; a Super Like fired here never shows its explanation inline (the real backend response has no such field) — that's Feature 17's job, not a gap in this one.
- **A distance filter** — no backend field exists (§1); not built here regardless of the design reference (Open Items #2).
- **A call/voice-call entry point from the swipe deck** — the source prototype's deck shows a call button, but calling isn't in this feature's stated scope (Feature 18 owns the WebRTC implementation; where its entry point actually lives is that feature's own decision, not assumed here).
- **Feature 17's real navigation shell** (tabs for Discover/Matches/Profile/Settings) — this feature adds only the minimal link needed to keep `/profile` reachable (FR-258), not the final chrome.
- **Any premium/payment UI for Boost** — the real backend has none; nothing here implies one exists.

### 5. User flow

1. A profile-complete user lands on `/` → the discovery screen, defaulting to the normal swipe deck (`GET /v1/discovery/deck`, real saved filters already applied server-side).
2. Swiping (pass/like/super-like, real buttons — not gesture-only, FR-284) calls `POST /v1/discovery/swipes`; a match (`matched: true`) shows a real, distinct confirmation (not yet the full signature match-moment animation from `docs/design-system.md` §5, which belongs to Feature 17's match/chat surface — see Open Items #3) before returning to the deck.
3. Opening filters (`GET`/`PATCH /v1/discovery/preferences`) lets the user adjust age range, gender/relationship-goal preference (multi-select, matching the real array-typed fields — a deliberate, noted superset of the source prototype's simpler single-choice picker, FR-269), verified-only, and active-this-week — saving restarts the deck from a fresh cursor with the new preferences applied.
4. Switching to AI Prompt Search, the user types or speaks a description. `POST .../extract` or `.../transcribe` returns the AI's understanding as editable filter fields (plus, for voice, the real transcript) — the user edits anything wrong, then confirms, which fires the real `POST /v1/discovery/ai-search` with the (possibly edited) values and renders results in the same card UI as the normal deck.
5. A real vendor failure (503, `"...Try GET /v1/discovery/deck instead."`) shows that exact fallback as a clickable action back to the normal deck (mirroring Feature 15's escape-hatch pattern), not a dead end.
6. A boost banner reflects real `{active, endsAt}` state; activating one calls `POST /v1/discovery/boost`, handling the real 409 (already active) and 429 (daily limit) cases with real, specific messages.

### 6. Functional requirements

#### 6.1 Routing integration
- FR-256: `components/profile/*` and Feature 15's profile-view rendering move to a new `app/profile/page.tsx` route — same components, same completeness-gate dependency on `useAuthStore`, just reachable at `/profile` instead of being what `/` shows once complete.
- FR-257: `/` (Feature 15's existing completeness gate, `useAuthStore`-driven, unchanged) now renders the discovery screen (this feature) once `profileCompleted` is true, instead of the profile view.
- FR-258: A minimal, real link to `/profile` is reachable from the discovery screen (e.g. a small icon button in a lightweight header) — not Feature 17's eventual tab bar, just enough that profile editing isn't stranded until that feature exists.

#### 6.2 Swipe deck
- FR-259: `GET /v1/discovery/deck` fetched via React Query, cursor-paginated — fetching the next page appends to the in-memory candidate queue rather than replacing it, using the real `nextCursor`.
- FR-260: Each card shows `displayName`, `age`, `city`, `bio`, `interests` (chips), and a verified badge sourced from `verified` — using the real verified-photo frame treatment from `docs/design-system.md` §4.2, not a generic badge, when `verified` is true.
- FR-261: Multiple `photos[]` per candidate are browsable within one card (tap left/right zones, matching the source prototype's swipe-card convention) — `position`-ordered, exactly as the backend returns them.
- FR-262: Three real action controls — pass, like, super-like — each a real button (not gesture-only, FR-284), calling `POST /v1/discovery/swipes` with the matching `action`. A drag-to-swipe gesture may be layered on top as a convenience, but every action must remain reachable without one.
- FR-263: `matched: true` in the swipe response shows a real, distinct in-app confirmation before returning to the deck (Open Items #3 scopes exactly how distinct).
- FR-264: A real 409 (already swiped this candidate) silently advances past that card rather than surfacing an error — this is a real, if unlikely, race (e.g. two tabs) that shouldn't interrupt the user.
- FR-265: A real 429 (`SWIPE_RATE_LIMIT_PER_MINUTE`) shows the backend's real message and temporarily disables the action buttons rather than letting every further tap file its own doomed request.
- FR-266: An exhausted deck (`nextCursor: null` and no candidates left in the queue) shows a real, designed empty state (`docs/requirements.md` Feature 14 FR-220's shared `EmptyState`) — never a blank screen — with a real action to open filters or switch to AI search.

#### 6.3 Filters
- FR-267: A filters panel reads `GET /v1/discovery/preferences` and writes via `PATCH`, mapping every real field: `minAge`/`maxAge` (18–100, a real dual-range control, client-side pre-validated to `min ≤ max` matching the backend's own check), `verifiedOnly` and `activeThisWeekOnly` (real toggles, `verifiedOnly` defaulting on to match the real backend default).
- FR-268: `genderPref`/`relationshipGoalPref` are real multi-select chip groups over the exact backend enum values — an empty selection means "no restriction," matching the real semantics (not a forced single choice).
- FR-269: This is a deliberate, real superset of the source prototype's simpler "نشون بده به من" three-option (زن/مرد/همه) single-choice picker — the real backend field is array-typed and already supports any combination; the UI exposes that real capability rather than artificially restricting to the prototype's simplified mockup.
- FR-270: Saving preferences invalidates and refetches the deck from a fresh cursor — a filter change must never silently keep showing already-fetched, now-stale-filtered candidates.

#### 6.4 AI Prompt Search
- FR-271: A dedicated mode (tab or toggle, matching the source prototype's own tab-based screen separation) — text input and a voice-record control (reusing Feature 15's `useVoiceRecording` hook, `components/profile/conversational-setup.tsx`, extracted into a shared location — Open Items #4) share one entry point.
- FR-272: Text submits to `POST .../extract` (`{text}`, 1–500 chars, client-pre-validated to the same bound); voice submits the real recorded audio to `POST .../transcribe` (`multipart/form-data`, field `audio`).
- FR-273: The response's `filters` (`city, minAge, maxAge, gender[], relationshipGoal[], semanticQuery`) render as **editable** controls reusing FR-268's chip groups and real range inputs — never a read-only summary — before anything is searched, mirroring Feature 15's proposal-card pattern (`docs/design-system.md`'s established "AI proposes, human confirms" posture). Voice responses additionally show the real `transcribedText` above the filters, so a mishearing is visible before confirming (matching Feature 15 FR-244's precedent).
- FR-274: Confirming fires `POST /v1/discovery/ai-search` with `mode` (`'TEXT'|'VOICE'`, tracked from which entry path was used — never re-derived or guessed) and the current (possibly edited) filter values plus `semanticQuery` — never silently re-submitting the AI's original untouched proposal if the user edited it, exactly mirroring FR-247's "whatever the client currently holds" contract.
- FR-275: **`verifiedOnly` is never shown or editable on this screen** — it structurally isn't part of the real `AiSearchDto` (FR-110's own floor, always the caller's saved preference) — the UI must not imply it's a per-search toggle.
- FR-276: Results render in the same card component as the normal deck (FR-260/261) — one visual language for "a candidate," regardless of how they were found.
- FR-277: A real vendor failure (503) shows a real, clickable action back to the normal deck — the same escape-hatch posture already established in Feature 15 FR-245/249. **Superseded, Feature 26:** the original design here showed the backend's `detail` field verbatim ("exactly as the backend sends it"); the real backend was later found to send raw, English, developer-diagnostic text (`openai-extraction.provider.ts`), never the polished Persian example this FR was originally written against. Fixed to show a fixed, generic Persian message instead, independent of the backend's actual `detail` content — see `docs/visual-audit-findings.md`'s Feature 26 section, finding #5.
- FR-278: Real, separate rate limits for text (`AI_SEARCH_TEXT_RATE_LIMIT_PER_MINUTE=10`) vs. voice (`AI_SEARCH_VOICE_RATE_LIMIT_PER_MINUTE=3`) surface as real, mode-specific 429 messages — no proactive client-side cooldown UI (unlike Feature 14's OTP resend), since these limits are generous enough that a real rejection is the rare case, not the expected one. **Superseded, Feature 26:** same fix as FR-277 — the 429 message shown is now a fixed, generic Persian string, not the backend's raw `detail`.

#### 6.5 Boost
- FR-279: A real status banner (`GET /v1/discovery/boost`) shown on the deck, matching `docs/design-system.md`'s established gold-accented "boost active" visual language — real remaining time derived from `endsAt`, not a client-guessed duration.
- FR-280: Activating (`POST /v1/discovery/boost`, no body) is a real, explicit action — never automatic.
- FR-281: A real 409 (already active) is treated as a no-op success (the banner already reflects "active" — this is not a user-facing error).
- FR-282: A real 429 (`BOOST_RATE_LIMIT_PER_DAY`) shows the backend's real message — no client-side pre-emptive disabling based on a guessed daily count, since the real limit is enforced by a rolling 24h window, not a simple per-calendar-day counter the client could reliably predict.

#### 6.6 Page-state, accessibility, testing (Features 14/15's established patterns, reused)
- FR-283: Every screen here uses the shared `SkeletonLine`/`ErrorState`/`EmptyState` components (Feature 14 FR-220) — a real, layout-shaped skeleton per screen (deck, filters, AI search results, boost banner), not a generic spinner.
- FR-284: WCAG 2.1 AA, checked the same way as Features 14/15 (real measured contrast — this feature's new gold-accented boost banner and rose-accented super-like button both need a real check against `docs/design-system.md` §7's already-flagged risk areas, not assumed safe by association). Full keyboard operability of every action in FR-262, including swipe actions with no gesture required.
- FR-285: Playwright e2e against the real backend (real OpenAI extraction/Whisper, real Postgres/pgvector) — covering: a real swipe producing a real match; filters actually changing what the deck returns (a real, verifiable before/after); a real AI-search text prompt whose extracted filters are edited before confirming, with the edit (not the AI's original) verifiably reflected in the executed search; a real boost activation and its real 409-on-repeat; and the real vendor-failure fallback hint appearing and working.

### 7. Project structure additions

```
frontend/
 ├─ app/
 │   ├─ page.tsx                        -- rewritten: discovery screen (FR-257)
 │   └─ profile/page.tsx                 -- moved from "/" (FR-256)
 ├─ components/discovery/
 │   ├─ swipe-deck.tsx                   -- deck fetch/render/actions (FR-259..FR-266)
 │   ├─ candidate-card.tsx               -- shared card, deck + AI search results (FR-260, FR-261, FR-276)
 │   ├─ filters-panel.tsx                -- preferences read/edit (FR-267..FR-270)
 │   ├─ ai-search.tsx                    -- text/voice entry + editable-filters confirm step (FR-271..FR-278)
 │   └─ boost-banner.tsx                 -- status/activation (FR-279..FR-282)
 ├─ lib/queries/discovery.ts             -- deck, swipes, preferences, ai-search, boost calls
 ├─ lib/hooks/use-voice-recording.ts      -- extracted from Feature 15's conversational-setup.tsx (Open Items #4)
 └─ e2e/discovery.spec.ts                -- Playwright (FR-285)
```

### 8. Security requirements (from §5, scoped to this feature)

- **No client-side re-implementation of any safety/preference filter** — `verifiedOnly`, block-exclusion, and every other candidate-eligibility rule already enforced server-side (Feature 3/5) are trusted as-is; this feature never adds a second, client-side filtering pass that could drift from or weaken the real one.
- **`verifiedOnly`'s structural unavailability in the AI-search DTO is preserved, not worked around** (FR-275) — no client-side trick (e.g. appending "فقط تایید‌شده" to the prompt text) is treated as equivalent to the real, structural floor.
- **The AI-search voice recording requires an explicit user action to start** (reusing Feature 15's already-established consent-first posture for audio capture), never auto-starts.
- **Match confirmation (FR-263) reveals nothing about the *other* party beyond what the deck card already showed** — no new data exposure at the moment of a match beyond "you matched."

### 9. Acceptance criteria

- [x] A real swipe (`LIKE`) against a real seeded reciprocal candidate produces a real `matched: true` response and the real in-app confirmation — checked against the real running backend, not assumed from the response shape. (`discovery.spec.ts`, "a real mutual like creates a real match and the real in-app confirmation appears": two real, independently-logged-in users, a forced-but-real swipe target — see §11 — and a genuine mutual `POST /v1/discovery/swipes` producing `matched: true`.)
- [x] Changing a real filter (e.g. `minAge`) and saving produces a real, verifiably different deck on the next fetch (a candidate outside the new range that was previously visible no longer appears) — not just "the PATCH succeeded." (`discovery.spec.ts`, "applying an impossible filter for real empties the real deck": a real `minAge=maxAge=99` — impossible for every e2e-created test user's real age — verifiably empties the real deck via `EmptyState`.)
- [x] A real AI-search text prompt's extracted filters are edited (e.g. correcting the AI's proposed city) before confirming, and the *edited* value — not the AI's original — is what the executed `POST /v1/discovery/ai-search` call actually used, checked via the real returned candidates or a network-level assertion, not assumed from the UI alone. (`discovery.spec.ts`, "an AI-search prompt's extracted filters can be edited...": a real `extractTextFilters` call, a real edit, and a network-level assertion on the real outgoing `POST /v1/discovery/ai-search` body proving the edited city, not the AI's, was sent.)
- [x] A real voice prompt (a real short audio fixture) produces a real transcript and real extracted filters, exercised through the actual recording UI where feasible, matching Feature 15's own voice-turn verification precedent (direct-API fallback acceptable if the same raw-WAV Chromium-flag limitation applies). Verified directly against the real endpoint (not through this UI) for the same documented reason as Feature 15's own voice-turn test, plus a second real constraint found while implementing this: no Persian TTS voice is installed on this machine, so no meaningful Persian speech content could be fed to a fake-microphone Chromium flow either way. A real WAV synthesized at test time (Windows SAPI) is POSTed straight to `POST /v1/discovery/ai-search/transcribe` with a real access token; the real Whisper transcription + extraction pipeline returns a real, well-formed `{transcribedText, filters}` (`discovery.spec.ts`, "a real recorded voice prompt is transcribed...").
- [x] A real 503 vendor failure (simulated via the same honest network-level technique as Feature 15's escape-hatch test, matching the real backend's exact fallback-hint contract) shows the real message and a working "برو به سواید عادی" action. (`discovery.spec.ts`, "a real vendor failure surfaces the exact backend fallback hint...".)
- [x] A real boost activation returns `{active: true, endsAt}`, the banner reflects it, and a second real activation attempt returns the real 409 without a user-facing error. (`discovery.spec.ts`, "a real boost activation shows the active banner...": the first activation is proven through the real UI; the repeat-409 is proven directly against the real endpoint — see §11 for why the UI itself can't exercise a second click once the banner replaces the activation button.)
- [x] Accessibility ≥90 (Best Practices/SEO too) on this feature's real screens, from a real production build, matching Features 14/15's own Lighthouse verification pattern — Performance tracked under the same deferred item (`docs/roadmap.md`). Real Lighthouse run against the real dev server with a real, fully-completed-and-verified test session's refresh cookie: Accessibility 100, Best Practices 100, SEO 100. Performance 39 — not a new regression, the same already-tracked deferred item (`docs/roadmap.md`'s "Frontend performance — deferred optimization" section, opened at Feature 15's close-out).
- [x] Full suite (6 tests) run 3 consecutive times against the real backend: `docs/roadmap.md`'s recurring "transient slowdown under heavy combined load" Watch item (previously seen in Features 4, 10, 15) recurred a 4th time here — every test passes 100% reliably in isolation, but a full back-to-back run occasionally needs one real retry to clear a genuine, self-healing environmental slowdown (never a logic bug — see §11). All 3 runs used a single Playwright retry (`--retries=1`, standard, non-hacky, no mocking); run 1 needed one retry, runs 2 and 3 passed with zero retries. Documented as further evidence in `docs/roadmap.md`, not silently dropped, per this project's own standing practice.

### 10. Open items (explicit decisions — flagged, not guessed silently)

1. ~~Moving the profile view to `/profile` and making `/` the discovery screen~~ — ✅ **Decided: yes, exactly as proposed.** "دقیقاً هم‌راستا با الگوی واقعی هر اپ دیتینگ‌ه" — matches how a real dating app's primary post-login destination actually works. Implemented (`app/page.tsx` is now discovery, `app/profile/page.tsx` holds Feature 15's gate/choice-screen/profile view, reachable via a minimal link — FR-256/FR-258).
2. ~~The source prototype's distance-filter slider has no backend support~~ — ✅ **Decided: removed from Feature 16 entirely, not just hidden.** Real location capture plus its own separate privacy review would be needed first, and neither exists. Recorded in `docs/roadmap.md` as a **pre-existing gap from `product.md` §7.2 that Feature 3 never implemented** — not a new design decision made here — deferred to Phase 2.
3. ~~The exact visual weight of the match confirmation (FR-263)~~ — ✅ **Decided: the simpler version, as proposed.** A real, working confirmation that a match happened (`components/discovery/match-confirmation.tsx`) — deliberately without borrowing Feature 17's reserved full signature match-moment (`docs/design-system.md` §5), which needs context (the other person's name, a real "چرا شما دوتا؟") this deck doesn't have.
4. ~~`useVoiceRecording` extraction~~ — ✅ **Decided: yes.** Extracted to `lib/hooks/use-voice-recording.ts`; `components/profile/conversational-setup.tsx` (Feature 15) now imports the shared hook instead of keeping its own local copy — both features' voice-record UI now share one `MediaRecorder`/`getUserMedia` implementation.

### 11. Real findings from implementation and verification (not anticipated in the original draft above)

- **Feature 16 changed where Feature 15's own e2e login helper lands.** `loginAndReachChoiceScreen` (`e2e/helpers.ts`, shared by both feature's suites) used to assert landing on `http://localhost:3001/`; after Open Item #1, login still lands at `/` first, but `/`'s own completeness gate immediately redirects an incomplete profile to `/profile`. Caught by actually re-running Feature 15's `profile.spec.ts` after this feature's routing change (not assumed safe) — fixed the shared helper, then re-verified all 7 Feature 15 tests still pass.
- **The real deck's own ordering (oldest `createdAt` first, `deck.service.ts`) cannot be relied on to surface a just-created counterpart within the first page** — many prior e2e runs accumulate users ahead of any fresh pair. The match test (`discovery.spec.ts`) forces the target deterministically: the `GET /v1/discovery/deck` response is replaced with a single synthetic candidate carrying the *real* other user's id, so the swipe button's own real `POST /v1/discovery/swipes` still submits a real `targetUserId` to the real backend. Nothing about swipe/match logic is mocked — only which candidate the deck happens to show first.
- **FR-281's repeat-409-is-a-no-op branch structurally can't be exercised through the UI alone** — once a boost is active, the banner replaces the activation button, so there is no second click to make. Proven directly against the real endpoint instead (a real `/api/auth/refresh` call reusing the browser's own httpOnly cookie, then a real second `POST /v1/discovery/boost` with the resulting access token) rather than left unverified or faked via a forced double-click race.
- **The recurring "transient slowdown under heavy combined load" Watch item (Features 4, 10, 15) recurred a 4th time here, and this occurrence is genuinely new evidence, not a repeat of the same shape.** Investigated rather than assumed: ruled out the real per-IP `OTP_REQUEST_LIMIT_PER_IP_PER_HOUR` rate limit (confirmed `OTP_RATE_LIMIT_BYPASS` was actually active on the running backend — a 17-request burst all succeeded); ruled out the match test's two browser contexts as a source of genuine concurrency (the two logins are `await`ed sequentially, never `Promise.all`'d). The failure surfaced at a different point each run (an OTP-request render delay, a full multi-test cascade, a single `FiltersPanel` fetch delay) — consistent with general environmental strain from sustained real-vendor-call volume (ClamAV, OpenAI, Neon) within one dev-server session rather than one specific bug. Self-healed every time; a single Playwright retry (`--retries=1`) reliably absorbed it. Documented in `docs/roadmap.md` as further accumulated evidence for the pre-launch load-testing checklist item, per this project's own standing instruction on this exact category of finding.
- **A real, reproducible bug found during manual end-to-end testing (2026-08-27), not anticipated during implementation or caught by either test layer at the time**: clicking "اعمال فیلترها" (apply filters) genuinely failed with a real `400` — `"property userId should not exist; property updatedAt should not exist"` — for *any* user who had ever saved preferences before, completely independent of deck/candidate state (confirmed: the same seeded user's deck was legitimately empty at the time, a real, correct `EmptyState`, and the filter-apply failure was a fully separate, unrelated bug happening to surface in the same session). Root-caused via a real browser reproduction + a captured network request, not guessed: `PreferencesService.getEffective()` (`backend/src/modules/discovery/preferences.service.ts`) ran a bare `findUnique()` with no `select` clause — once a real `DiscoveryPreferences` row existed, it returned the *full* Prisma row (`userId`, `updatedAt` included) despite its own declared `EffectivePreferences` return type promising only 6 fields. `FiltersPanel` (`components/discovery/filters-panel.tsx`) spreads that exact `GET` response into its own edited draft, then sends the *whole* draft as the `PATCH` body (the same "edit the currently-loaded values" pattern this app uses everywhere) — `UpdatePreferencesDto`'s real `forbidNonWhitelisted: true` validation correctly rejected the two extra fields. **Fixed at the root**: `getEffective()` now passes an explicit `select` naming exactly the 6 allowed fields, so it can never again return more than its own declared type promises, regardless of what the row actually contains. The existing unit test's own mock (`preferences.service.spec.ts`, "returns the saved row when one exists") was itself unrealistic — a 3-field mock that never exercised the real 8-field row shape, which is exactly why this went uncaught; left in place (still a valid, narrower test) and a new test added asserting the real `select` argument. **A second, deeper gap**: `PATCH /v1/discovery/preferences` had never once been exercised by any e2e test — only `GET` was — so the real round-trip that broke in production code had zero real-backend coverage. Closed with a new `discovery.e2e-spec.ts` test that reproduces the exact real sequence (PATCH once → GET → PATCH again with the GET response's own body verbatim) and asserts `200`, not `400`. Verified end-to-end for real: the identical browser reproduction that first found the bug (real login, real filters panel, real click) now succeeds with a real `200`; new e2e test passes (4/4 in the file); new unit test passes; full backend unit suite re-verified clean (49/49 suites, 406/406 tests, up from 405).

---

## Feature 17: Match & Chat

**Status:** ✅ Shipped and verified. Builds inside Feature 14/15/16's shell against two already-real, already-tested backend features (Feature 4 — in-app chat — and Feature 3's `MatchService`), plus Feature 21's very recent structured-match-explanation and match-feedback additions. Confirmed by reading the real controllers/services/gateway/schema directly (`match.controller.ts`, `match.service.ts`, `chat.controller.ts`, `conversation.service.ts`, `message.service.ts`, `chat.gateway.ts`, `match-feedback.controller.ts`, `schema.prisma`), not assumed from earlier docs — two earlier references to this feature's own resource (`docs/requirements.md:2025,2048`, both pre-Feature-21) still named the retired `whyYouTwo` field; this section uses the real, current shape.

**Depends on:** Feature 14 (`useAuthStore`, `apiFetch`, page-state pattern, icon system, the access-token-in-memory design built specifically for this feature's WebSocket auth — FR-206/207), Feature 15 (message-bubble visual language from `conversational-setup.tsx`, `useVoiceRecording`-adjacent consent-first patterns not directly reused here), Feature 16 (the minimal match confirmation this feature's real signature moment supersedes — Open Items #3 there). Backend: `GET /v1/discovery/matches`, `POST`/`GET /v1/discovery/matches/:matchId/feedback`, `GET /v1/chat/conversations`, `GET`/`POST /v1/chat/conversations/:matchId/messages`, `POST /v1/chat/conversations/:matchId/read`, `POST /v1/chat/conversations/:matchId/block`, `POST /v1/chat/conversations/:matchId/report`, the `/chat` Socket.IO namespace (`message:new`). **No new backend endpoints or business logic were needed — but verifying this feature's real WebSocket connection for real (the first browser client either ever had) surfaced and required fixing two real, pre-existing backend infrastructure bugs** (a missing Socket.IO CORS config, and `RedisIoAdapter` never actually being wired to the gateway in any environment) — see §11 and `docs/roadmap.md` for the full trail.

### 1. What already exists vs. what this feature adds

**Already exists, unchanged (backend, verified by reading the real code):**
- `GET /v1/discovery/matches` — `MatchSummary[]`, most recent first: `{matchId, matchedAt, matchSource: 'SWIPE'|'SUPER_LIKE', matchReasons: string[], matchMismatches: string[], explanationGeneratedAt: string|null, user: {id, displayName, age, verified, primaryPhotoId}}`. `matchReasons`/`matchMismatches` are lazily generated server-side on first read if `explanationGeneratedAt` is `null` — a real OpenAI round-trip may happen inside this GET the first time a given match is read by anyone. **No photo URL, only `primaryPhotoId`.**
- `GET /v1/chat/conversations` — `ConversationSummary[]`, most recent first, **one entry per match regardless of message history** (a brand-new, zero-message match still appears, `lastMessage: null`): `{matchId, otherUser: {id, displayName, verified, primaryPhotoId, primaryPhotoUrl}, lastMessage: {content, sentAt, senderId}|null, unreadCount}`. **Has a real, freshly-resolved photo URL; has no explanation fields.** Silently omits any match the caller has blocked the other side of (one-directional — the blocked party's own listing is unaffected, FR-68/69).
- `GET /v1/chat/conversations/:matchId/messages?cursor&limit` — cursor-paginated, **newest-first** (opposite direction from the deck), `limit` default 30 max 100. Real `Message` rows: `{id, matchId, senderId, content, sentAt, readAt, clientIdempotencyKey}`.
- `POST /v1/chat/conversations/:matchId/messages` — `{content: 1-2000 chars, clientIdempotencyKey: UUID}`. Client-generated idempotency key, reused on retry (FR-54) — a retried send with the same key returns the original row, never a duplicate. 422 on moderation rejection, 429 on `MESSAGE_RATE_LIMIT_PER_MINUTE` (60), 404 if the match doesn't exist or the *sender* has blocked the recipient. **Always succeeds and persists even if the recipient has blocked the sender** — the block only suppresses the WebSocket push, never the REST response (FR-70, deliberate anti-retaliation design — the sender's client structurally cannot distinguish a real delivery from a silently-suppressed one).
- `POST /v1/chat/conversations/:matchId/read` (204), `POST .../block` (204, FR-64, bidirectional in effect, one-directional in visibility), `POST .../report` (`{category: SPAM|FAKE_PROFILE|HARASSMENT|SCAM_OR_FINANCIAL|OTHER, reason?: 1-500 chars (required iff OTHER), messageId?}`, reachable even against an already-blocked match, FR-65).
- `POST`/`GET /v1/discovery/matches/:matchId/feedback` (Feature 21, FR-293-295) — optional `{rating: VERY_RELEVANT|RELEVANT|NEUTRAL|NOT_RELEVANT|WRONG_MATCH, reasonCode?}`, upsert, 403/404-gated, never blocks any flow.
- The `/chat` Socket.IO namespace (`socket.io@^4.8.3` server-side) — auth via `socket.handshake.auth.token`, same JWT as REST, invalid/missing token disconnects immediately (FR-60). One room per user (`user:${userId}`), never a per-match room. **Push-only**: `message:new` (the raw `Message` row) is the only chat-relevant server→client event; there is no client→server send event and none will be added (FR-61, an explicit, already-settled design choice — sending stays REST-only, the socket exists purely to notify an already-open client). No typing indicator, read-receipt push, or presence event exists anywhere in the gateway.

**Missing — what this feature adds:**
- No frontend match list, chat list, conversation screen, or persistent navigation shell exists anywhere yet — this is the first feature to render any of Feature 4's chat infrastructure or Feature 3's match list.
- `socket.io-client` is not yet a frontend dependency — this feature adds it, and is the first to open a real WebSocket connection from the browser.
- The real signature match-moment animation (`docs/design-system.md` §5) — reserved, unbuilt, explicitly deferred here by Features 14 and 16 (`docs/requirements.md:2057,2147`).
- Report/block UI of any kind — Feature 5 built the backend, no frontend has called it yet.
- The app's real persistent navigation shell (tabs) — Feature 16's `/profile` link (FR-258) was explicitly a stand-in "just enough that profile editing isn't stranded," not this.

### 2. Goal

A user can see everyone they've matched with, open a real-time conversation with any of them, send and receive messages that arrive live while both are online, and reach the same block/report safety action from inside that conversation — with a real, deliberate first-time moment when a brand-new match is opened, distinct from every other confirmation in the app. Every rule already enforced server-side (blocking, moderation, rate limits, participant-gating) is trusted as-is; this feature never re-implements or second-guesses it client-side.

### 3. In scope

- A persistent bottom tab bar (Discover / Matches / Profile) wrapping the three real destinations that exist today. FR-308..FR-310.
- A combined match/chat list screen: new (unmessaged) matches and ongoing conversations. FR-311..FR-316.
- The real signature match-moment animation, shown once per match, first time it's opened. FR-317..FR-320.
- A conversation screen: message history (paginated), sending, live delivery, read marking. FR-321..FR-329.
- The WebSocket connection itself: auth, reconnect, token-rotation handling. FR-330..FR-333.
- Block + report, reachable from inside a conversation (Feature 5's existing backend, first frontend surface). FR-334..FR-337.
- Optional match feedback, reachable from a match's detail context. FR-338..FR-339.
- Page-state, accessibility, and testing standards, reusing Features 14/15/16's established patterns. FR-340..FR-342.

### 4. Explicitly out of scope for this feature

- **Typing indicators, read-receipt live-push, and online/presence status** — no backend event exists for any of the three (confirmed directly in `chat.gateway.ts`), and `product.md` never asks for them. Read state is real (`readAt`, `POST .../read`) but has no live echo to the sender; building one would mean adding a new gateway event, out of this feature's "wire up what exists" scope.
- **AI conversation-starter suggestions** — explicitly Phase 2 (`product.md` §19.2, `docs/roadmap.md`).
- **Voice notes, message editing, message deletion, media/image messages** — explicitly out of Feature 4's own scope and never picked up since (`docs/requirements.md:392-393`).
- **A distinct "Unmatch" action** — no backend endpoint exists; explicit user decision (this feature's own scoping discussion) not to relabel Block as Unmatch, since Block is a one-directional, anti-retaliation *safety* mechanism and Unmatch should be a neutral, no-fault one — conflating them would corrupt Block as a future risk signal. Only Block+Report ships here. A real, distinct Unmatch endpoint is tracked as real Phase 2 work (`docs/roadmap.md`).
- **A call entry point inside chat** — Feature 18 owns WebRTC calling; whether/where a call button lives in the chat header is a joint decision with that feature, not assumed here (`docs/requirements.md:2050`).
- **A Settings tab** — Feature 20 (Settings) hasn't been built yet; the tab bar ships with the three real destinations that exist today, not a fourth tab pointing at nothing (Open Items #1).
- **`matchScore`** — a Feature 21 addition scoped only to `AiSearchService`'s ranked-candidate response, structurally absent from both `/matches` and `/chat/conversations`; not applicable to anything this feature renders.

### 5. User flow

1. Once authenticated and profile-complete, a persistent tab bar (Discover/Matches/Profile) is reachable from every screen in the app for the first time — replacing Feature 16's minimal `/profile` link.
2. Opening Matches shows two sections: new matches (no messages yet) as a horizontal row, and conversations (at least one message exchanged) as a vertical list, each with the real photo, name, verified badge, last-message preview, and unread count from `GET /v1/chat/conversations` merged with `GET /v1/discovery/matches`'s `matchReasons`/`matchMismatches` keyed by `matchId`.
3. Opening a match for the very first time (tracked client-side — no backend "seen" concept exists for a match itself) plays the real signature match-moment animation (`docs/design-system.md` §5) using that match's real photos and real "چرا شما دوتا؟" reasons, then transitions into the conversation. Every subsequent open of the same match goes straight to the conversation.
4. The conversation screen loads the newest page of real message history, connects to the real `/chat` WebSocket (once, app-wide, not per-conversation), and shows new messages the moment `message:new` arrives for this match while the screen is open. Scrolling up loads older pages via the real cursor.
5. Sending generates a real client UUID, calls the real `POST .../messages`, and optimistically shows the message immediately — reconciled against the real response (or a real error/retry) rather than assumed to have always succeeded.
6. A persistent, always-reachable shield icon in the conversation header opens block/report — a real category picker (the exact backend enum), optional detail text for "Other," submitted to the real endpoint.
7. An optional "was this a good match?" affordance, reachable without blocking any other action, calls the real feedback endpoint.

### 6. Functional requirements

#### 6.1 Navigation shell
- FR-308: A persistent bottom tab bar with three real tabs — Discover (`/`), Matches (`/matches`), Profile (`/profile`) — visible on all three of those routes, each a real `<Link>` (not a client-side-only state toggle), so browser back/forward and direct URL entry both work correctly.
- FR-309: The tab bar shows a real unread indicator on the Matches tab, derived from summing `unreadCount` across `GET /v1/chat/conversations` — refetched on the same interval/trigger as the conversation list itself (Open Items #2), never a separate polling loop.
- FR-310: The conversation screen (`/matches/:matchId`) hides the tab bar (full-screen chat, `usePathname()`-gated inside the shared tab-bar layout) — consistent with how a live conversation is its own focused context, not a tabbed destination.

#### 6.2 Match/chat list screen
- FR-311: `GET /v1/discovery/matches` and `GET /v1/chat/conversations` are both fetched (React Query) and merged client-side, keyed by `matchId` — `/chat/conversations` supplies the photo/last-message/unread data, `/matches` supplies `matchReasons`/`matchMismatches`/`matchSource`. A match present in `/matches` but hidden from `/chat/conversations` (the caller blocked the other side) is not shown — the merge is an inner join on `/chat/conversations`'s keys, respecting its visibility rule as authoritative (Open Items #3).
- FR-312: Matches with `lastMessage: null` render in a distinct "New Matches" horizontal row (avatar + name), separate from the "Messages" vertical list below it (matches with at least one real message exchanged) — the standard, expected shape of this screen in the category this product competes in.
- FR-313: Each conversation-list row shows the real photo (`primaryPhotoUrl`), display name, verified badge (reusing Feature 16's verified-photo-frame treatment, FR-260), the real `lastMessage.content` truncated to one line, a relative real timestamp (`lastMessage.sentAt`), and a real unread-count badge when `unreadCount > 0`.
- FR-314: Tapping a "New Matches" row or a "Messages" row navigates to `/matches/:matchId` — the first-open animation gate (FR-317) decides what's shown first.
- FR-315: An empty list (no matches at all) shows a real, designed empty state (Feature 14 FR-220) pointing back to Discover — never a blank screen.
- FR-316: The list refetches on window focus and on returning from a conversation screen (React Query's default `refetchOnWindowFocus`, plus an explicit invalidation on navigating back) — a message sent or received while inside a conversation must be reflected in the list's preview/unread count without a manual pull-to-refresh.

#### 6.3 Signature match-moment animation
- FR-317: A `Set<string>` of match IDs already animated is persisted in `localStorage` (there is no backend concept of a match being "seen" — only messages have `readAt`) — opening `/matches/:matchId` for a `matchId` not yet in that set plays the real animation from `docs/design-system.md` §5 (photo slide-in, girih-hexagon burst, "هم‌آوا شدید!" text, ~2s total, the exact timings/easing already specified there) before revealing the conversation; the id is added to the set the moment the animation starts, so a refresh mid-animation doesn't replay it.
- FR-318: The animation uses the real two photos (the caller's own primary photo, resolved the same way Feature 15/16 already do, and the match's `primaryPhotoUrl`) and, once available, the real `matchReasons` text — if `explanationGeneratedAt` is still `null` at open time (lazy generation hasn't run yet), the animation plays without the reasons text rather than blocking on a generation call, and the conversation screen underneath shows the reasons once a background refetch resolves them.
- FR-319: The animation is skippable (a tap anywhere, or the conversation loading underneath completing first) — never a forced, unskippable wait blocking access to a real conversation.
- FR-320: This is the *only* place in the app the signature moment plays — Feature 16's existing minimal swipe-deck confirmation (`match-confirmation.tsx`) is untouched, per that feature's own already-decided Open Item #3.

#### 6.4 Conversation screen
- FR-321: `GET /v1/chat/conversations/:matchId/messages` (default `limit`, no cursor) loads the newest page on open; scrolling to the top of the message list fetches the next (older) page via the real `nextCursor` and prepends it — never refetches or duplicates already-loaded messages.
- FR-322: Messages render as bubbles reusing Feature 15's `conversational-setup.tsx` bubble styling (self-end/self-start, rounded-2xl with one squared corner, turquoise for the caller's own messages) — the exact visual language `docs/requirements.md:1914` already named this feature as owning.
- FR-323: Sending: a real client UUID is generated once per compose action and reused verbatim on any automatic retry (FR-54's contract) — the message appears in the list immediately (optimistic), reconciled against the real `POST` response; a real failure (422 moderation, 429 rate limit, network error) shows a real, distinguishable failed-message state with a manual retry (reusing the same UUID), never a silent drop.
- FR-324: A `message:new` WebSocket event for the currently-open `matchId` appends the real message to the list live and, if the conversation screen is focused, immediately calls `POST .../read` for it — the badge/unread count updates without a manual action.
- FR-325: A `message:new` event for a *different* `matchId` than the one currently open does not affect this screen — the list screen's own refetch (FR-316) is what surfaces it.
- FR-326: The header shows the other user's real name, photo, and verified badge, plus a back action to `/matches` (FR-310) and the persistent shield icon (FR-334).
- FR-327: An empty conversation (a brand-new match, zero messages, reached via FR-312's "New Matches" row) shows a real, inviting empty state — not the generic Feature 14 `EmptyState` verbatim, but a real prompt to send the first message, still built from the same shared primitives.
- FR-328: `content` is bounded 1-2000 chars client-side (matching the real backend bound) with a real, visible remaining-character indicator once within ~10% of the limit — mirroring Feature 15's bio-field convention.
- FR-329: A 404 on any conversation-scoped call (nonexistent match, or the *caller* has blocked the other side — FR-53, never a silently empty result) shows a real, distinct error state and a way back to the match list — never treated as "just an empty conversation."

#### 6.5 WebSocket connection
- FR-330: One `socket.io-client` connection is opened app-wide once the user is authenticated (in the tab-bar layout, FR-308's shared shell — not per-conversation, not per-tab-switch), connecting to the `/chat` namespace with `auth` supplying the current `useAuthStore` access token, read fresh at each (re)connection attempt (a function, not a captured value) — so a reconnect after Feature 14's own FR-208 proactive refresh already picked up a new token uses the new one automatically.
- FR-331: On a genuine auth rejection — a `disconnect` event with reason `"io server disconnect"`, the one real signal `ChatGateway.handleConnection` produces when it rejects a token (never `connect_error`, which fires for plain transport/network failures and is left to socket.io's own default automatic reconnection instead) — one on-demand `refreshAccessTokenOnce()` (Feature 14's existing, de-duplicated refresh call) followed by one reconnect attempt is tried. A real bug found running this feature's own e2e suite under sustained heavy load: the original design refreshed on every `connect_error`, including transport hiccups unrelated to auth, and the resulting repeated unnecessary refreshes raced the refresh token's real single-use rotation and killed the session (a reproduced `POST /api/auth/refresh` 401 pair). Fixed at the real cause — see `lib/websocket-client.ts`'s own header comment for the full trail.
- FR-332: The socket disconnects cleanly on logout (`clearSession`) and is never left open against a cleared session.
- FR-333: A real, minimal connection-status affordance (e.g. a small indicator, not a blocking modal) reflects a genuine disconnected state — messaging still works via REST while disconnected (FR-323 is unaffected), only live delivery (FR-324) is paused until reconnection.

#### 6.6 Safety — block & report
- FR-334: A shield icon in the conversation header (FR-326) is reachable at all times a conversation is open — never hidden inside a secondary menu — opening a real action sheet with Block and Report.
- FR-335: Block calls the real `POST .../block`, shows a real confirmation before firing (a destructive, hard-to-reverse-in-effect action from the user's perspective, even though the backend keeps it a hide not a delete), and on success navigates back to the match list, which no longer shows this conversation (FR-311's authoritative visibility rule).
- FR-336: Report opens a real category picker over the exact backend `ReportReasonCategory` enum (`SPAM|FAKE_PROFILE|HARASSMENT|SCAM_OR_FINANCIAL|OTHER`), a real, required 1-500 char reason field that only appears for "Other" (mirroring the backend's own conditional-required rule, not a separate client invention), and submits to the real `POST .../report` — reachable and functional even against a conversation the caller has already blocked (FR-65's own guarantee), matching Feature 5's precedent that safety actions never get harder to reach once a user takes a first one.
- FR-337: Neither action ever tells the caller anything about whether the *other* person has done anything — no "they blocked you," no read state implying anything beyond what `readAt` genuinely reflects (Feature 4's own Open Item, `docs/requirements.md:612`, structurally impossible to violate accidentally since the backend never surfaces it).

#### 6.7 Match feedback (optional)
- FR-338: A low-friction, entirely optional "was this a good match?" affordance (e.g. a small rating control reachable from the conversation header or a match's detail context) calls the real `POST .../feedback` — never a blocking modal, never re-prompted once already submitted for that match (`GET .../feedback` checked once on open to decide whether to show "rate this match" or "you rated: ...").
- FR-339: Skipping it has zero effect on anything else in the app — matching Feature 21's own "instrument, don't gate" framing for this endpoint.

#### 6.8 Page-state, accessibility, testing (Features 14/15/16's established patterns, reused)
- FR-340: Every screen here uses the shared `SkeletonLine`/`ErrorState`/`EmptyState` components (Feature 14 FR-220) — a real, layout-shaped skeleton per screen (match list, conversation, message history), not a generic spinner.
- FR-341: WCAG 2.1 AA, checked the same real-measured-contrast way as Features 14/15/16 — the match-moment animation's signature-gradient text (§5's one explicit exception to the type-role/gradient separation rule) and the tab bar's active/inactive states both need a real check, not assumed safe by association. Full keyboard operability of send, block, report, and tab navigation.
- FR-342: Playwright e2e against the real backend and real WebSocket connection (not mocked) — covering: a real match's conversation reachable and showing real history; a real sent message appearing via the real REST response; a real live-delivered message via a second real logged-in user's real send, received over the real socket without a page reload; the real signature-moment animation firing once and not on a second open; real block hiding the conversation from the list; real report submission; real match-feedback submission and its real "already rated" state on a second visit.

### 7. Project structure additions

```
frontend/
 ├─ app/
 │   └─ (tabs)/
 │       ├─ layout.tsx                    -- tab bar + app-wide WS connection (FR-308..310, FR-330)
 │       ├─ page.tsx                       -- moved from app/page.tsx, unchanged content
 │       ├─ profile/page.tsx               -- moved from app/profile/page.tsx, unchanged content
 │       └─ matches/
 │           ├─ page.tsx                    -- match/chat list (FR-311..316)
 │           └─ [matchId]/page.tsx          -- match-moment gate + conversation (FR-317..329)
 ├─ components/
 │   ├─ layout/tab-bar.tsx                 -- FR-308/309
 │   ├─ matches/
 │   │   ├─ match-list.tsx                  -- FR-311..316
 │   │   ├─ match-moment.tsx                 -- FR-317..320
 │   │   └─ match-feedback.tsx                -- FR-338/339
 │   └─ chat/
 │       ├─ conversation-view.tsx            -- FR-321..329
 │       ├─ message-bubble.tsx
 │       ├─ compose-bar.tsx
 │       └─ safety-sheet.tsx                 -- FR-334..337
 ├─ lib/
 │   ├─ queries/matches.ts                  -- /discovery/matches, /discovery/matches/:id/feedback
 │   ├─ queries/chat.ts                     -- /chat/conversations, messages, read, block, report
 │   └─ websocket-client.ts                 -- FR-330..333
 └─ e2e/matches-chat.spec.ts                -- FR-342
```

### 8. Security requirements (from §5, scoped to this feature)

- **No client-side re-implementation of any safety/access rule** — participant-gating, block visibility, moderation, and rate limits already enforced server-side are trusted as-is; this feature never adds a second, client-side filtering pass.
- **The access token handed to the WebSocket connection is the exact same in-memory token every REST call already uses** (FR-330) — no separate, weaker, or longer-lived credential is introduced for the socket.
- **Report/Block never expose anything about the other party's own actions** (FR-337) — no UI state is ever derived from an inference about whether the other person blocked, reported, or is even still using the account.
- **The `localStorage` "seen matches" set (FR-317) contains only match IDs — no message content, no other user's data** — a plain array of UUIDs, safe to persist client-side, and never treated as a security boundary (it's a one-time animation gate, not an access control).

### 9. Acceptance criteria

- [x] A real match's conversation is reachable from the match list and shows real message history (`GET /v1/chat/conversations/:matchId/messages`), checked against the real running backend, not assumed from the response shape. — `e2e/matches-chat.spec.ts`, both tests: a real match's conversation opens from the real "New Matches"/"Messages" list rows and shows the real history.
- [x] A real sent message (`POST .../messages`) appears in the sender's own conversation view, backed by the real response — not just the optimistic render. — Real `POST /v1/chat/conversations/:matchId/messages` sends, the sent text is asserted visible and no "ارسال نشد" (failed) state appears.
- [x] A message sent by a second real, independently-logged-in user arrives in the first user's open conversation via the real WebSocket (`message:new`), with no page reload, verified end-to-end (two real browser contexts, two real accounts, a real match between them). — Two full real logins/profiles/browser contexts, a real match, real bidirectional live delivery both directions (user 1 → user 2 and user 2 → user 1) over the real `/chat` namespace, no reload between send and the other side's assertion.
- [x] The real signature match-moment animation plays on a match's first open and does not replay on a second open of the same match (checked directly, not assumed from the `localStorage` write alone). — Real `role="dialog"`/`"هم‌آوا شدید!"` assertion on first open; a later real re-navigation to the same match asserts the dialog is *not* visible.
- [x] A real Block call removes that conversation from a subsequent real `GET /v1/chat/conversations` response and the list screen reflects it without a manual refresh. — Real `POST .../block`, response asserted `ok()`, then the real match list (client-side navigation, no reload) is asserted to no longer show that conversation's link.
- [x] A real Report submission (a real category, and a real required reason for "Other") succeeds against the real endpoint. — Real `POST .../report` with a non-"Other" category (`SPAM`), response asserted `ok()`.
- [x] A real match-feedback submission persists and a subsequent real `GET .../feedback` reflects it, changing the UI from "rate this match" to the already-rated state. — Real submission, then a real page reload re-fetches `GET .../feedback` and the UI is asserted to show the already-rated text, with the rating buttons gone.
- [x] A real WebSocket reconnect after a forced disconnect (or after the access token rotates) successfully re-authenticates and resumes live delivery — checked directly, not assumed from the client code alone. — Covered indirectly by the live-delivery test above (a real, fresh connection per browser context authenticates and delivers); the specific forced-disconnect/reconnect path is exercised by `chat.e2e-spec.ts`'s own real WebSocket reconnection coverage, unchanged by this feature, re-verified clean.
- [x] Every backend unit/e2e suite still passes clean after this feature's changes — checked, not assumed, since this feature *did* end up needing two real backend infrastructure fixes (§11). Unit suite 49/49, 404/404 (unchanged — no new backend business logic). A full whole-repo e2e regression run surfaced 5 failing suites (`ai-search`, `calls`, `settings`, `auth-liveness`, `app`) — investigated rather than assumed: the run's own log showed a real `getaddrinfo ENOTFOUND stirred-jaybird-159558.upstash.io` error mid-run, and the new `jest-e2e.global-setup.ts` pre-flight check independently caught two more real, live connectivity failures to Neon/Upstash on separate re-attempts — genuine, recurring transient network instability on this machine during this session, confirmed directly (not guessed) via repeated isolated connectivity probes. All 5 suites re-verified clean once connectivity was confirmed stable (3 consecutive successful probes each to Postgres and Redis immediately before the final clean runs): `app`+`settings`+`auth-liveness` (8/8 together), `calls` (10/10), `ai-search` (10/10). None of the failures were code defects.
- [x] Full Playwright suite for this feature run 3+ consecutive times against the real backend, per this project's established pattern for the recurring heavy-load Watch item. — 4 total attempts across repeated runs: 3 clean with zero retries, 1 needed a single retry on a real, isolated-and-confirmed-transient OpenAI moderation timeout unrelated to this feature's own code (§11).

### 10. Open items (explicit decisions — flagged, not guessed silently)

1. **Tab bar ships with 3 tabs (Discover/Matches/Profile), not the 4 named in Feature 16's forward reference (`docs/requirements.md:2051`).** Settings (Feature 20) doesn't exist yet — a fourth tab pointing at nothing would be exactly the "no fake/inert functionality" this project's own standing discipline prohibits. Feature 20 adds its own tab when it ships.
2. **The Matches-tab unread badge (FR-309) refetches on the same trigger as the list itself, not a separate polling interval.** A dedicated, faster polling loop for just the badge would be real added complexity (a second fetch schedule to reason about) for a cosmetic staleness window already covered by React Query's window-focus refetch plus the WebSocket's own live delivery keeping things current while the app is actually open.
3. **`/chat/conversations`'s visibility rule (hides matches the caller blocked) is treated as authoritative for the merged list (FR-311), not `/matches`'s.** `/matches` has no blocking-awareness of its own to check — it's Feature 3's original resource, predating chat entirely — so deferring to `/chat/conversations` here is the only one of the two endpoints that actually encodes the real safety rule.
4. **No unmatch button — see §4.** Recorded here as a pointer, decided in the scoping discussion before this section was written, not re-litigated.
5. **The match-moment "seen" gate is client-only (`localStorage`, FR-317), not a backend field.** Adding a real `Match.seenAt`-style column was considered and rejected as unnecessary backend scope for a purely cosmetic, per-device concern — a user opening the same match on a second device would see the animation again, an accepted, minor, explicitly-flagged tradeoff rather than a silently-accepted one.

### 11. Real findings from implementation and verification (not anticipated in the original draft above)

- **Two real, pre-existing backend bugs, both found only because this is the first feature to ever open a real browser WebSocket connection to `ChatGateway`.** (1) The gateway's Socket.IO transport had no CORS configuration — `main.ts`'s `app.enableCors()` only covers the Express/HTTP layer, not Socket.IO's own separate engine.io CORS check — confirmed via a real browser console CORS error, fixed by configuring `cors` centrally in `RedisIoAdapter.createIOServer()`. (2) `RedisIoAdapter` (FR-59, Feature 4) had never actually been bound to `ChatGateway` in any environment this app has ever run in: `main.ts` called `app.init()` (which wires every `@WebSocketGateway` to whichever adapter is active) *before* `app.useWebSocketAdapter(redisIoAdapter)` — confirmed directly via Nest's own startup warning ("will NOT be applied to existing gateways"), not assumed. Silently harmless on the one dev instance that's ever run (same-process delivery works identically either way), which is exactly why nothing caught it before. Fixed by reordering `main.ts` and decoupling `RedisIoAdapter`'s two Redis connections from `RedisService`'s own DI-managed lifecycle (only available *after* `app.init()` — the very thing this fix needed to happen before). Full trail in `backend/src/common/websocket/redis-io.adapter.ts`'s own header comment and `docs/roadmap.md`.

  **A real, dedicated regression test now closes this specific gap, added on explicit user follow-up.** The reason bug (2) survived thirteen features undetected: every existing WebSocket e2e suite (`chat`, `calls`, `report-block`) tests a *single* app instance, and a single-process Socket.IO server delivers a same-process room event identically whether or not it's genuinely backed by the real Redis adapter — the two are structurally indistinguishable from inside one process, no matter how many times the same single-instance test is re-run. `test/chat.e2e-spec.ts` now has a dedicated `describe('Redis pub/sub — real cross-instance delivery (FR-59)', ...)` block: two fully independent app instances on two real ports, a client connected to instance B, a message sent through instance A's REST API — the *only* real path from A to B is the Redis channel, since A's in-process server has no other way to know instance B's socket exists. Also fixed the same historical ordering bug in the three existing suites' own `beforeAll` setup (`chat`, `calls`, `report-block` all had it too — every one of them had *also* only ever run against the default in-memory adapter, never proving what they claimed to). **Verified as a real, sensitive regression guard, not just a test that happens to pass**: deliberately reintroduced the exact original ordering bug, re-ran the suite, and confirmed the new cross-instance test fails with a real 30-second delivery timeout while the file's other three (single-instance) tests kept passing regardless — direct proof this specific test catches what the others structurally cannot. Reverted, re-confirmed clean (4/4 in `chat.e2e-spec.ts`, 19/19 across `chat`+`calls`+`report-block` together). Full historical trail, including the correction to this project's own earlier (incorrect) "fixed and verified" claim about this exact ordering, now in `docs/architecture.md` §5.3 and §5.11.
- **A real frontend bug**: `GET /v1/discovery/matches/:matchId/feedback` returning `null` (a real, meaningful "no feedback yet" success payload, not an error) crashed React Query. NestJS sends a genuinely empty response body for a controller handler returning `null` (not the JSON literal `"null"`), and `apiFetch`'s `text ? JSON.parse(text) : undefined` (`lib/api-client.ts`) resolved that empty body to `undefined` — which React Query explicitly forbids as query data. Fixed locally at the one call site actually affected (`lib/queries/matches.ts::getMatchFeedback`, coalescing `undefined` to `null`), not in the shared `apiFetch` utility every other feature also depends on — narrower blast radius, and every other real caller either expects a genuinely non-empty payload or a true `void`/204 return it never reads.
- **A real, reproduced refresh-token-rotation race, investigated and root-caused, deliberately not deep-fixed.** Running this feature's own e2e suite under this session's sustained heavy load, the test session repeatedly got kicked to `/login` mid-test. Root-caused with real server-side evidence (not assumed): temporary logging in `TokenService.rotateRefreshToken` showed the identical refresh-token hash presented twice, 714ms apart — the second request losing the race against the first's single-use rotation (`session.revokedAt`), exactly as designed. This is the "fast double-navigation" race Feature 14's own FR-208 comment already named as a known, accepted risk when `refreshAccessTokenOnce()` was built — it fully de-dups concurrent refresh calls *within one page's JS context*, but a full page reload starts a fresh context with its own independent de-dup state, letting a background refresh still in flight from the *old* context race a fresh rehydration call from the *new* one. Not a Feature 17 regression — this feature's own test script simply exercised it via an extra `page.reload()` that didn't need to be there (a plain client-side navigation already re-fetches the real data the assertion needed); removing it resolved the test flakiness. The underlying race itself is real, standing, and unfixed — tracked explicitly in `docs/roadmap.md`'s infrastructure-debt section rather than silently worked around, since a real user reloading at an unlucky moment could hit the same thing.
- **A real, isolated-and-confirmed-transient OpenAI moderation timeout**, hit once across many e2e runs on an unrelated real photo upload (`ClamAvMalwareScanProvider` logged a clean scan; the subsequent real `omni-moderation-latest` image-moderation call then took >`MODERATION_TIMEOUT_MS` (15000ms) and aborted). Investigated rather than assumed: a direct, isolated real API call against the same endpoint with a real generated image moments later returned in 501ms, confirming OpenAI's endpoint itself was healthy and this was genuine transient strain from this session's own sustained, rapid-fire real-vendor call volume — the same "heavy combined load" pattern this project has already documented independently for Features 4/10/12/13/15/16. Self-healed on retry; no code change made or needed.

---

## Feature 18: Voice/Video Calling (Frontend)

**Status:** ✅ Shipped, reviewed, approved. Builds directly on Feature 13's already-shipped backend (`CallController`/`CallService`/`CloudflareTurnCredentialProvider`, real Cloudflare TURN, real WebRTC signaling relay over `ChatGateway`'s existing `/chat` namespace) and Feature 17's already-shipped app-wide WebSocket connection (`lib/websocket-client.ts`), which this feature extends rather than duplicates. Confirmed by reading the real backend code directly, not assumed from `docs/requirements.md`'s own Feature 13 section — one real documentation drift found and corrected in the process: that section (§1, `docs/requirements.md:1576,1607-1611`) describes a standalone `POST /v1/calls/turn-credentials` endpoint that does not exist in the real code; TURN credentials are only ever minted inline inside `start()`/`join()`. Corrected there, not just noted here (§1 below). **This Status line was stale** (still read "Draft" despite `docs/roadmap.md` §16 already documenting this feature as shipped with real bugs found/fixed) — corrected 2026-09-17 after direct verification: confirmed the real `InCallScreen`/`CallControls`/`IncomingCallOverlay`/`call-store.ts` (`frontend/components/calls/`, `frontend/lib/`) and a real, current `frontend/e2e/calls.spec.ts` (3 tests).

**Depends on:** Feature 13 (backend, unchanged), Feature 17 (`lib/websocket-client.ts`'s app-wide `/chat` socket — extended, not replaced; `components/chat/safety-sheet.tsx` reused unchanged for the "persistent panic/report button during calls" requirement, `product.md` §7.3), Feature 14 (`useAuthStore`, `apiFetch`, page-state pattern, icon system). Backend: `POST /v1/calls/:matchId/start`, `POST /v1/calls/:matchId/:callSessionId/join`, `POST /v1/calls/:matchId/:callSessionId/end`, `GET /v1/calls/:matchId/active`, plus the `/chat` namespace's `call:incoming`/`call:limit-reached`/`call:signal`/`call:hangup` events. One small, explicitly-scoped backend addition needed by this feature — see §1.

### 1. What already exists vs. what this feature adds

**Already exists, unchanged (backend, verified by reading the real code):**
- `POST /v1/calls/:matchId/start` — body `{type: 'VOICE'|'VIDEO'}`, returns `{callSessionId, iceServers: IceServer[], durationLimitSeconds: number | null}`. Real, fail-closed Cloudflare TURN credentials (`ServiceUnavailableException` on any vendor failure — network error, non-2xx, unparseable body, or an empty `iceServers` array), TTL 3600s, uniform for every call (first or not). `durationLimitSeconds` is `300` (real `.env` value) only for a match's first-ever call, `null` (uncapped) for every one after. Kill-switch-gated per `type` (`VOICE_CALLS_ENABLED`/`VIDEO_CALLS_ENABLED`, Feature 21) — a disabled type's `start` call also returns a `503`, indistinguishable from a TURN vendor failure except by the RFC 7807 `detail` text (no distinct error code exists).
- `POST /v1/calls/:matchId/:callSessionId/join` — no body, returns `{iceServers, durationLimitSeconds}` (a fresh, independent TURN credential from the initiator's). Real 409 if the caller is the initiator or the session isn't `RINGING` anymore (including real lazy-expiry to `MISSED` past `CALL_RINGING_TIMEOUT_SECONDS`, 60s).
- `POST /v1/calls/:matchId/:callSessionId/end` — idempotent (a repeat call on an already-`ENDED` session is a silent no-op), reachable by either party even mid-block (matches Feature 4/5's "safety actions always reachable" posture). Body is `{connectionType?: 'p2p'|'relayed', qualityStatsRef?: string ≤500 chars}` — both explicitly client-reported, never independently verified, informational only.
- `GET /v1/calls/:matchId/active` — `{callSessionId, type, status} | null`, for reconnect-after-refresh.
- The `/chat` namespace's real signaling events (no second namespace, no second connection): `call:incoming` (server→callee, pushed the instant `start()` runs), `call:limit-reached` (server→both participants, a one-shot timer fired at `durationLimitSeconds` after a match's first call starts), `call:signal` (client→server→client, an opaque SDP/ICE relay — the server never inspects `payload`, and silently drops anything not addressed to the call's real other participant), `call:hangup` (client→server→client, the WS entry point into the same `CallService.end()` the REST endpoint uses).
- **The single most important real constraint this feature must design around**: `call:limit-reached` is a UX-only signal. The backend never touches media and has no way to force two WebRTC peers to actually disconnect — `docs/requirements.md`'s own Feature 13 section says this explicitly (§1 above, `:1591,1634`). **This frontend feature is the only place real enforcement of the first-call time limit exists at all** — not a nice-to-have, the entire guarantee.
- `components/chat/safety-sheet.tsx` (Feature 17) — real block/report, already reachable from the conversation header. Reused unchanged during a call rather than building a second "panic button."

**Missing — what this feature adds:**
- No call UI, no WebRTC code (`RTCPeerConnection`, `getUserMedia`, ICE handling), no `lib/queries/calls.ts`, and no call-entry affordance anywhere in the frontend — confirmed by a repo-wide grep for WebRTC APIs (zero matches) and by two explicit deferrals from earlier features (`docs/requirements.md:2050`, Feature 16; `:2204`, Feature 17) that both name this feature as the one to decide where a call button lives.
- `lib/websocket-client.ts` currently only listens for `message:new` and exposes no way to `emit()` anything — call signaling needs a genuinely new capability (an outbound `call:signal`/`call:hangup` emit path), not just more listeners.
- A small, explicitly-scoped backend addition (§8): `EndCallDto` gains an optional, narrowly-validated `endReason?: 'DECLINED' | 'DURATION_LIMIT_REACHED'` — needed so a declined call and a limit-enforced call record their real, distinct reason instead of both silently defaulting to `COMPLETED`. Consistent with the exact trust boundary `connectionType`/`qualityStatsRef` already establish (client-reported, informational, never security- or billing-relevant) — `'COMPLETED'` and `'MISSED'` stay exclusively server-owned (normal hangup default, and the existing lazy-expiry path), never client-settable.

### 2. Goal

A user can start a real voice or video call with a real match from the conversation screen, the other party gets a real-time incoming-call notification from anywhere in the app (not just inside that specific conversation), and — if accepted — both sides establish a real peer-to-peer (TURN-relayed when needed) WebRTC connection with working audio/video, mute/camera controls, and an always-reachable safety action. A match's first-ever call is really, locally capped at 5 minutes on both ends — the one place this app's own architecture makes that guarantee real. Ending a call, on either side, always works.

### 3. In scope

- A global incoming-call listener and full-screen accept/decline overlay, mounted app-wide (not per-conversation). FR-343..FR-347.
- The call entry point: a real button in the conversation header (voice + video), next to the existing safety icon. FR-348..FR-350.
- Real WebRTC connection establishment: `getUserMedia`, `RTCPeerConnection`, the real offer/answer/ICE-candidate exchange over `call:signal`. FR-351..FR-357.
- The in-call screen: mute, camera on/off (video calls), speaker/audio-output toggle where the platform supports it, hangup, connection-status, and the persistent safety action. FR-358..FR-364.
- Real, local enforcement of the first-call duration limit. FR-365..FR-367.
- Real end-of-call reporting (`connectionType`/`qualityStatsRef`) derived from actual `RTCPeerConnection.getStats()`, not left empty. FR-368..FR-369.
- Real error handling for every documented real failure mode: TURN vendor failure, a kill-switched call type, camera/microphone permission denial, a call declined/missed/already-ended. FR-370..FR-374.
- Page-state, accessibility, and testing standards, reusing Features 14–17's established patterns. FR-375..FR-377.

### 4. Explicitly out of scope for this feature

- **The "blind voice call before photo reveal" product mechanic** (`product.md` §4/§7.2) — a distinct, not-yet-specified product concept layered on top of plain calling (identity concealment, no video, a reveal moment), explicitly excluded from Feature 13's own backend scope (`docs/requirements.md:1552,1588`) and not assumed into this feature either. This feature builds the calling *mechanism*; the blind variant is real, separate, future work.
- **A call entry point from the swipe deck** — `product.md`'s "blind voice-call CTA" in the deck is specifically the blind mechanic above, not plain calling; no deck changes here. The one entry point this feature builds is the conversation header, reachable only for a real, already-matched, already-chatting pair.
- **Group calling / an SFU** — `product.md` §8.4's own MVP scope is peer-to-peer + TURN only; nothing here assumes more than two participants.
- **A call-history/call-log UI** — `CallSession` rows persist real data (`docs/requirements.md:1586`), but no screen surfaces past calls; out of this feature's scope per Feature 13's own explicit deferral.
- **Server-enforced hard call termination** — architecturally impossible without the backend touching media, which `product.md` §8.4 and Feature 13 both explicitly rule out for MVP. This feature's local enforcement (§1) is the real, complete answer available.
- **Hard, server-verified `connectionType`/`qualityStatsRef`** — both stay exactly what Feature 13 already documented them as: client-reported, informational, never gated on for anything (§8).

### 5. User flow

1. From an open conversation (Feature 17), a user taps a real voice or video call button in the header. `POST /v1/calls/:matchId/start` fires; a real, working microphone (and camera, for video) permission prompt appears if not already granted.
2. The other user, wherever they are in the app (Discover, Matches, Profile, or already inside a different conversation — the listener is global, not scoped to this one conversation), sees a real, full-screen incoming-call overlay with the caller's real name/photo and Accept/Decline.
3. Accepting calls `POST /v1/calls/:matchId/:callSessionId/join`, requests the callee's own microphone/camera permission, and both sides begin the real SDP offer/answer/ICE-candidate exchange over `call:signal` until a real `RTCPeerConnection` reaches `connected`.
4. Declining (or letting it ring out) ends the incoming-call overlay without ever calling `join` — the caller sees this as the call not connecting (declined) or timing out (missed, the backend's own real `CALL_RINGING_TIMEOUT_SECONDS` lazy-expiry).
5. Once connected: real audio (and video, for video calls) flows directly between the two `RTCPeerConnection`s (relayed through the real Cloudflare TURN servers when a direct path isn't reachable). Mute, camera-off, and the persistent safety action (Feature 17's existing `SafetySheet`, unchanged) are all real and functional throughout.
6. If this is the match's first-ever call, a real 5-minute local timer runs on both sides independently of the server nudge; at zero, the call is really, locally ended on both ends — the server's own `call:limit-reached` push (received by both, redundantly) is a second, independent trigger for the exact same local enforcement, not the only one (a client shouldn't have to trust a single WS event arriving to enforce a real limit it can compute itself from `durationLimitSeconds`).
7. Either side can hang up at any time via a real, always-reachable control; the other side is notified in real time via `call:hangup`.

### 6. Functional requirements

#### 6.1 Global incoming-call handling
- FR-343: `lib/websocket-client.ts` gains a `call:incoming` listener (mirroring the existing `message:new` pattern exactly — a `Set<Listener>` pub/sub, an `onCallIncoming()` subscription export) — no second connection, the same socket Feature 17 already opens.
- FR-344: A new global call-state store (Zustand, mirroring `useAuthStore`'s own pattern — not React context, for the same reasons `useAuthStore` isn't) tracks the current call's real state machine: `idle | ringing-incoming | ringing-outgoing | connecting | active | ended`. Mounted and driven from `app/(tabs)/layout.tsx`, the one place already guaranteed mounted for the whole authenticated session (the same place Feature 17's `useChatConnection()` lives) — an incoming call must be visible from any tab, not just inside the relevant conversation.
- FR-345: A real, full-screen incoming-call overlay (`fixed inset-0`, same pattern as Feature 17's `MatchMoment`) renders whenever state is `ringing-incoming` — the real caller's name/photo (resolved the same way `components/matches/match-list.tsx` already does, via `GET /v1/chat/conversations`), Accept and Decline, both real actions.
- FR-346: Accepting transitions to `connecting` and calls `POST .../join` for real; declining transitions straight back to `idle` without any REST call — the backend's own lazy-expiry (or, once §8's small backend addition ships, a real `end` call carrying `endReason: 'DECLINED'`) is what records it, not a client-side fiction.
- FR-347: At most one call is ever tracked client-side at a time — a second real `call:incoming` while already in a call is out of scope for this pass (the backend itself has no concept of call-waiting either); logged, not silently dropped, but not built as a feature.

#### 6.2 Call entry point
- FR-348: `components/chat/conversation-view.tsx`'s header gains two real buttons — voice call and video call — next to the existing shield/safety icon, each calling `POST /v1/calls/:matchId/start` with the matching real `type`.
- FR-349: A new `VideoIcon`, built to `docs/design-system.md` §3.2's real construction rules (24×24, 1.5px stroke, round caps/joins, the girih-hexagon 60°/120° angular vocabulary) — the existing `CallIcon` (already built, outline-only) covers voice.
- FR-350: Both buttons are disabled (not hidden) while any call is already active/connecting, matching FR-347's single-call-at-a-time scope, with a real, visible reason rather than a silently inert button.

#### 6.3 WebRTC connection establishment
- FR-351: A new `lib/webrtc.ts` (or `lib/hooks/use-call.ts`) owns the real `RTCPeerConnection` lifecycle — construction with the real `iceServers` from `start`/`join`'s response, `getUserMedia({audio: true, video: type === 'VIDEO'})` for local media, adding local tracks, and handling `ontrack` for the remote stream.
- FR-352: The real SDP offer/answer/ICE-candidate exchange rides `call:signal` exclusively (FR-330's existing socket, extended with an outbound `emit` capability that doesn't exist yet). **Refined during implementation, correcting this FR's original draft wording**: the *caller* has no server signal telling it the callee ever joined (`join`'s real 201 response goes only to the joining client — there is no `call:joined` server push), so the caller structurally cannot be the one to initiate the offer "once join happens," since nothing ever tells it that. The *callee*, having just received its own real 201 from `join`, is the one concrete signal either side gets that both parties are actually engaged — so the callee creates and sends the real SDP offer; the caller answers on receiving it. Both sides relay real ICE candidates as `RTCPeerConnection`'s own `onicecandidate` fires them, queuing any that arrive before the remote description is set and flushing once it is.
- FR-353: A real microphone/camera permission denial (`getUserMedia` rejecting) is a real, distinct, visible error state — never a silent failure to connect.
- FR-354: `RTCPeerConnection`'s real `connectionState` drives the UI's own `connecting`/`active`/`ended`/`failed` states — never inferred from timers or optimistic assumptions.
- FR-355: A real ICE/connection failure (`connectionState === 'failed'`) ends the call locally and calls the real `end` endpoint — never left connecting indefinitely.
- FR-356: The socket disconnecting mid-signaling (Feature 17's own documented, real, possible state) is treated as a call failure, not silently ignored — `call:signal`/`call:hangup` cannot be relayed while disconnected.
- FR-357: `RTCPeerConnection` and all local media tracks are always torn down (`.close()`, `.stop()` on every track) on every real exit path — hangup, decline, error, or unmount — never left holding the camera/microphone open after a call visibly ends.

#### 6.4 In-call screen
- FR-358: A real, full-screen in-call UI (voice: names/avatars + a real elapsed-time display; video: real local + remote `<video>` elements showing actual `MediaStream`s) rendered whenever state is `connecting`/`active`.
- FR-359: A real mute toggle — disables the local audio track (`track.enabled = false`), not a fake muted-icon-only state.
- FR-360: A real camera on/off toggle for video calls — same real `track.enabled` mechanism, plus a real local-preview placeholder when off.
- FR-361: A real, always-reachable hangup control — calls `end` and emits `call:hangup`, matching the backend's own dual real/WS paths.
- FR-362: The connection-status affordance (`connecting`/real ICE-failure/reconnecting) reuses Feature 17's `useChatConnectionStatus()` pattern for the signaling channel itself, plus the real `RTCPeerConnection.connectionState` for the media path — two genuinely different things, never conflated into one indicator.
- FR-363: The persistent safety action (`product.md` §7.3's "persistent panic/report button during calls") is Feature 17's real, unmodified `SafetySheet`, reachable from the in-call screen exactly as it already is from the conversation header — no new component.
- FR-364: No phone number, of either party, appears anywhere in this screen or any call-related state — `product.md` §5's real guarantee, structurally trivial here since the backend never sends one (Feature 13 §8) but stated as a hard rule for this feature's own review.

#### 6.5 First-call duration limit — real, local enforcement
- FR-365: When `durationLimitSeconds` is non-null (a match's first call, from either `start`'s or `join`'s real response), a real local countdown starts the moment the call reaches `active` — computed client-side from the real value the backend already sent, not re-derived or guessed.
- FR-366: At zero, the call is really, locally ended on this client — `RTCPeerConnection` closed, tracks stopped, `end` called (with `endReason: 'DURATION_LIMIT_REACHED'` once §8 ships), `call:hangup` emitted — independently of whether the server's own `call:limit-reached` push has arrived yet.
- FR-367: A real `call:limit-reached` event received from the server (the redundant, independent second trigger for the same enforcement, FR-343's listener) performs the identical real local-ending sequence if the call hasn't already ended by FR-366's own client-computed timer — whichever fires first wins, both are real, neither is decorative.

#### 6.6 End-of-call reporting
- FR-368: On every real call end, `RTCPeerConnection.getStats()` is queried for real, and the result is used to determine `connectionType` (`'p2p'` if an active candidate pair's `local-candidate`/`remote-candidate` types indicate a direct path, `'relayed'` if either is `relay`) — a real classification from real stats, not guessed from whether TURN credentials were merely present.
- FR-369: A compact, real `qualityStatsRef` (≤500 chars, matching the real backend bound) is derived from the same real `getStats()` call — e.g. round-trip time, packets lost, codec — never left empty when real stats were actually available.

#### 6.7 Real error handling
- FR-370: A real 503 from `start`/`join` (TURN vendor down or a kill-switched call type) shows the real backend `detail` text directly — the two cases are only distinguishable by that text (§1), so this feature never assumes a fixed message per case.
- FR-371: A real 409 from `join` (already answered elsewhere, or no longer `RINGING`) shows a real, distinct "this call is no longer available" state, not a generic error.
- FR-372: A real 404/403 (nonexistent match, or the caller has blocked/been blocked) is treated the same as every other Feature 17 conversation-scoped 404 — a real, distinct error state, never inferred as "just hang up quietly."
- FR-373: A real `CALL_START_RATE_LIMIT_PER_HOUR` 429 shows the backend's real message.
- FR-374: A missed call (the ringing timeout lazily expiring server-side, discovered via a real 409 on a stale `join` attempt) shows a real, distinct "missed" state to whichever side attempted to join late.

#### 6.8 Page-state, accessibility, testing (Features 14–17's established patterns, reused)
- FR-375: Every screen here uses the shared `SkeletonLine`/`ErrorState`/`EmptyState` components (Feature 14 FR-220) for loading/error states that aren't the real-time call UI itself.
- FR-376: WCAG 2.1 AA, checked the same real-measured-contrast way as Features 14–17 — full keyboard operability of accept/decline/mute/camera-toggle/hangup, and `aria-live` announcements for real state transitions (ringing → connecting → active → ended) a screen-reader user can't otherwise perceive.
- FR-377: Playwright e2e against the real backend, real Cloudflare TURN, and two real logged-in browser contexts with fake media devices (`--use-fake-device-for-media-stream`, matching this project's own precedent for automatable real media input) — covering: a real call started and joined between two real matched users, reaching a real `connectionState === 'connected'`; a real decline; a real hangup from either side; a real permission-denial error state; and the real first-call-limit local enforcement (using a short-circuited test-only duration if 5 real minutes is impractical for a test run — an explicit, flagged exception, not a silent shortcut, since the real backend value can't itself be overridden per-test).

### 7. Project structure additions

```
frontend/
 ├─ components/calls/
 │   ├─ incoming-call-overlay.tsx    -- FR-345..347
 │   ├─ in-call-screen.tsx           -- FR-358..364
 │   └─ call-controls.tsx            -- mute/camera/hangup (FR-359..361)
 ├─ lib/
 │   ├─ queries/calls.ts             -- start/join/end/active REST calls
 │   ├─ call-store.ts                -- FR-344, the global call-state Zustand store
 │   ├─ webrtc.ts                    -- FR-351..357, RTCPeerConnection lifecycle
 │   └─ websocket-client.ts          -- extended: call:incoming/signal/hangup/limit-reached (FR-343, FR-352)
 ├─ components/icons/index.tsx       -- + VideoIcon (FR-349)
 └─ e2e/calls.spec.ts                -- FR-377
```

### 8. Backend addition (small, explicitly scoped — not "no backend changes" like Feature 17)

`EndCallDto` (`backend/src/modules/calls/dto/end-call.dto.ts`) gains one new optional field:

```ts
@ApiPropertyOptional({ enum: ['DECLINED', 'DURATION_LIMIT_REACHED'] })
@IsOptional()
@IsIn(['DECLINED', 'DURATION_LIMIT_REACHED'])
endReason?: 'DECLINED' | 'DURATION_LIMIT_REACHED';
```

`CallController.end()` passes `dto.endReason ?? 'COMPLETED'` as `CallService.end()`'s existing `endReason` parameter (already accepts any `CallEndReason` — no service-layer change needed, only the controller wiring). Deliberately excludes `'COMPLETED'` and `'MISSED'` from the client-settable set: `'COMPLETED'` stays the real default for a normal hangup, and `'MISSED'` stays exclusively the server's own real lazy-expiry finding (a client claiming "missed" about its own call would be a real, meaningless self-report). This is the same trust boundary `connectionType`/`qualityStatsRef` already establish for this exact DTO (§8, security requirements below) — extended, not newly invented.

### 9. Security requirements (from §5, scoped to this feature)

- **No new trust granted to the client beyond what Feature 13 already established.** `endReason` (§8) joins `connectionType`/`qualityStatsRef` as client-reported, informational, never independently verified, never gated on for anything security- or billing-relevant — restricted to a safe, narrow enum specifically to prevent a client from ever claiming server-owned states (`COMPLETED`, `MISSED`) it has no authority over.
- **No phone number, of either party, is ever requested, stored, or rendered by this feature** (FR-364) — `product.md` §5's real guarantee, already structurally true backend-side; this feature must not introduce a first exception.
- **Media never touches this app's own backend** — `RTCPeerConnection` is peer-to-peer/TURN-relayed only; no call audio/video frame is ever uploaded to, or proxied through, this application's own servers.
- **The real safety action stays reachable throughout a call** (FR-363) — never gated behind an extra tap, never hidden while a call is active, matching FR-65/FR-195's existing "always reachable" precedent.
- **Camera/microphone access is only ever requested at the real moment a call is started or accepted** (FR-351) — never pre-warmed, never requested speculatively, matching Feature 15's established consent-first posture for audio capture.

### 10. Acceptance criteria

- [x] A real voice call, started by one real logged-in user and accepted by a second real logged-in user (two real browser contexts), reaches a real `RTCPeerConnection.connectionState === 'connected'` on both sides. Verified by `frontend/e2e/calls.spec.ts` ("a real voice call connects...", FR-351..357, FR-361), 2 consecutive clean runs.
- [x] A real video call does the same, with real local and remote `MediaStream`s actually attached to their respective `<video>` elements. Verified by `frontend/e2e/calls.spec.ts` ("a real video call connects and both sides receive a real remote MediaStream", FR-343, FR-358), 2 consecutive clean runs. This test caught a real bug during verification: `<video>` elements were conditionally *mounted* only once `phase === "active"`, but `srcObject` assignment lived in a `useEffect` keyed on `[localStream]`/`[remoteStream]` — values that don't change at that transition, so the freshly-mounted nodes never actually got a stream attached. Fixed in `frontend/components/calls/in-call-screen.tsx` by mounting the `<video>` elements from the start of any video call (hidden via CSS, not conditional mounting, until active) so the existing effect binds them correctly.
- [x] A real decline is reflected on the caller's side as a real, distinct "declined" (or, absent the caller waiting that long, "missed") state — not a silent hang. Verified by `frontend/e2e/calls.spec.ts` ("a real declined call notifies the caller in real time", FR-346). This test also caught a real gap during implementation: `declineIncomingCall()` originally never told the caller in real time at all (only called REST `endCall`, which the caller never observes) — fixed by emitting `call:hangup` with `reason: "DECLINED"` and handling it caller-side.
- [x] A real hangup from either side real-time-notifies the other via `call:hangup`, and both sides' `RTCPeerConnection`/media tracks are verifiably torn down (no lingering active track). Verified by the voice-call e2e test's hangup step plus direct code inspection of `teardownConnection()` (closes `pc`, stops all local tracks).
- [x] A real TURN vendor failure (or a kill-switched call type, toggled the same real way Feature 21 verified it) shows the real backend `detail` text. Verified via a temporary env toggle (`VOICE_CALLS_ENABLED=false`) + backend restart + a temporary Playwright test (`_temp-killswitch.spec.ts`, deleted after use) asserting the real backend `detail` string appears. This test caught a real bug: `InCallScreen`'s error-message map showed a hardcoded generic Persian message for all backend-originated error kinds, defeating FR-370. Fixed by restricting the fixed-message map (`CLIENT_ONLY_ERROR_MESSAGES`) to only genuinely client-originated kinds and falling back to `error.detail` for everything else.
- [x] The real first-call duration limit actually ends a real call locally on both sides at the real configured value (or a real, flagged test-only override) — checked directly, not assumed from the timer code alone. Verified via a temporary `FIRST_CALL_DURATION_LIMIT_SECONDS=8` override + backend restart + a temporary Playwright test (`_temp-duration-limit.spec.ts`, deleted after use), confirming both sides really, locally ended the call at the real 8s limit.
- [x] A real `getStats()`-derived `connectionType`/`qualityStatsRef` is actually sent on a real `end` call and actually persisted — read back directly from the database, not assumed from the request succeeding. Verified via direct Prisma reads of real `CallSession` rows from the same temporary-override test run above, and via `backend/test/calls.e2e-spec.ts`'s dedicated `endReason` persistence test.
- [x] Full Playwright suite for this feature run 3 consecutive times against the real backend, per this project's established pattern for the recurring heavy-load Watch item. Ran clean (2/2, then 3/3 after the video test was added) across 4 separate runs total — the last 2 back-to-back clean with zero retries.
- [x] Backend unit/e2e suites re-verified clean after the §8 DTO addition — the existing `calls.e2e-spec.ts` suite especially, since it directly exercises `EndCallDto`. Final full regression after all fixes: backend unit 49/49 suites, 404/404 tests; backend e2e (`chat`+`calls`+`report-block`) 20/20; frontend `tsc --noEmit` and `eslint .` both clean.

### 11. Open items (explicit decisions — flagged, not guessed silently)

1. **Call entry point is the conversation header only, not the swipe deck.** The deck's "blind voice-call CTA" in `product.md` is a distinct, unspecified product mechanic (§4) already excluded from Feature 13's own scope — building a plain-call button on the deck would invent a UX `product.md` never actually asked for (a *non-blind* deck call), while the real, already-requested thing (a call button once two people are already matched and chatting) has an obvious, uncontested home.
2. **The global call-state store is a new Zustand store (`call-store.ts`), not folded into `useAuthStore` or a React context.** Matches `useAuthStore`'s own established precedent and reasoning (a plain module-level store, not context, for state that needs to be read outside React's render cycle — `lib/websocket-client.ts`'s event handlers, specifically).
3. **`docs/requirements.md`'s Feature 13 §1 standalone-TURN-endpoint description was real documentation drift, corrected here rather than left standing.** No code ever implemented it; nothing depended on it existing. Recorded as a correction, not a silent edit, matching this project's own standing practice for factual corrections to already-shipped features' docs.
4. **`FIRST_CALL_DURATION_LIMIT_SECONDS`'s "placeholder, needs confirmation" framing in Feature 13's own Open Items is stale** — the real `.env` has carried `300` since that feature shipped, with no indication it was ever revisited as a placeholder. Treated here as the real, settled value; Feature 13's doc section should have this reconciled alongside this feature's own review.

## Feature 19: Share My Date (Frontend)

**Status:** ✅ Implemented and self-verified; pending the user's own final review. `product.md` §7.3's UI half of Feature 12's already-shipped backend (`docs/requirements.md` → Feature 12, ✅ shipped, reviewed, approved). Per the user's own framing for this feature: a creation/management interface reachable from inside the match/chat screen for the logged-in sharer, plus a fully public page (no login required) for the trusted contact.

**Depends on:** Feature 12 (`POST`/`GET`/`DELETE /v1/discovery/matches/:matchId/date-share`, `GET /v1/date-share/:token` — all four endpoints confirmed by reading the real, currently-running backend code just now, not assumed from the Feature 12 doc alone: `date-share.controller.ts`, `public-date-share.controller.ts`, `date-share.service.ts`, `create-date-share.dto.ts`), Feature 17 (the conversation screen and header this feature's entry point lives inside, `SafetySheet`'s bottom-sheet interaction pattern), Feature 14 (`proxy.ts`, `AuthRehydrator` — both must be extended, see §1), Feature 15 (`lib/jalali.ts`'s real Jalali↔Gregorian conversion math and `BirthDateField`'s Jalali-first/Gregorian-shown UI convention — reused as a pattern, not verbatim, see §1), Feature 18 (the kill-switch `detail`-text handling precedent this feature's own 503 case reuses).

### 1. What already exists vs. what this feature adds

**Already exists, unchanged (backend, verified by reading the real running code, not the Feature 12 doc alone):**
- `POST /v1/discovery/matches/:matchId/date-share` — `{datetime: ISO 8601, locationText: 1-200 chars}` → `{id, token, expiresAt}`. 400 if `datetime` isn't in the future, 403/404 via `ConversationAccessService.assertParticipant()` (Feature 17's exact existing check), 409 if the *other* participant isn't verified or has `allowInSafetyShares: false`, 429 on the per-user creation rate limit. **One real thing the original Feature 12 draft didn't document, found by reading the live controller just now**: creation is also gated by `@UseGuards(FeatureEnabledGuard('PUBLIC_SAFETY_SHARE_ENABLED', 'Share My Date'))` — a Feature 21 kill switch added after Feature 12 shipped, defaulting `true` in `.env`. A real 503 with a real, distinguishing `detail` text is possible here, exactly the shape Feature 18 already taught this codebase how to surface correctly (never a hardcoded generic message).
- `GET /v1/discovery/matches/:matchId/date-share` — the caller's own links for that match, newest first: `{id, datetime, locationText, expiresAt, revokedAt, createdAt}[]`. **Never includes the token** (FR-159 — only the hash is ever persisted; the raw value exists nowhere server-side after the creation response). This is a real, load-bearing UX constraint this feature's design must respect, not an oversight to work around: once a user navigates away from (or dismisses) the real creation-success view, that specific link's shareable URL is genuinely, permanently gone from the app — only re-shareable by creating a brand-new link. See §6.2/§10 Open Items.
- `DELETE /v1/discovery/matches/:matchId/date-share/:linkId` — 204, sets `revokedAt` (never a hard delete), 403/404 if the caller isn't the link's own creator.
- `GET /v1/date-share/:token` — no `Authorization` header, no guard at all (`public-date-share.controller.ts` has none, deliberately, "so this file has no auth guard is visible at a glance"). Success: exactly `{sharerDisplayName: string|null, partnerDisplayName: string|null, partnerPhotoUrl: string|null, datetime, locationText}` — **no `verified` boolean field exists in this response**; verification is enforced entirely server-side as a precondition for the row existing/being returned at all (FR-156, re-checked live at lookup time per FR-166), so the frontend has nothing to render a badge *from* — the UI should state the partner is a verified هم‌آوا user as fixed copy, not attempt to read a field that isn't there. `partnerPhotoUrl` can genuinely be `null` (the partner has zero photos) and needs a real fallback, exactly like Feature 17/18's existing `otherUser?.primaryPhotoUrl ? … : …` pattern. Any failure (never existed, expired, revoked, or the partner's verification lapsed since creation) is the exact same generic 404 body; the public per-IP lookup rate limit (FR-169) produces a real, distinct 429.

**Missing — what this feature adds:**
- **No frontend UI exists anywhere for creating, listing, or revoking a date-share link** — this is the first frontend surface for any part of Feature 12.
- **This is the first genuinely public, unauthenticated *frontend* route this codebase will have.** Two real, structural gates currently force every route except `/login` behind a valid session, and both must be explicitly, narrowly extended for this feature's new route alone — not loosened generally:
  1. `proxy.ts` (Feature 14, FR-211/212) redirects any request with no refresh cookie straight to `/login`, gated only by `pathname.startsWith("/login")`. A trusted contact opening a real share link with zero cookies at all would be bounced to a login screen they have no account to use.
  2. `AuthRehydrator` (`components/providers/app-providers.tsx`, wrapping every route via the root `app/layout.tsx`) unconditionally attempts a silent refresh on mount and calls `router.replace("/login")` on failure for any route where `!isLoginRoute` — today that's every route except `/login`. Without an equivalent exemption here, even fixing (1) alone would still bounce the visitor client-side a moment after the page loads.
- **No date-and-time input exists anywhere in this frontend.** Feature 15's `BirthDateField`/`lib/jalali.ts` established a real, working Jalali-first/Gregorian-shown pattern this feature should visually and structurally follow — but that component is deliberately calendar-date-only, with no time-of-day and UTC-getter-based conversion specifically because a birth date has no time/zone semantics of its own (`gregorianIsoToJalali`'s own comment). This feature's `datetime` is a genuine point in time — a real meetup at a real local clock time — which needs new, local-timezone-aware conversion logic, not a verbatim reuse of the existing UTC-based helper.
- **No "share" or "copy" icon exists** in `components/icons/index.tsx`.
- **No `lib/queries/date-share.ts` exists.**

### 2. Goal

A user in a real match can, from inside that match's conversation screen, create a private link describing a planned date's time and place, see and revoke the links they've already created for that match, and send the link to a trusted contact through whatever channel they choose. That trusted contact can open the link with no account, no login, and no app install, and see exactly what Feature 12's backend already decided is safe to show them — nothing more.

### 3. In scope

- An entry point in the conversation header (`/matches/:matchId`, alongside Feature 18's call buttons and Feature 17's safety icon) opening a real creation/management sheet. FR-378..FR-383.
- A new Jalali-first date-*and-time* input, genuinely distinct from Feature 15's date-only `BirthDateField`. FR-380.
- Listing and revoking the caller's own previously-created links for that match. FR-384..FR-387.
- The public page itself (`/date/:token`), rendering exactly the real backend response, with real, distinct states for "never existed/expired/revoked" (uniform, per FR-164) versus rate-limited (FR-169). FR-388..FR-393.
- Making that one route genuinely, narrowly public — extending `proxy.ts` and `AuthRehydrator`. FR-394..FR-396.
- Real share/copy mechanics for handing the link to a trusted contact. FR-397..FR-398.
- Page-state, accessibility, and testing standards, reusing Features 14–18's established patterns. FR-399..FR-401.

### 4. Explicitly out of scope for this feature

- **The `allowInSafetyShares` opt-out toggle's own UI** (Feature 12 FR-171/172 — the backend field and endpoint already exist, defaulting `true`). No Settings screen exists yet (Feature 20, per `docs/roadmap.md` item 17/Feature 17's own Open Items #1) — building a one-off toggle screen just for this single field, outside any settings surface, would invent UI structure a real Settings feature should own. The feature functions completely correctly with no frontend toggle today (the backend default already covers the common case); Feature 20 adds the real toggle when it ships.
- **Editing an existing link.** No `PATCH` endpoint exists server-side (Feature 12's own scope was create/list/revoke only) — a link is revoked and a new one created if its details need to change, matching the backend's own real capability exactly.
- **Any in-app mechanism for actually sending the link** (SMS, push, in-app messaging of the link itself) — Feature 6's own FR-82 already established no notification-delivery mechanism exists in this codebase; this feature hands the sharer a real URL and a real share/copy affordance and stops there, exactly like Feature 12's backend already assumed (§5 step 3 there: "any channel they choose").
- **A "trusted contacts" address book or recipient picker** — not requested by `product.md`; the sharer already knows who they're sending it to via whatever external channel they pick.
- **Live location sharing, safe-calling, or post-date feedback** — all already explicitly out of scope at the backend level (Feature 12 §4) and not revisited here.
- **Any client-side analytics beyond what Feature 12's backend already fires** (`date_shared`, on creation only) — Feature 12 deliberately never logs or instruments a public *lookup* in any revealing way (FR-167); this feature does not invent a client-side "link viewed" event that would work against that same discipline.

### 5. User flow

1. Inside a real conversation (`/matches/:matchId`), the user taps a new "اشتراک‌گذاری قرار" entry point in the header, opening a real bottom sheet.
2. The sheet's default step is creation: a real Jalali-first date-and-time field and a free-text location field (1-200 chars). Submitting calls the real `POST`.
3. On success, the sheet shows the real generated link, its real `expiresAt`, and share/copy actions — and stays visible/dismissible-only-by-explicit-action, since this is the one and only moment the raw URL will ever be shown again (§1).
4. The sheet's second step lists the caller's own previously-created links for this match (real `GET`) — active ones show their real remaining validity and a revoke action; the raw URL is never shown here (only ever available at the moment of creation, per §1).
5. The user shares or copies the real link to a trusted contact through any channel outside the app.
6. The trusted contact opens `/date/:token` — no login, no app install. A real successful lookup shows the planned time/place, the sharer's name, and the partner's name, a fixed "verified" note, and a real, freshly-signed photo (or a real placeholder if the partner has none). An invalid link (never existed, expired, or revoked — indistinguishable by design) shows one real, generic "این لینک دیگر معتبر نیست" state; a rate-limited visitor sees a distinct real "بعداً دوباره امتحان کنید" state.

### 6. Functional requirements

#### 6.1 Entry point and creating a link
- FR-378: A new icon button in the conversation header (`components/chat/conversation-view.tsx`, alongside FR-334's shield icon and Feature 18's call buttons) opens a new `DateShareSheet`. Matching Feature 18's own real, established pattern for this exact class of kill switch — the button itself is never pre-emptively disabled from a client-side guess about `PUBLIC_SAFETY_SHARE_ENABLED`'s state (Feature 18's call buttons don't do this either; `callDisabled` there only reflects an already-active call, not the kill switch); a real 503 with the real backend `detail` text is instead surfaced reactively, the first time creation is actually attempted (FR-383).
- FR-379: The sheet's create step: the new date-and-time field (FR-380) and a `locationText` field bounded 1-200 chars client-side (matching the real backend bound, with a visible remaining-character indicator once within ~10%, mirroring Feature 15/17's established convention), plus a submit action.
- FR-380: A new `DateTimeField` component, visually and structurally following `BirthDateField`'s real Jalali-first/Gregorian-shown convention (Jalali day/month/year selects, a real-time Gregorian readout underneath) — but genuinely new, not a reuse: it additionally captures a local clock time (hour/minute), and its Gregorian↔Jalali conversion is local-timezone-aware rather than the existing UTC-getter-based helper, since a real meetup time (e.g., "８ بعدازظهر") must round-trip correctly through the real ISO datetime the backend expects, not collapse to a bare calendar date. Reuses `lib/jalali.ts`'s pure day-math (`toJalaali`/`toGregorian`) underneath; adds new, additive local-time helpers alongside the existing ones rather than modifying them (never breaking `BirthDateField`).
- FR-381: A `datetime` earlier than "now" is prevented at the input level (the earliest selectable day/time is genuinely bounded to the current moment) as well as being caught by the real backend 400 if somehow submitted anyway — never solely a client-side check standing in for the real one.
- FR-382: On a real successful `POST`, the sheet transitions to a real "link created" view showing the real returned link (`{origin}/date/{token}`), its real `expiresAt` (formatted in both Jalali and Gregorian, matching FR-380's own display convention), and the real share/copy actions (FR-397/398).
- FR-383: A real creation failure shows the real, distinguishing backend state: 400 (datetime in the past — should be rare given FR-381, but still handled for real), 409 (the real backend `detail` distinguishing "partner not verified" from "partner opted out" — both surfaced verbatim, never collapsed into one generic message, since the backend itself already tells them apart), 429 (the real rate-limit message), 503 (FR-378's kill-switch case).

#### 6.2 Managing existing links
- FR-384: The sheet's second step (`GET /v1/discovery/matches/:matchId/date-share`) lists the caller's own links for this match, newest first, each showing its real `datetime`/`locationText` and a real status derived from `expiresAt`/`revokedAt` (active / expired / revoked — three genuinely distinct, real client-side-computed states from real server data, not a fourth invented one).
- FR-385: An active link has a real revoke action (`DELETE .../date-share/:linkId`) behind a real confirmation (mirroring FR-335's block-confirmation precedent — a hard-to-reverse-in-effect action), refetching the list on success.
- FR-386: An active link's remaining validity is shown as a real, human-relative duration ("تا ۲ روز دیگر معتبر است"), computed from the real `expiresAt`, not a static timestamp alone.
- FR-387: The list explicitly, visibly communicates that a previously-created link's own URL cannot be shown again here (§1's real constraint) — e.g. "برای اشتراک‌گذاری دوباره، یک لینک جدید بساز" next to each row, never implying a "copy" action exists where none can, since the raw token is genuinely gone server-side.

#### 6.3 The public page
- FR-388: A new route, `/date/[token]`, calls the real `GET /v1/date-share/:token` with no `Authorization` header and no dependency on any cookie/session state — verified directly (network inspection), not assumed from the code alone.
- FR-389: A real successful lookup renders exactly the FR-165 fields: the sharer's `displayName` (falling back to "بدون نام", matching Feature 17/18's existing null-name convention), the partner's `displayName` (same fallback) with a fixed "کاربر تایید شده" note (§1 — there is no `verified` field to read, this is static copy reflecting a guarantee the backend already enforces), the partner's real photo (`partnerPhotoUrl`, or a real placeholder avatar when `null`, matching Feature 17/18's existing pattern), and the real `datetime`/`locationText`, formatted in the same Jalali-first convention as FR-380/382.
- FR-390: Any lookup failure that is a plain 404 (never existed, expired, or revoked — genuinely indistinguishable per the real backend's own FR-164 design) renders one single real, generic "این لینک دیگر معتبر نیست" state — never attempting to guess or display a more specific reason than the backend itself provides.
- FR-391: A real 429 from the public lookup's own per-IP rate limit renders a distinct real "تعداد تلاش‌ها بیش از حد مجاز بود — کمی بعد دوباره امتحان کن" state — deliberately *not* merged into FR-390's generic message, since this is a different failure class (a real, honest "try again," not a link-history-hiding case) and conflating the two would be actively less honest with a legitimate visitor who simply hit the real rate limit.
- FR-392: This route renders with no tab bar, no authenticated-app chrome, and no dependency on `useAuthStore` having any session at all — its own minimal layout, structurally independent of `app/(tabs)/layout.tsx`.
- FR-393: A real, already-authenticated user who opens their own (or anyone else's) `/date/:token` link sees the identical public view — the page must not assume "no cookie present" and must not error, redirect, or behave differently for a visitor who happens to have an active session (a real, direct case to check, not assumed safe by omission).

#### 6.4 Making the route genuinely public
- FR-394: `proxy.ts`'s redirect-to-`/login` rule (FR-211/212) is extended with an explicit, narrow exemption for `/date/` paths specifically — not a broadened matcher, not a general "any route without X prefix" carve-out — so every other protected route keeps its exact current behavior.
- FR-395: `AuthRehydrator` (`app-providers.tsx`) gains an equivalent, equally narrow exemption: for a `/date/` path, it neither attempts a refresh nor calls `router.replace("/login")` on failure — treating "no session here, and that's the fully expected case" as a first-class branch alongside its existing `isLoginRoute` one, not a special-cased hack bolted onto it.
- FR-396: Both exemptions are covered by a real, direct e2e assertion (FR-401) that a fresh browser context with zero cookies can open `/date/:token` and see real content — not just reasoned about from reading the two changed files.

#### 6.5 Sharing mechanics
- FR-397: The real "share" action (FR-382) calls `navigator.share()` when available (feature-detected, not user-agent-sniffed) with the real full URL; where unavailable, falls back to `navigator.clipboard.writeText()` with a real, visible "لینک کپی شد" confirmation — never a silent no-op on a browser lacking both.
- FR-398: The shared/copied value is always the real, full public URL (`{window.location.origin}/date/{token}`) — never the bare token, which is meaningless without the path.

#### 6.6 Page-state, accessibility, testing (Features 14–18's established patterns, reused)
- FR-399: Every new screen (the sheet's create/manage steps, the public page's loading/error/success states) uses the shared `SkeletonLine`/`ErrorState`/`EmptyState` components (Feature 14 FR-220) — a real, layout-shaped skeleton, not a generic spinner.
- FR-400: WCAG 2.1 AA, checked the same real-measured-contrast way as every prior frontend feature — including the public page itself, which needs the identical bar despite rendering for a visitor with no account at all (this codebase's first screen with that property). Full keyboard operability of the create/list/revoke/share actions.
- FR-401: Playwright e2e against the real backend (not mocked): a real link created from a real conversation and immediately visible via the real public page with no `Authorization` header sent; a real revoke making an immediately-following real public lookup fail generically; the real generic-404 shape confirmed identical for a token that never existed versus one just revoked (byte-for-byte, not just "both 404"); a real share/copy action verified directly; a fresh, cookie-less browser context reaching `/date/:token` successfully (FR-396).

### 7. Project structure additions

```
frontend/
 ├─ app/
 │   └─ date/
 │       └─ [token]/page.tsx           -- the public page (FR-388..393), outside (tabs)
 ├─ components/
 │   └─ date-share/
 │       ├─ date-share-sheet.tsx        -- create + manage steps (FR-378..387)
 │       ├─ date-time-field.tsx         -- new Jalali-first date+time input (FR-380)
 │       └─ public-date-view.tsx        -- the public page's real content (FR-389..391)
 ├─ components/icons/index.tsx          -- extended: ShareIcon, CopyIcon
 ├─ lib/
 │   ├─ queries/date-share.ts           -- create/list/revoke/public lookup
 │   └─ jalali.ts                       -- extended, additively: local-time-aware helpers for FR-380
 ├─ proxy.ts                            -- extended: /date/ exemption (FR-394)
 ├─ components/providers/app-providers.tsx  -- extended: AuthRehydrator /date/ exemption (FR-395)
 └─ e2e/date-share.spec.ts              -- FR-401
```

### 8. Backend addition

**None.** Feature 12 already built every endpoint this feature needs, confirmed by reading the real, currently-running backend code (§1) rather than assumed from documentation. The one real backend detail the original Feature 12 draft didn't mention — the `PUBLIC_SAFETY_SHARE_ENABLED` kill switch on the creation endpoint — is handled entirely client-side per FR-378/383, reusing Feature 18's already-established `error.detail`-surfacing pattern; no backend change is needed to support that either.

### 9. Security requirements (from §5, scoped to this feature)

- **The `/date/` route exemption in `proxy.ts`/`AuthRehydrator` must stay exactly as narrow as FR-394/395 specify** — a broadened matcher or a loosely-matched prefix would be a real, structural authentication bypass risk for every other route in this codebase, not a cosmetic scoping choice. Any future edit widening this exemption needs the same scrutiny this document is giving it now.
- **The public page never calls any authenticated endpoint**, regardless of whether the visitor happens to have a valid session (FR-393) — it has exactly one real data dependency, the public lookup itself, and must not be extended later to opportunistically fetch more just because a session happened to be present.
- **No new analytics or logging is added on the public page** (§4) — consistent with Feature 12's own deliberate choice not to log lookups in any revealing way (FR-167); this feature does not undermine that from the client side.
- **The raw share token only ever exists in this feature's own UI at the moment of creation** (§1) — never cached, never persisted to `localStorage`/`sessionStorage`, never logged to the console; once the creation sheet is dismissed, the app itself has no more access to it than anyone else does (matching the backend's own hash-only-at-rest posture, FR-159).
- **Revoke (an authenticated action) has no code path in common with the public `/date/` route, checked directly, not assumed** (user follow-up): different Next.js route trees (`revoke`'s own UI, `DateShareSheet`, is only ever rendered inside `/matches/:matchId` — confirmed by reading the component tree, never inside `app/date/[token]/page.tsx`, and `app/date/` is the *only* route under that prefix, confirmed by a direct search); different backend endpoints entirely (`DELETE /v1/discovery/matches/:matchId/date-share/:linkId` vs. `GET /v1/date-share/:token`, no shared controller); different network call shapes (`revokeDateShareLink()` goes through `apiFetch`, attaching the real session's `Authorization` header, while `getPublicDateShare()` uses its own dedicated fetch that never attaches one, regardless of session state — the two functions live in the same file, `lib/queries/date-share.ts`, but share no code path). `proxy.ts`'s `/date/` exemption is Next.js middleware controlling page navigation only — it has no bearing on API calls to the backend at all.

### 10. Acceptance criteria

- [x] A real link created via the real conversation-header entry point is immediately visible via the real public page, checked field-by-field against FR-165/FR-389 — not just "200 OK." Verified by `frontend/e2e/date-share.spec.ts` ("...immediately visible via the real, unauthenticated public page"): partner name, fixed verified note, sharer name, and location text all asserted individually.
- [x] The public page's real network request carries no `Authorization` header and no dependency on the refresh cookie — verified directly via network inspection, not assumed. Same test: the real `/v1/date-share/:token` request is intercepted and its headers asserted to contain no `authorization` key.
- [x] A real, freshly-authenticated user (no share-link cookie state at all) is confirmed to reach `/date/:token` without any redirect to `/login` — the real FR-394/395 exemptions checked end-to-end, not just read in the diff. Every test in the suite opens the public page from a fresh, cookie-less `browser.newContext()` and asserts real content renders; independently reconfirmed via a live manual browser check (no login) showing the real generic-invalid message for a bogus token.
- [x] A real, already-logged-in user opening the same link also sees the correct public view (FR-393) — no redirect loop, no error state. Verified by a dedicated test: the sharer's own already-authenticated page navigates directly to its own real share link, sees the correct public content, then navigates back into the authenticated app and confirms the real session survived (no forced `/login` redirect either direction).
- [x] Creating a link when the *other* participant is unverified or has opted out shows the real, distinguishing backend `detail` text (409) — checked against a real seeded case for each, not asserted from reading the code. Verified by a dedicated test: the partner's `livenessStatus` and then `allowInSafetyShares` are each flipped directly via Postgres on an already-matched real row (the only reachable way to construct this state, since Feature 6's `VERIFIED_ONLY` default makes an unverified match unreachable through the normal app flow), and the two real, distinct backend detail strings are asserted individually.
- [x] A real revoke makes an immediately-following real public lookup fail with the exact same generic message an already-expired or never-existed token produces — diffed byte-for-byte across all three cases. Verified by two dedicated tests: revoked-vs-never-existed diffed via `.textContent()` equality; expired (via direct Postgres manipulation, Open Items #4) asserted against the identical literal string.
- [x] The partner's photo on the public page is confirmed to be a real, working, freshly-signed URL (fetched directly) — and a second real lookup shortly after returns a **freshly re-signed** URL, not a cached one (proves this feature reuses FR-89/FR-165's live-signing behavior, not a stored copy). Verified: two independent real lookups (separate fresh contexts) against the same link assert the rendered `<img src>` differs between them.
- [x] A real share/copy action is verified directly to place the correct full URL (not the bare token) either on the clipboard or into a real `navigator.share()` call. Verified: a real clipboard-write is asserted via `navigator.clipboard.readText()` matching the exact real URL (a `clipboard-read`/`clipboard-write`-permissioned context).
- [x] The list of previously-created links (FR-384) never renders a copy/share affordance for a link created in an earlier session — verified directly, since the raw token is genuinely unavailable to the frontend at that point (§1). Verified: the manage-tab view is asserted to show neither the "کپی لینک" nor the "اشتراک‌گذاری" button for an already-created link.
- [ ] Exceeding the real per-IP public lookup rate limit shows the real, distinct FR-391 state — **deliberately left unautomated, not silently skipped.** This exact boundary is already real-HTTP-tested at the backend level (Feature 12's own e2e suite). Adding an equivalent frontend test would need ~100 rapid real requests (`DATE_SHARE_LOOKUP_RATE_LIMIT_PER_IP_PER_MINUTE=100`) from the same real IP this entire suite's other tests already share (every Playwright request originates from localhost) — doing so risks tripping the real limit for the *other* tests in the same run if executed back-to-back within the same 60s window, a real risk to overall suite stability, not a hypothetical one. The frontend's own real, narrow responsibility here — rendering `error.problem.status === 429` as the distinct FR-391 message — is implemented (`components/date-share/public-date-view.tsx`) but not exercised end-to-end. Flagged honestly rather than checked without real evidence.
- [x] Full Playwright suite for this feature run 3 consecutive times against the real backend, per this project's established pattern for the recurring heavy-load Watch item. 4 total full-suite runs: 2 fully clean (5/5), 1 with a real, isolated-and-confirmed-transient photo-upload timeout inside the shared `loginAndCompleteProfile` helper (unrelated to this feature's own code — infra confirmed healthy immediately after, MinIO 200/backend healthy/clamd listening, and the single failed test re-ran clean in isolation), 1 fixed-then-clean after a real test-authoring bug (`getByRole` substring-matching "اشتراک‌گذاری" against the entry-point button's own "اشتراک‌گذاری قرار" label — fixed with `exact: true`).
- [x] Backend unit/e2e suites re-verified clean after this feature ships (expected unaffected, since §8 makes no backend change — checked, not assumed, matching this project's standard). Backend unit suite 49/49 suites, 404/404 tests, re-run after this feature's frontend changes.

### 11. Open items (explicit decisions — flagged, not guessed silently)

1. **No edit action for an existing link** — matches the real backend's own scope (create/list/revoke only, no `PATCH`); a link whose details need to change is revoked and recreated.
2. ✅ **Decided (user-confirmed): the `allowInSafetyShares` opt-out toggle's UI is deferred to Feature 20 (Settings)** — the backend field/endpoint already exist and default `true`, so this feature is fully correct and safe without a frontend toggle in the meantime; not a gap this feature silently leaves unaddressed, an explicit deferral to the feature that should actually own it (§4).
3. **The date-and-time field is a genuinely new component, not a reskin of `BirthDateField`** — the two inputs have materially different real semantics (a zoneless calendar date versus a real local point in time), so sharing the day/month/year math from `lib/jalali.ts` while building new, additive local-time-aware conversion helpers is the correct scope, not an unnecessary duplication.
4. ✅ **Decided (user-confirmed): a real *expired* link is tested by directly manipulating a real, created row's `expiresAt` to the past — via a direct Postgres connection, not literally Prisma (see §12) — in the e2e test itself, then calling the real public endpoint and confirming the real generic 404.** Not by waiting 24+ real hours, and not a new env-var escape hatch. Mirrors this project's own existing precedent (temporary DB-driven state manipulation for hard-to-naturally-trigger real conditions, e.g. Feature 18's duration-limit verification) but as a *permanent* part of `e2e/date-share.spec.ts` rather than a temporary, deleted-after-use probe, since this is a real, permanently-testable acceptance criterion (FR-164), not a one-off verification.
5. **Web Share API availability is real-browser-dependent** (requires a secure context; not universally available on desktop) — FR-397's feature-detect-then-clipboard-fallback is the proposed, decided default rather than left for implementation time to improvise, since this is a genuinely settled UX question, not one needing product input.

### 12. Real findings from implementation and verification (not anticipated in the original draft above)

- **A real navigation dead-end in the creation sheet, found while writing the revoke test, before it was ever run**: the create/manage tab switcher was only rendered while `step !== "created"` — meaning after a successful creation, there was no way back to the manage list without closing and reopening the whole sheet (which resets to the create step, losing the just-created link's own success view for nothing). Fixed by adding an explicit "دیدن لینک‌های قبلی" link inside the success view itself — a real, deliberate navigation action, not a conflict with FR-382's "stays visible until dismissed" (moving to manage *is* the explicit dismissal of that view, same as the existing "بستن" action).
- **FR-381's "earliest selectable day is genuinely bounded to today" was written into the requirements but not actually implemented** in the first draft of `DateTimeField` — the day dropdown always listed 1..monthLength regardless of the current date. Found by re-reading the component against its own FR before writing the e2e tests, not by a failing test. Fixed: the day list (and the day committed on a month/year change) is now bounded to today's day whenever the selected year+month equals the current real year+month; deliberately not extended to a full cascading month-lock, since the real backend 400 remains the authoritative enforcement regardless (FR-381's own stated reasoning). **A real, dedicated regression guard was added on explicit user follow-up**, since none of the original 5 e2e tests exercised this specific boundary (every one jumps the year forward, never touching the day list's lower bound) — the fix could have silently regressed with the suite staying green. `createRealDateShareLink()`, the shared helper every test calls, now asserts immediately after opening the sheet (before any month/year change) that the day dropdown's earliest option equals today's real Jalali day exactly — so this now runs on every one of the 5 tests, not as a separate one-off. Verified as a real, sensitive guard via negative control: the original bug (`days = Array.from({length: monthLength}, (_, i) => i + 1)`, no lower bound) was deliberately reintroduced, the suite re-run, and the new assertion failed immediately (`Expected: 2, Received: 1` — the real day-of-test) exactly where expected; reverted and reconfirmed 5/5 clean.
- **The direct-DB-manipulation approach the user decided on (Open Items #4) used a raw Postgres connection (`pg`, added as a frontend devDependency) rather than literally Prisma** — the frontend has no Prisma client of its own, and generating/maintaining a second one purely for one test's direct DB access would have meant real version-drift risk against the backend's own generated client for no benefit. `pg` mirrors the exact same `connectionString`-only connection shape `@prisma/adapter-pg` already uses successfully against this same real Neon database (`backend/src/prisma/prisma.service.ts`), reading the real `DATABASE_URL` directly from the sibling backend's own `.env` file. A deliberate, reasoned substitution of the literal tool named, not a deviation from the actual decision (real, direct DB manipulation in the e2e test itself).
- **A real, structural risk considered and designed around, not just noted**: `AuthRehydrator`'s original `/login`-only skip logic unconditionally called `clearSession()`. A first draft of the `/date/` exemption (FR-395) copied that same unconditional call — which would have silently destroyed an already-authenticated user's real in-memory session on nothing more than an in-app client-side navigation to their own share link. Caught during implementation (before any test was written against it), not by a failing test: fixed by only clearing session state on `/date/` when `status` is genuinely `"unknown"` (a fresh tab with no prior session), leaving an already-real `"authenticated"`/`"unauthenticated"` status untouched — `/login`'s own existing, already-shipped behavior (Feature 14) was deliberately left unchanged, since `proxy.ts` already structurally guarantees no authenticated visitor can ever reach it. The FR-393 e2e test (an already-authenticated user's session surviving a real visit to their own share link) is the real, direct proof this fix works, not just reasoning about it.
- **A real TypeScript control-flow narrowing quirk**: `if (typeof navigator !== "undefined" && "share" in navigator)` narrowed the `else`-reachable code to type `never` (a real `tsc` compile error, not a runtime bug), since `Navigator`'s type in this project's DOM lib has no `undefined` member for the negation to narrow against. Fixed by using `typeof navigator.share === "function"` instead — a standard, narrowing-quirk-free feature-detection idiom.
- **The FR-378 draft's original wording overclaimed a client-side kill-switch pre-check** ("disabled while the real backend reports `PUBLIC_SAFETY_SHARE_ENABLED` off") that doesn't actually exist anywhere in this codebase for this exact class of kill switch — Feature 18's own call buttons don't pre-emptively disable from a guessed kill-switch state either; both surface the real 503 reactively, only after an actual attempt. Corrected in FR-378 itself before implementation, so the doc matches what was actually built rather than the reverse.

---

## Feature 20: Settings (Frontend)

**Status:** ✅ Shipped, reviewed, approved. `product.md` §15's own MVP sequencing item 6 ("Core settings: account, privacy, notifications") whose backend shipped as Feature 6 — this is that feature's first, and only, frontend surface. Also the feature that closes Feature 19's own explicitly-deferred item: `allowInSafetyShares`'s frontend toggle. **This line was stale**, corrected 2026-09-17 after direct verification: confirmed the real `frontend/components/settings/` surface (including `delete-account-flow.tsx`, `privacy-section.tsx`, `notifications-section.tsx`) and a real, current `frontend/e2e/settings.spec.ts` (6 tests, including the real `JwtAuthGuard` stale-token security fix `docs/roadmap.md` §20 documents).

**Depends on:** Feature 6 (`GET /v1/users/me/settings`, `PATCH /v1/users/me/privacy`, `PATCH /v1/users/me/notifications`, `DELETE /v1/users/me` — all four confirmed by reading the real, currently-running backend code, not assumed from the Feature 6 doc alone: `settings.controller.ts`, `settings.service.ts`, `account-deletion.service.ts`, both DTOs), Feature 12/19 (`allowInSafetyShares` — already part of the real `UpdatePrivacyDto`/`UserSettings` shape, confirmed directly), Feature 14 (`useAuthStore`, `apiFetch`, `requestOtp`, the httpOnly-refresh-cookie/`POST /api/auth/logout` mechanism this feature's account-deletion flow must also trigger), Feature 17 (`TabBar`, which explicitly forward-referenced this feature's own tab: "Feature 20 adds its own tab when it ships").

### 1. What already exists vs. what this feature adds

**Already exists, unchanged (backend, verified by reading the real running code):**
- `GET /v1/users/me/settings` → `{preciseLocationEnabled, messagingPermission, notifyOnNewMatch, notifyOnNewMessage, notifyOnSafetyAlert, allowInSafetyShares}` — all six real fields, confirmed against `settings.service.ts`'s own `SETTINGS_SELECT`/`UserSettings` type.
- `PATCH /v1/users/me/privacy` — a real partial update over `{preciseLocationEnabled?, messagingPermission?: 'EVERYONE'|'VERIFIED_ONLY', allowInSafetyShares?}` (confirmed in `update-privacy.dto.ts` — `allowInSafetyShares` is already there, exactly as Feature 19 §11 Open Items #2 assumed).
- `PATCH /v1/users/me/notifications` — a real partial update over `{notifyOnNewMatch?, notifyOnNewMessage?, notifyOnSafetyAlert?}`. **No delivery mechanism exists for any of these** (Feature 6 FR-82, still true) — this feature persists preferences the backend itself is explicit about never acting on yet; the UI must not imply otherwise.
- `DELETE /v1/users/me` — a real, synchronous, complete purge (profile, photos off disk, messages, matches, sessions, consent/liveness records — `AuditLog` explicitly survives), gated on `{phone, code}`: a **freshly completed OTP re-verification**, not a `{confirm: true}` flag (Feature 6 FR-83, an explicit review decision — a stolen bearer token alone must not be sufficient for the one irreversible action in the API). Reuses `OtpService.verifyOtp()` and additionally checks the verified phone's hash matches the caller's own `phoneHash`.
- `POST /v1/auth/logout` (Feature 1/6 FR-87) — revokes the `Session` matching the supplied refresh token. **A real, working `POST /api/auth/logout` Next.js route already exists** (`app/api/auth/logout/route.ts`, confirmed by reading it) that calls the real backend endpoint *and* clears the httpOnly refresh cookie — but **no frontend component anywhere calls it** (confirmed by a direct search — this codebase has never had a logout button). This feature is the first to actually trigger it.
- `POST /v1/auth/otp/request` (Feature 1, FR-213/214, `requestOtp()` in `lib/queries/auth.ts`) — real, unauthenticated, reusable as-is for the account-deletion flow's own re-verification step (§6.5).

**Missing — what this feature adds:**
- **No frontend UI exists anywhere for any of the above** — this is the first frontend surface for all of Feature 6.
- **No fourth tab exists yet.** `TabBar` (`components/layout/tab-bar.tsx`) ships with exactly the three tabs Feature 17 built, its own code comment naming this feature by number as the one that adds a fourth.
- **The frontend has never had access to the user's own plaintext phone number, anywhere, at any point after login.** `AuthUser` (`lib/auth-store.ts`) carries only `{id, livenessStatus, profileCompleted}` — no phone field exists client-side at all, matching the backend's own phoneHash-only-at-rest discipline (the plaintext value exists only transiently, during the OTP request/verify exchange itself, never persisted or returned by any authenticated endpoint afterward). This is a real, load-bearing UX fact for account deletion (§6.5), not an oversight to work around: the user must correctly retype the same phone number they originally signed up with, from memory, with no way for this app to remind or prefill it — a mistyped number produces a real, honest backend rejection (the phone-hash-mismatch check, Feature 6 FR-83), not a silent failure.
- **`verifyOtp()` (`lib/queries/auth.ts`) is login-specific and not reusable for deletion** — it calls this app's own `/api/auth/verify` proxy route, which establishes a *new* session (sets the httpOnly cookie, populates `useAuthStore`). Account deletion needs a materially different final call (`DELETE /v1/users/me`, authenticated by the caller's *already-existing* access token, with `{phone, code}` only as the re-verification body) — a new function, not a reuse of `verifyOtp()`'s own code path.
- **A real sequencing gap that only surfaces once you trace it through**: after a successful `DELETE /v1/users/me`, the `Session` row backing the httpOnly refresh cookie is already gone (cascaded, Feature 6 FR-85) — but the cookie itself is a separate, client-side artifact that nothing clears automatically just because the backend row disappeared. This feature's deletion flow must explicitly call `POST /api/auth/logout` *after* a successful deletion (harmlessly a no-op on its own backend-revoke call, since the session's already gone — but its cookie-clearing step is the one still-necessary real effect) before clearing `useAuthStore` and redirecting to `/login`. Missing this step would leave a stale-but-cookie-present browser that `proxy.ts` still treats as having a session, even though the account behind it no longer exists.

### 2. Goal

A user can see and control the same privacy/notification/safety-sharing settings Feature 6/12 already built server-side, log out for the first time this app has ever had a UI for, and — if they choose — permanently and completely delete their account, with the same rigor around irreversibility and re-authentication the backend already enforces surfaced honestly in the UI rather than smoothed over.

### 3. In scope

- A fourth persistent tab (`/settings`), closing Feature 17's own forward-reference. FR-402..FR-404.
- Privacy settings: precise-location toggle, "who can message me," and `allowInSafetyShares` — all three real, already-backed toggles. FR-405..FR-408.
- Notification preferences: the three real toggles, persisted-only, with the "nothing is actually sent yet" fact stated honestly in the UI. FR-409..FR-410.
- Logout — the first working logout UI this app has had. FR-411..FR-412.
- Account deletion: a real, multi-step, hard-to-misuse flow ending in the real OTP-gated `DELETE`, with real, honest irreversibility messaging. FR-413..FR-420.
- Page-state, accessibility, and testing standards, reusing Features 14–19's established patterns. FR-421..FR-423.

### 4. Explicitly out of scope for this feature

- **Multi-device session listing/revocation** (`product.md` §8.2) — already explicitly deferred by Feature 6 itself (§4 there); not picked up here just because this is "the settings feature." The real gap and its own scoping note stay exactly where Feature 6 left them.
- **Actual notification delivery** (push/SMS/email) — Feature 6's own explicit non-scope (FR-82), still true; this feature's UI persists preferences honestly, it does not pretend delivery exists.
- **"General" settings** (language, theme) — `product.md` §7.4 names the category but specifies nothing under it yet; not invented here, matching Feature 6's own identical deferral (§4 there).
- **Account recovery / un-deletion / a grace period before purge** — Feature 6 §10 already decided this explicitly (immediate, synchronous deletion, no soft-delete state reachable via any API); this feature's UI reflects that real backend behavior, it doesn't add a client-side "are you really sure" delay that implies a recovery window the backend doesn't actually have.
- **A "type DELETE to confirm" style text-input gate** — a common pattern in other apps, but redundant on top of a real, already-decided, materially stronger gate: a freshly-verified OTP (Feature 6 §10 Decision #1's own explicit reasoning for why a boolean-style confirmation isn't enough). Adding a second, weaker confirmation layer under a real one would be theater, not safety.
- **Editing `preciseLocationEnabled`'s downstream effect** (what "precise location" actually changes in discovery ranking/filtering) — that's Feature 3/9's own concern; this feature only reads/writes the toggle's stored value, exactly as Feature 6 itself only ever stored it.

### 5. User flow

1. A persistent fourth tab, "تنظیمات," is reachable from anywhere in the app (matching Feature 17's own tab-bar shell exactly).
2. The settings screen loads `GET /v1/users/me/settings` once and renders three real, distinct sections: Privacy (location, messaging permission, safety-share visibility), Notifications (three toggles), and Account (logout, delete).
3. Toggling any privacy/notification switch calls the matching real `PATCH` immediately (no separate "save" step) — an optimistic flip, reconciled against the real response or a real, visible failure that reverts the toggle.
4. Logout opens a real, brief confirmation, then calls `POST /api/auth/logout`, clears `useAuthStore`, and redirects to `/login`.
5. Delete Account opens a real, multi-step flow: an explicit warning naming exactly what's about to be permanently destroyed (matching Feature 6's own real scope — profile, photos, messages, matches, sessions), then a real phone-number re-entry + OTP request/verify pair (reusing `requestOtp()`, not `verifyOtp()`), then the real `DELETE /v1/users/me` call. On success: `POST /api/auth/logout` (for its cookie-clearing effect), `clearSession()`, redirect to `/login` with a real, distinct "account deleted" message — never the plain login screen with no explanation.

### 6. Functional requirements

#### 6.1 The fourth tab
- FR-402: `TabBar` gains a fourth entry, `{href: "/settings", label: "تنظیمات"}`, using a new gear-style icon (§7) — closing Feature 17's own forward-reference (`components/layout/tab-bar.tsx`'s existing comment naming this feature).
- FR-403: `/settings` is a real route inside `app/(tabs)/`, sharing the tab bar and the app-wide WebSocket/call-listening shell exactly like `/`, `/matches`, `/profile` already do — no separate layout.
- FR-404: The settings screen itself never appears inside a conversation, call, or any other feature's own UI — it's reached only via the tab, matching every other tab's own single-entry-point convention.

#### 6.2 Privacy settings
- FR-405: `GET /v1/users/me/settings` is fetched once (React Query) on screen load; each toggle's initial state comes from the real response, never a hardcoded default (the real secure-by-default values — FR-78 — are what a brand-new user's response already contains, so the UI never needs to guess or duplicate them).
- FR-406: The precise-location toggle and the messaging-permission control (`EVERYONE` vs `VERIFIED_ONLY` — a real two-option choice, not a free toggle standing in for an enum) each call `PATCH /v1/users/me/privacy` with only the one changed field — a genuine partial update, matching the real backend contract (FR-80), never resending the whole settings object.
- FR-407: `allowInSafetyShares` gets its own real toggle here, with real, specific copy explaining what it does ("اجازه بده عکس و اسمت توی لینک‌های اشتراک‌گذاری قرار دیگران نشون داده بشه") — closing Feature 19 §11 Open Items #2 exactly as proposed there.
- FR-408: A real toggle failure (network error, an unexpected 4xx) visibly reverts the switch to its last-known-real state and shows a real, brief error — never leaves the UI showing a value the backend didn't actually accept.

#### 6.3 Notification preferences
- FR-409: The three toggles (`notifyOnNewMatch`, `notifyOnNewMessage`, `notifyOnSafetyAlert`) each call `PATCH /v1/users/me/notifications` the same optimistic-partial-update way as §6.2's privacy toggles.
- FR-410: The notifications section carries real, visible copy stating these are stored preferences only and nothing is sent yet (mirroring Feature 6 FR-82's own explicit framing) — never presented as if toggling one changes real delivery behavior that doesn't exist.

#### 6.4 Logout
- FR-411: A real, visible "خروج از حساب" action inside the Account section opens a brief real confirmation (a lower-stakes, reversible action than deletion — a lighter-weight confirmation than §6.5's multi-step flow, not the same UI).
- FR-412: On confirmation: `POST /api/auth/logout` (the already-real, already-working route), then `useAuthStore.getState().clearSession()`, then a redirect to `/login` — the first real exercise this route has ever had from an actual UI trigger.

#### 6.5 Account deletion — a real, multi-step, hard-to-misuse flow
- FR-413: The entry point ("حذف حساب") is visually and spatially separated from every other Account-section action (`product.md` §7.4's own taxonomy: "destructive actions clearly separated") — never adjacent to or styled like the logout button.
- FR-414: Step 1 is a real, specific warning naming exactly what Feature 6's own real scope actually destroys — profile, photos, messages, matches, sessions — and stating plainly that this is immediate and permanent, not scheduled or reversible (matching the real backend behavior, Feature 6 §10 Decision #2 — never implying a grace period or recovery option that doesn't exist).
- FR-415: Step 2 is a real phone-number re-entry field (E.164, matching Feature 14's own validation pattern) — the user must type the number themselves, since the app has no copy of it to prefill (§1). Submitting calls the real, existing `requestOtp()` (unauthenticated `POST /v1/auth/otp/request`, unchanged from Feature 14).
- FR-416: Step 3 is a real 6-digit code entry (mirroring `OtpStep`'s own visual convention, but a new component — not a reuse of `OtpStep` itself, since its own `verifyOtp()` establishes a login session, which is the wrong action here, §1).
- FR-417: Submitting the code calls a new `deleteAccount(phone, code)` (`lib/queries/settings.ts`) — `DELETE /v1/users/me` via the authenticated `apiFetch`, body `{phone, code}` — never the login-flow's `verifyOtp()`.
- FR-418: A real failure at this step (wrong/expired code, or a valid code for a phone number that doesn't hash-match the caller's own account) shows the real backend error text directly — never a generic "something went wrong," since the two real failure modes here (bad code vs. wrong phone) are both real, distinguishable, and worth the user seeing plainly (Feature 6's own `DELETE` already distinguishes them server-side).
- FR-419: On a real successful deletion: `POST /api/auth/logout` (for its cookie-clearing effect — §1's sequencing finding; its own backend-revoke call harmlessly no-ops since the `Session` row is already gone), then `useAuthStore.getState().clearSession()`, then a **hard navigation** (`window.location.href`, not `router.replace()`) to `/login?accountDeleted=1`, which renders a real, distinct "your account has been permanently deleted" message — never the plain, unexplained login screen. **User-decided behavior if the `POST /api/auth/logout` call itself fails** (network error, unexpected non-2xx): the failure is caught and swallowed, and the hard navigation to `/login` happens regardless — the real, irreversible `DELETE /v1/users/me` has already succeeded by this point, so a problem in this second, cookie-clearing-only call must never leave the user stranded in an ambiguous state waiting on it. A hard reload (rather than a soft client-side redirect) is deliberate here too: it forces a fresh `AuthRehydrator` mount that independently re-checks the now-actually-gone session, rather than trusting the deletion flow's own client-side state to have gotten everything right.
- FR-420: The whole flow is abandonable at every step before the final `DELETE` call (a visible "انصراف" at each step) with zero side effects — only the final, explicit code submission is destructive; every step before it is inert.

#### 6.6 Page-state, accessibility, testing (Features 14–19's established patterns, reused)
- FR-421: Every screen here uses the shared `SkeletonLine`/`ErrorState`/`EmptyState` components (Feature 14 FR-220).
- FR-422: WCAG 2.1 AA, checked the same real-measured-contrast way as every prior frontend feature. Full keyboard operability of every toggle and every step of the deletion flow; the deletion flow's real warning text is not conveyed by color alone.
- FR-423: Playwright e2e against the real backend: a real toggle change persists across a real page reload; a real logout actually clears the session (a subsequent protected-route visit redirects to `/login`); a real, full account-deletion flow (real phone re-entry, real OTP, real `DELETE`) results in the account genuinely being gone — checked by a real, subsequent OTP-request-and-verify with the same phone number succeeding and producing a **brand-new** user id, not the deleted one (mirroring Feature 6's own backend acceptance criterion, now proven end-to-end through a real browser).

### 7. Project structure additions

```
frontend/
 ├─ app/(tabs)/settings/page.tsx        -- FR-402..423
 ├─ components/settings/
 │   ├─ privacy-section.tsx              -- FR-405..408
 │   ├─ notifications-section.tsx        -- FR-409/410
 │   ├─ logout-button.tsx                -- FR-411/412
 │   └─ delete-account-flow.tsx          -- FR-413..420 (warning → phone → code steps)
 ├─ components/icons/index.tsx           -- extended: SettingsIcon (gear)
 ├─ components/layout/tab-bar.tsx        -- extended: fourth tab (FR-402)
 ├─ lib/queries/settings.ts              -- getSettings/updatePrivacy/updateNotifications/deleteAccount
 └─ e2e/settings.spec.ts                 -- FR-423
```

### 8. Backend addition

**Originally planned as none** — Feature 6 already built every endpoint this feature needs, and Feature 12/19 already extended `UpdatePrivacyDto`/`UserSettings` with `allowInSafetyShares`, both confirmed by reading the real, currently-running backend code (§1). **A real, unplanned backend addition was made during pre-implementation verification of the account-deletion flow (§6.5) — not part of this feature's original scope, but a genuine, root-caused security/robustness gap it surfaced.** See §12 for the full trail: `JwtAuthGuard` (`backend/src/modules/auth/guards/jwt-auth.guard.ts`) now re-checks that the token's `sub` still names a real, existing user on every request (previously, verification was purely cryptographic — signature and expiry only), and `ProblemDetailsFilter` gained a defense-in-depth `P2025` (Prisma "record not found") → real `404` branch, both fixed on explicit user direction before this feature's own frontend implementation began.

### 9. Security requirements (from §5, scoped to this feature)

- **No client-side shortcut around the real OTP re-verification gate** (§6.5) — this feature's UI must never offer, cache, or auto-fill a code, and must never let the `DELETE` call fire from anything other than a real, freshly-submitted `{phone, code}` pair the user just typed.
- **The httpOnly-cookie-clearing step (FR-419) is not optional polish — it's a real, load-bearing part of the deletion flow** (§1): skipping it would leave a browser whose `proxy.ts`-visible cookie still implies a session for an account that server-side no longer exists, a real, confusing inconsistency, not just a cosmetic one.
- **Deletion is irreversible by design, and the UI must never imply otherwise** (FR-414) — no "recover within 30 days," no "your data is safe for a while," matching Feature 6 §10 Decision #2's own real backend behavior exactly.
- **Notification toggles must never be presented as controlling real delivery** (FR-410) — Feature 6's own explicit non-scope (FR-82) stays true and visible in this feature's copy, not silently smoothed over into implying a working notification system.

### 10. Acceptance criteria

- [x] A real toggle change (any of the six real settings fields) persists across a real page reload, read back from a fresh `GET /v1/users/me/settings` — not assumed from the optimistic UI update alone. `e2e/settings.spec.ts` ("a real settings toggle change persists across a real page reload").
- [x] A real logout clears the real session: a subsequent visit to a protected route (e.g. `/matches`) redirects to `/login`. `e2e/settings.spec.ts` ("a real logout clears the session..."). (The httpOnly-cookie-specific check is folded into the deletion test below and the JwtAuthGuard backend test, both more direct proofs than a cookie-presence check alone would be.)
- [x] The real account-deletion flow, run end-to-end with a real seeded user: the warning step names the real destroyed data categories; the phone/OTP steps call the real `requestOtp`/`deleteAccount` endpoints (not `verifyOtp`). `e2e/settings.spec.ts` ("a real, full account-deletion flow..."), reading the real devCode off the real `/v1/auth/otp/request` response rather than a hardcoded value.
- [x] After a real successful deletion: the same phone number can complete a fresh real OTP request→verify (login) flow and receive a **brand-new** user id — checked directly, not assumed from the 204 response alone (mirrors Feature 6's own backend acceptance criterion, now proven through a real browser end-to-end). Same test, continues past deletion into a fresh real login attempt with the identical phone number.
- [x] After a real successful deletion, the browser is confirmed to hold no working session at all, and a stale-but-cryptographically-valid access token is confirmed really rejected — **found during this exact check that the real answer was a 500, not a 401/403** (see §12); fixed at the root (`JwtAuthGuard`), and closed with a dedicated real backend e2e test (`backend/test/settings.e2e-spec.ts`, "rejects the caller's own now-stale access token...") reusing the exact same still-valid token post-deletion and asserting a real 401.
- [x] `allowInSafetyShares`'s toggle here is confirmed to actually gate real Share My Date link creation (Feature 19 FR-383's real 409) — toggling it off via the real Settings UI (not a direct DB write), then attempting a real link creation for a match where this user is the *partner*, produces the real backend 409; toggling it back on immediately allows creation to succeed for the same pair (closing Feature 19 §11 Open Items #2 with a real, working, tested toggle, not just a UI element). `e2e/settings.spec.ts` ("the real allowInSafetyShares toggle actually gates...").
- [x] Full Playwright suite for this feature run 3 consecutive times against the real backend, per this project's established pattern for the recurring heavy-load Watch item. 3/3 runs, 12/12 tests total, zero retries needed.
- [x] Backend unit/e2e suites re-verified clean after this feature ships. Unit suite 405/405 (404 + 1 new `ProblemDetailsFilter` P2025 test). Full whole-repo e2e regression: 11/15 suites clean on the first combined run, 3 suites (`calls`, `match-explanation-boost`, `report-block`) timed out under this project's own well-documented "long combined run under sustained real-vendor load" pattern — all three re-verified clean in isolation immediately after (5/5, 11/11, 10/10), confirming transient, not caused by this feature's changes. `settings.e2e-spec.ts` itself (including the new stale-token test) passed clean in the very first combined run.

### 11. Open items (explicit decisions — flagged, not guessed silently)

1. **The settings screen is one single scrollable page (Privacy / Notifications / Account, in that order), not three separate sub-routes.** `product.md` §7.4's taxonomy names four categories (Account, Privacy & Safety, Notifications, General) but this feature only has real content for three of them (§4 — no "General" fields exist yet); a single page keeps navigation simple for a genuinely small amount of real content, and avoids building sub-route scaffolding for a "General" section that has nothing in it yet.
2. **Logout's confirmation is a lightweight inline/modal step, not the same multi-step flow as deletion (§6.4 vs §6.5).** Logout is fully reversible (log back in any time) — treating it with deletion's own heavier ceremony would be inconsistent with `product.md` §7.4's own explicit call to keep destructive actions *distinctly* separated, which implies non-destructive ones shouldn't be dressed up to look equally severe.
3. **`allowInSafetyShares`'s copy explains the *consequence* (appearing in others' share links), not the underlying `DateShareLink` mechanism by name** — a settings-screen user has very likely never seen Feature 19's own UI at all; explaining the toggle in terms of what it does (visibility to a trusted contact) rather than assuming familiarity with "Share My Date" as a named feature is the more honest default.
4. **Multi-device session management stays exactly where Feature 6 left it — deferred, not reopened.** Nothing about building this feature's UI changes the size or urgency of that real gap; picking it up would be silently expanding this feature's scope beyond what was asked.

### 12. Real findings from implementation and verification (not anticipated in the original draft above)

- **A real, cross-cutting backend security/robustness gap, found by directly probing the real running backend before writing a single line of this feature's frontend code, not by a failing test.** The plan going into implementation was to write the account-deletion flow assuming a stale access token would be cleanly rejected (401/403) after deletion — a real curl-driven trace against the live backend showed the actual answer was a **500 Internal Server Error**. Root cause, confirmed by reading the real code: `JwtAuthGuard` (Feature 1) verified only the JWT's signature and expiry (`TokenService.verifyAccessToken`), never whether the user it names still exists; `SettingsService.getSettings()`'s `findUniqueOrThrow` then threw an uncaught Prisma `P2025` ("record not found"), which `ProblemDetailsFilter` had no specific branch for, falling through to its generic 500. This was a real, standing gap in Feature 1's foundational auth guard affecting *every* authenticated endpoint for the full 15-minute access-token TTL after *any* account deletion — only newly reachable because Feature 6 was the first feature to ever make a user row disappear out from under a still-valid token; not something Feature 20's own scope would normally touch.
- **Fixed at the root, on explicit user direction, before this feature's frontend implementation began** (not patched around at the one call site that happened to surface it): `JwtAuthGuard` now calls `UsersService.findById(payload.sub)` after verifying the token and throws a real `UnauthorizedException` if no such user exists — the one place that protects every authenticated endpoint uniformly, rather than requiring each service to defend against a deleted-but-still-token-bearing caller on its own. A real DI wiring gap surfaced immediately by this change (not anticipated): `AuthModule` imported `UsersModule` internally but never re-exported it, so any *other* module importing `AuthModule` for `JwtAuthGuard` alone (e.g. `AdminModule`) couldn't resolve the guard's new `UsersService` dependency — a real e2e boot failure, not a hypothetical one, caught immediately by running the full e2e suite. Fixed by adding `UsersModule` to `AuthModule`'s own `exports`.
- **A second, independent fix, added on explicit user direction as defense-in-depth**: `ProblemDetailsFilter` gained a dedicated `P2025` → real `404` branch. `JwtAuthGuard`'s own fix means a deleted user's stale token can no longer reach this specific code path at all — but the same uncaught-P2025-falls-through-to-500 shape could exist at any other real "record not found" site in the app, present or future, and this closes that class of bug uniformly rather than per-site. Covered by its own dedicated unit test (`problem-details.filter.spec.ts`) confirming a real `P2025` error now produces a real 404, plus confirmation that an unrelated code (`P2002`) still correctly falls through to 500 (the fix is scoped exactly to `P2025`, not "any Prisma error").
- **Closed with a real, dedicated regression test, not just reasoning about the fix**: `backend/test/settings.e2e-spec.ts` gained a new test that creates a real user, captures its real access token, deletes the account for real (fresh OTP re-verification), then reuses that exact same still-unexpired token against a real protected endpoint and asserts a real `401` — the direct, empirical proof the fix works, mirroring exactly the curl trace that first found the bug.
- **A real, explicit user decision on the one remaining ambiguity in the deletion flow's own sequencing** (FR-419): if the post-deletion `POST /api/auth/logout` call itself fails, the failure is caught and swallowed, and a hard navigation to `/login` happens regardless — since the real, irreversible account deletion has already succeeded by that point, a problem in the second, cookie-clearing-only call must never leave the user stranded in an ambiguous state.

---

## Feature 21: AI Matching Foundation — Audit Follow-up (Backend)

**Status:** ✅ Shipped, reviewed, approved. Follows `docs/architecture-review-v2.md` (the Phase A/B audit against the AI-native-matching master directive) and the user's explicit Bucket decisions on it. **This line was stale**, corrected 2026-09-17 after direct verification: confirmed the real `ProfileAttributeProvenance` model, `MATCH_ALGORITHM_V1` versioned score skeleton (`backend/src/modules/discovery/matching/match-score.types.ts`), and `matchReasons`/`matchMismatches` — all present in the current schema/code, matching `docs/roadmap.md`'s own detailed write-up (backend unit suite 49/49 suites, 404/404 tests at the time).

**Depends on:** Feature 2 (`ProfileService`), Feature 9 (`AiSearchService`, embedding provider), Feature 10 (`MatchExplanationService`, grounding pattern), Feature 11 (`ConversationalSetupService`), the shared `AuditLogService`/`ProductionSafetyService` patterns. Backend-only — no frontend work in this feature (Feature 17 is a separate, already-planned frontend feature and is not renumbered or touched by this one).

**Explicitly out of scope, by direct user decision on the audit:** Persona, Intent-as-entity, Need, Offer, or any multi-identity/complementary-matching data model. `docs/architecture-review-v2.md` §G's "Persona" row stays MISSING — not started, not designed further, per "این دقیقاً همون تغییر مسیر بزرگیه که قبلاً رد کردیم؛ محصول دیتینگ متمرکز می‌مونه."

### 1. What this feature adds

Seven infrastructure items (audit Bucket A, all additive, none touching the identity model) plus one feature upgrade (structured match explanation):

1. **Attribute provenance** — which entry path (typed directly vs. AI-proposed-then-confirmed) produced each profile field's current value, plus AI confidence where the AI path provides one.
2. **Data classification reference** — a documented, centralized catalog of every `User`/`Match`/`Message` field's sensitivity and who/what may use it, consolidating logic that is already correctly enforced but currently scattered (`docs/architecture-review-v2.md` §F).
3. **Match score versioning skeleton** — a versioned `MatchScore`/`MatchSignals` shape, real (not a stub) for the one signal that exists today (semantic similarity), reserved fields for the signals that don't exist yet.
4. **Match feedback** — an optional, explicit rating a match participant may leave (`VERY_RELEVANT`..`WRONG_MATCH` + an optional reason code), never required.
5. **AI evaluation framework** — a runnable, versioned eval harness against real OpenAI (never mocked, matching this project's standing testing discipline) for the two domains with enough existing surface to evaluate today, plus a documented structure for the domains that don't yet.
6. **AI cost/usage observability** — every real OpenAI call (all six providers) records a real usage event: provider, model, feature, latency, success, token counts where the vendor returns them, and an estimated cost.
7. **Feature kill switches** — environment-driven, default-on switches for AI search, AI onboarding, voice calls, video calls, and Share My Date creation — no new feature-flag platform, no per-user targeting.
8. **Structured match explanation** — `Match.whyYouTwo: String?` is replaced with `matchReasons: String[]` + `matchMismatches: String[]`, both grounding-checked against real profile facts before being persisted, exactly extending Feature 10's existing verified-generation pattern rather than replacing it.

### 2. Real, pre-existing constraint this feature must respect throughout

**No production users exist yet** (confirmed throughout this project's own docs — every environment is dev/test). This is why item 8 above is a clean schema replacement rather than an additive-only migration with a deprecation window: `docs/architecture.md` §6's Safe Update Policy exists to protect a real mobile client already in the field against a server that moved ahead of it, and no such client exists for `whyYouTwo` — it has exactly one consumer today (`MatchService`/`SwipeService`, this codebase's own backend), Feature 17 (frontend match/chat) hasn't been built yet to read it, and every backend e2e test that touches it is updated in the same change. Recorded explicitly here so this isn't read as a silent departure from that policy — it's a deliberate, narrow exception, justified by there being no real external consumer, not a precedent for schema changes in general.

### 3. Data model additions

```
ProfileAttributeProvenance
 ├─ id, userId, field (String — one of the real UpdateProfileDto keys)
 ├─ source (AttributeSource: USER_ENTERED | USER_CONFIRMED)
 ├─ confidence (Float?, 0..1 — populated only for USER_CONFIRMED fields where the
 │   extraction call itself returned one; null for USER_ENTERED, since there is
 │   no AI involvement to have a confidence about)
 ├─ confirmedAt (DateTime)
 └─ @@unique([userId, field])   -- latest-known-provenance, not a full history

Match (extended, not a new model)
 ├─ whyYouTwo: String?              -- REMOVED (§2 above)
 ├─ matchReasons: String[] @default([])       -- NEW
 ├─ matchMismatches: String[] @default([])    -- NEW
 └─ explanationGeneratedAt: DateTime?         -- NEW; null = not yet attempted/generated,
     replaces the old "whyYouTwo !== null" already-generated check

MatchFeedback
 ├─ id, matchId, userId (the participant leaving feedback)
 ├─ rating (MatchFeedbackRating: VERY_RELEVANT | RELEVANT | NEUTRAL | NOT_RELEVANT | WRONG_MATCH)
 ├─ reasonCode (MatchFeedbackReason?: LOCATION | AGE | GOAL | LANGUAGE | PROFESSION | INTEREST | NOT_INTERESTED | OTHER)
 ├─ createdAt, updatedAt
 └─ @@unique([matchId, userId])   -- a participant may change their mind; upsert semantics

AiUsageEvent
 ├─ id, userId (String?, SetNull on user deletion — see §5: this is operational
 │   cost data, not a compliance record, so it doesn't earn AuditLog's hard
 │   never-cascade treatment, but there's still no reason to force-delete it)
 ├─ provider (String, e.g. "openai"), model (String), feature (String — the
 │   calling capability, e.g. "ai-search-extraction", "conversational-extraction",
 │   "embedding", "match-explanation-generate", "match-explanation-grounding-check",
 │   "transcription")
 ├─ success (Boolean), latencyMs (Int)
 ├─ promptTokens (Int?), completionTokens (Int?)  -- null when the vendor endpoint
 │   doesn't return usage (confirmed per-endpoint at implementation time, not guessed)
 ├─ estimatedCostUsd (Float?)   -- computed from token counts × a static per-model
 │   rate table when tokens are known; null otherwise
 └─ createdAt
     -- indexed (feature, createdAt) and (provider, model, createdAt) for the
     -- aggregate "cost per feature" / "cost per model" queries this exists for
```

No changes to `User`, `DiscoveryPreferences`, or any Feature 1–16 table beyond `Match` as described above.

### 4. Functional requirements

**Attribute provenance (FR-286..FR-289)**
- FR-286: `ProfileService.updateProfile()` upserts one `ProfileAttributeProvenance` row per field present in the DTO, on every successful write — `source: 'USER_ENTERED'` when called with `source: 'FORM'` (the existing param), `source: 'USER_CONFIRMED'` when called with `source: 'CONVERSATIONAL'`.
- FR-287: `ConversationalSetupService` extracts a per-field `confidence` (0..1) from the same structured-output call that already proposes the field (`ExtractedTurnField`/`TurnExtractionResult` gain an optional `confidence` field), and passes it through to `updateProfile()` so `confirm()`'s provenance row carries a real value, not null.
- FR-288: This is purely additive to `ProfileService`'s public contract — no existing caller (`PATCH /v1/profile`, the frontend) changes shape or behavior. Provenance is not returned by `GET /v1/profile/me` in this feature (no product decision yet on surfacing it — `docs/architecture-review-v2.md` §7/§8 explicitly warns against exposing `AI_INFERRED`-shaped data without one).
- FR-289: Provenance write failures must never block the underlying profile write (same fail-open posture as `recomputeBioEmbedding()` — a provenance-table hiccup is not a reason to fail a user's real profile save).

**Data classification (FR-290)**
- FR-290: `docs/data-classification.md` catalogs every `User`/`Match`/`Message`/`ModerationFlag` field with its classification (`PUBLIC | MATCH_ONLY | PRIVATE | SENSITIVE | HIGHLY_SENSITIVE | VERIFIED_ONLY`) and names the real, existing mechanism that enforces it (e.g. `bio` → `MATCH_ONLY`, enforced by `DeckCandidate`'s explicit field selection, never a full-row serialization). A small, pure reference module (`backend/src/common/data-classification/`) exports the same catalog as typed constants + two pure helpers (`isVisibleToMatching(field)`, `isVisibleToAi(field)`) for future code to consult — this feature does not migrate any existing check onto it; existing checks are correct and stay exactly as they are.

**Match score skeleton (FR-291..FR-292)**
- FR-291: `MatchSignals`/`MatchScore` types + a `MATCH_ALGORITHM_VERSION = 'MATCH_ALGORITHM_V1'` constant (`backend/src/modules/discovery/matching/match-score.types.ts`). Only `semanticSimilarity` is a required, real field (derived from the existing cosine distance, normalized to `[0,1]`); every other signal (`goalCompatibility`, `needOfferCompatibility`, `preferenceCompatibility`, `contextualCompatibility`, `trustSignal`, `behavioralCompatibility`) is optional and genuinely absent today — documented as reserved, not populated with a fake value.
- FR-292: `AiSearchService.search()` computes a real `MatchScore` per ranked candidate and includes it as an optional `matchScore` field on the response — additive to `DeckCandidate`, `undefined` for plain deck results (which have no semantic ranking to score). No ranking *behavior* changes — the existing `ORDER BY` is untouched; this is observability/scaffolding for a future signal, not Matching V2.

**Match feedback (FR-293..FR-295)**
- FR-293: `POST /v1/discovery/matches/:matchId/feedback` — authenticated, caller must be a participant of the match (404 if the match doesn't exist, 403 if it exists but isn't theirs — the same posture Feature 12 already established for a durable, mutually-known resource). Body: `{rating, reasonCode?}`. Upserts on `(matchId, userId)` — leaving feedback twice updates it, never errors.
- FR-294: Feedback is entirely optional from the product's perspective — no endpoint requires it, no other flow is blocked by its absence.
- FR-295: `GET /v1/discovery/matches/:matchId/feedback` — the caller's own feedback for that match, if any (`null` otherwise) — lets a future frontend show "you already rated this."

**AI evaluation framework (FR-296..FR-297)**
- FR-296: `backend/scripts/ai-evals/` — real, runnable (`ts-node`) scripts against the real OpenAI account, never mocked, matching this project's own standing discipline. Two domains implemented for real in this feature: conversational profile-extraction accuracy (a small, synthetic, committed fixture set — sentences with a known expected field/value, run through the real `ConversationalExtractionProviderInterface`, accuracy computed and printed) and AI-search filter-extraction accuracy (same shape, against `AiSearchExtractionProviderInterface`). `docs/ai-evaluation.md` documents these two plus the *structure* for the domains not yet populated (match ranking, match explanation, moderation, translation, speech recognition) — named and scaffolded, not faked with placeholder numbers.
- FR-297: Eval fixtures are 100% synthetic, authored for this purpose — never real user data, per the master directive's explicit prohibition.

**AI cost/usage observability (FR-298..FR-299)**
- FR-298: A new `AiUsageTrackerService` (`backend/src/common/ai/ai-usage-tracker.service.ts`) with one method, `record(entry)`, called by all six `OpenAi*Provider` classes after every real call (success or failure) — latency always measured client-side; token counts read from the vendor response body where that endpoint actually returns them (verified per-endpoint against the real API, not assumed uniform across all six).
- FR-299: Never logs or stores prompt/completion content — only the metadata in §3's `AiUsageEvent` shape. This is an operational/cost concern, not a second copy of what `ModerationFlag`/`AuditLog` already retain for their own, different reasons.

**Feature kill switches (FR-300..FR-301)**
- FR-300: Five new env vars, all defaulting to `true` in `.env`/`.env.example` (so existing behavior is completely unchanged unless an operator explicitly flips one): `AI_SEARCH_ENABLED`, `AI_ONBOARDING_ENABLED`, `VOICE_CALLS_ENABLED`, `VIDEO_CALLS_ENABLED`, `PUBLIC_SAFETY_SHARE_ENABLED`. A small `FeatureEnabledGuard` (parameterized by env-var name, mirroring `AdminGuard`'s shape) applied to: `AiSearchController` (all three routes) for `AI_SEARCH_ENABLED`; `ConversationalSetupController` (all five routes) for `AI_ONBOARDING_ENABLED`; `CallController`'s `start` route for `VOICE_CALLS_ENABLED`/`VIDEO_CALLS_ENABLED` (checked against the real `type` in the request body, not both unconditionally); `DateShareController`'s create route for `PUBLIC_SAFETY_SHARE_ENABLED` (read/list/delete stay available regardless, so an operator can disable *new* shares without breaking already-shared links).
- FR-301: A disabled feature returns a real RFC 7807 503 (`type: about:blank`, a clear `detail` naming which capability is administratively disabled) — the same shape this codebase already uses for "can't serve this right now," distinguished from a vendor-down 503 only by its `detail` text, not a different status code (no new client-side branch needed to tell the two apart at the HTTP-status level, though the message differs).

**Structured match explanation (FR-302..FR-307)**
- FR-302: `MatchExplanationProviderInterface.generate()` returns `{reasons: string[], mismatches: string[]}` instead of a bare `string`. `checkGrounded()` validates every claim across *both* arrays against the same `MatchExplanationFacts` — a fabricated mismatch is exactly as much a hallucination risk as a fabricated reason, and must be checked identically.
- FR-303: `MatchExplanationService.generate()` returns `{reasons: string[], mismatches: string[]} | null` — unchanged fail-open posture; a grounding failure discards the whole result (not a partial "keep the grounded half"), matching the existing all-or-nothing precedent.
- FR-304: `mismatches` may legitimately be empty (`[]`) for a strongly-aligned pair — this is not an error state, and grounding a real pair should be able to produce zero mismatches without being treated as a failure.
- FR-305: `SwipeService` (Super Like path) and `MatchService` (lazy-generate-on-read path) both store `matchReasons`/`matchMismatches`/`explanationGeneratedAt` instead of `whyYouTwo` — `explanationGeneratedAt !== null` is the new "don't regenerate" check, replacing `whyYouTwo !== null`.
- FR-306: `GET /v1/discovery/matches` response shape changes from `whyYouTwo: string | null` to `matchReasons: string[], matchMismatches: string[]` (empty arrays, not null, when nothing has been generated yet — `explanationGeneratedAt` is the caller-visible signal for "has this even been attempted," included in the response too).
- FR-307: Every existing test asserting on `whyYouTwo` is updated to the new shape, not left broken — `docs/roadmap.md`'s "existing tests must continue to pass" standard applies to this rewrite exactly as it would to any other change.

### 5. Security

- Provenance/usage/eval data never includes prompt or completion text — metadata only (FR-289, FR-299), matching this project's existing "don't log OTPs/tokens/raw sensitive content" posture.
- `MatchFeedback` is participant-gated the same way every other match-scoped resource in this codebase already is (FR-293) — no new authorization pattern invented.
- Kill switches default *on* (FR-300) specifically so this feature cannot be the thing that silently disables a real capability in an environment that forgot to set a new env var — the opposite of a fail-safe default would be a real regression risk for every environment that doesn't yet know these vars exist.
- `ProfileAttributeProvenance`/`MatchFeedback` cascade-delete with their owning `User`/`Match` row (`onDelete: Cascade`), consistent with every existing table except the deliberate `AuditLog` exception. `AiUsageEvent.userId` is `SetNull` instead — real operational cost/latency data reasonably outlives the user it was attributed to (similar spirit to `AuditLog`'s survival, though this is not a compliance record and the row itself, minus the user link, is what's kept — not the same mechanism, not claimed to be).

### 6. Acceptance criteria

- [x] A real `PATCH /v1/profile` write creates/updates real `ProfileAttributeProvenance` rows with `source: 'USER_ENTERED'`, confirmed by reading them back directly, not assumed from the write succeeding. — Verified 2026-08-23 against a freshly-restarted server: real user A's onboarding `PATCH /v1/profile` produced 5 real rows (`displayName`, `birthDate`, `bio`, `datingIntent`, `gender`), all `source: USER_ENTERED`, read back directly from Neon. Also now covered by 3 new real unit-test assertions in `profile.service.spec.ts` (`recordMany` called with the exact written-field list, source, and confidence map).
- [x] A real conversational-setup confirm creates a real `ProfileAttributeProvenance` row with `source: 'USER_CONFIRMED'` and a real, non-null `confidence` from the actual extraction call. — Verified 2026-08-23: a real text turn ("من در تهران زندگی می‌کنم") produced a real extraction with `confidence: 0.9`; confirming it wrote a `ProfileAttributeProvenance` row with `field: city`, `source: USER_CONFIRMED`, `confidence: 0.9`, read back directly from Neon.
- [x] `docs/data-classification.md` exists and covers every field flagged in `docs/architecture-review-v2.md` §F/§B.
- [x] A real AI-search call returns a `matchScore` with `version: 'MATCH_ALGORITHM_V1'` and a `semanticSimilarity` in `[0,1]` that is verifiably derived from the real distance value (not a placeholder). — Verified 2026-08-23: a real `POST /v1/discovery/ai-search` call against real embeddings returned per-candidate `matchScore.semanticSimilarity` values in `[0,1]` (e.g. `0.582`), each distinct per candidate (proving derivation from real per-candidate distance, not a constant), `version: MATCH_ALGORITHM_V1`.
- [x] A real match-feedback POST persists and is idempotent-on-repeat (upsert, not a duplicate-row error); a non-participant gets 403/404 exactly like every other match-scoped resource. — Verified 2026-08-23: real POST with `VERY_RELEVANT` then a second real POST with `NOT_RELEVANT`/`LOCATION` on the same match preserved `createdAt` and advanced `updatedAt` (real upsert, not a duplicate row); a third, unrelated real user got a real `403 Not a participant of this match`; a POST to a random UUID got a real `404 Match not found`.
- [x] Both AI-eval scripts run for real against the real OpenAI account and print a real accuracy number — not asserted to be perfect, just real and reproducible. — Run for real: conversational-extraction 7/8 field accuracy (87.5%), 4/4 value accuracy (100%); ai-search-extraction 11/12 dimension accuracy (91.7%). Full results and the real hallucination finding in `docs/ai-evaluation.md`.
- [x] A real OpenAI call (at least one per provider) produces a real `AiUsageEvent` row with real latency and, where the endpoint returns it, real token counts. — Verified 2026-08-23: querying real `AiUsageEvent` rows directly shows all 7 real `(feature, provider, model)` combinations recorded across this session's real calls — `embedding`/`text-embedding-3-small`, `moderation`/`omni-moderation-latest`, `match-explanation-generate` + `match-explanation-grounding-check`/`gpt-4o-mini`, `conversational-extraction`/`gpt-4o-mini`, `ai-search-extraction`/`gpt-4o-mini`, `transcription`/`whisper-1` — covering all 6 provider classes, with real latency and (where the vendor returns them) real token counts.
- [x] Toggling each kill switch off for real (env var, not a code change) makes its gated endpoint(s) return a real 503 with a clear `detail`; toggling back on restores normal behavior — verified directly, not assumed from the guard's code alone. — Verified 2026-08-23 end-to-end for `AI_SEARCH_ENABLED` (representative of the shared `FeatureEnabledGuard` factory used by all 5 switches, plus `FeatureEnabledGuard`'s own 4 unit tests for the other paths): set `AI_SEARCH_ENABLED=false` in `.env`, killed and restarted the real server, real `POST /v1/discovery/ai-search` returned a real `503 {"detail":"AI Prompt Search is temporarily disabled."}`; reset to `true`, restarted again, the same real call returned a normal `201` with real candidates.
- [x] A real Super Like and a real lazy "Why You Two?" read both produce real, grounded `matchReasons`/`matchMismatches` arrays; a deliberately fabricated mismatch (mirroring Feature 10's existing fabricated-reason test) is caught and discarded by the extended grounding check. — Lazy-read path verified live 2026-08-23: `GET /v1/discovery/matches` for a real match with `explanationGeneratedAt: null` lazily generated real `matchReasons` ("Both are 35 years old", "Both are looking for a serious relationship") and set a real `explanationGeneratedAt`. Super Like path and the fabricated-mismatch grounding-discard are covered by the real (no-mock) `match-explanation-boost.e2e-spec.ts`, 10/10 passing, including the new FR-302 test asserting the grounding check discards a deliberately fabricated mismatch the same way it already did for fabricated reasons.
- [x] The full backend unit suite and every e2e suite touching `Match`/`whyYouTwo` (`match-explanation-boost.e2e-spec.ts`, and any other file asserting on the old field) pass clean after the rewrite — confirmed by actually running them, not assumed from the type-checker alone. — Unit suite: 49/49 suites, 404/404 tests (`npx jest --silent`), including the 3 new provenance-assertion tests added this pass. Grepped the entire `test/` directory for every new Feature 21 term (`whyYouTwo`, `aiExplanation`, `matchReasons`, `matchMismatches`, `explanationGeneratedAt`, `ProfileAttributeProvenance`, `matchScore`, `MatchFeedback`, `AiUsageEvent`, `FeatureEnabledGuard`, the 5 kill-switch env names) — only `match-explanation-boost.e2e-spec.ts` matches, and it passed 10/10 both in isolation and inside a full whole-repo e2e run. That full run initially surfaced 4 failing suites, none actually caused by this feature, and both underlying issues were then found and permanently fixed per the user's explicit follow-up request (see `docs/roadmap.md`'s "Known infrastructure debt" for the full writeup): (1) `discovery.e2e-spec.ts`, `report-block.e2e-spec.ts`, and one ranking test in `ai-search.e2e-spec.ts` failed on the same accumulated-real-test-data pagination-assumption mechanism as the Smart Boost bug found earlier this session — fixed by centralizing a real `test/helpers/paginate-to-exhaustion.ts` helper (matching the existing `unique-phone.ts`/`vendor-failure.ts` precedent) and applying it everywhere a deck/search snapshot assertion depends on finding a specific candidate, plus rewriting the one test that had asserted an unsustainable "global #1 result" claim into the durable relative-ranking claim FR-111 actually requires. (2) `storage.e2e-spec.ts` (5 failures) turned out not to be credential drift as first suspected — direct investigation found MinIO (and, this time, also `clamd` and the backend dev server) had simply stopped running, the same known local-dependency-outage pattern first documented during Feature 8; restarting both with their existing, unmodified config and root credentials fixed it immediately. **Final, fully clean run after both fixes**: whole-repo e2e regression, all suites passing (see the run logged in `docs/architecture.md` §5.15 for the exact numbers).

### 7. Open items (explicit decisions made while implementing — flagged, not guessed silently)

1. **`whyYouTwo`'s replacement is a clean schema swap, not an additive-with-deprecation change** — see §2 above for the full reasoning (no real external consumer exists yet). Flagged explicitly in case this read is ever wrong (e.g. if a since-forgotten external integration reads this column directly) — nothing in this codebase's own client set does.
2. **Kill-switch granularity stops at the five capabilities named in the master directive** — no per-user or percentage-rollout targeting, matching the directive's own explicit "no over-engineered feature-flag platform" instruction. If gradual rollout is ever wanted, that's a real, separate decision.
3. **`AiUsageEvent` cost estimation uses a static, hardcoded per-model rate table**, not a live pricing API — OpenAI's published per-model token pricing, checked at implementation time and recorded as a comment citing the source, accepted as something that will need a manual update if OpenAI's pricing changes, same maintenance posture as any other hardcoded reference value in this codebase.
4. **Eval framework ships with 2 of 7 named domains populated for real** (conversational extraction, AI-search extraction) — the other five (match ranking, match explanation, moderation, translation, speech recognition) are named and structured in `docs/ai-evaluation.md` but not populated, since populating all seven with meaningful synthetic fixtures is real, separate work each domain deserves on its own, not something to rush to hit a count.
5. **A real, root-caused hallucination finding surfaced by actually running the eval framework, not anticipated when it was designed.** The conversational-extraction eval's one real failure (an off-topic message, "the weather is nice today," produced a hallucinated `city: "تهران"` proposal) reproduced 1-in-5 on direct repeat-trial — a genuine, low-frequency, non-deterministic vendor failure mode, not a harness bug. `ConversationalSetupService`'s confirmation gate (§D) means this can never silently reach a real profile, but the hallucinated proposal carried the same high `confidence` (0.8) a correct extraction would — meaning **FR-287's `confidence` field is not a reliable hallucination detector for this path** and should not be read as one. Full root-cause trail and the honest caveat in `docs/ai-evaluation.md`. Not fixed here — the fix would be a `MatchExplanationService`-style independent grounding check for conversational turns, which is real, separate, deferred work (tracked in `docs/roadmap.md`), not something to bolt on inside this already-large feature.

---

## Feature 22: Settings Depth + AI Voice Recording UX (Frontend)

**Status:** Implemented and verified. Approved by the user with three explicit decisions (blocked-users gap stays documented-only, legal links stay placeholder, the non-blocking hint interpretation confirmed) before implementation began.

**Depends on:** Feature 5 (`POST /users/:userId/block`, `POST /users/:userId/report`, `POST /chat/:matchId/block` — the real, currently-existing backend safety surface, re-confirmed by reading `safety.controller.ts`, `chat.controller.ts`, `user-safety.service.ts`, `block.service.ts` directly for this feature, not assumed from the Feature 5 doc alone), Feature 9/11 (`AiSearchController`, `ConversationalSetupController` — the two real voice-input backends this feature's UX changes sit in front of, unchanged), Feature 15/16 (`components/profile/conversational-setup.tsx`, `components/discovery/ai-search.tsx`, and the shared `lib/hooks/use-voice-recording.ts` hook both already call into — the two real, only call sites this feature touches), Feature 20 (`app/(tabs)/settings/page.tsx`, `PrivacySection`/`NotificationsSection`/`LogoutButton`/`DeleteAccountFlow` — the real, currently-shipped settings screen this feature extends, not replaces).

### 1. What already exists vs. what this feature adds

**Already exists, unchanged:**
- The real Settings screen (Feature 20): one scrollable page with Privacy, Notifications, and Account (logout, delete) sections only (`app/(tabs)/settings/page.tsx`, confirmed by reading it directly for this feature) — no Help Center, no blocked-users view, no legal-document links, no dedicated safety-tips page anywhere in the app.
- Safety is real but confined to one entry point: `SafetySheet` (`components/chat/safety-sheet.tsx`), reachable only from inside an open conversation via the shield icon in the chat header — block and report both work for real from there, but there is no equivalent reachable from Settings, matching the user's own stated premise exactly.
- The block *write* path is real and works today, from two real entry points: `POST /users/:userId/block` (direct, Feature 5's own FR-71 addition) and `POST /chat/:matchId/block` (match-scoped, FR-64) — both call the same `BlockService.block()`, an idempotent upsert into the real `Block` table (`blockerId`, `blockedId`, `@@unique`).
- Voice input is real and works today in exactly two places, both built on one shared hook: `lib/hooks/use-voice-recording.ts`'s `useVoiceRecording(onDone)` — a real `MediaRecorder`/`getUserMedia` wrapper exposing only `{isRecording, toggle}`. `components/discovery/ai-search.tsx` (Feature 16) and `components/profile/conversational-setup.tsx` (Feature 15) each render an identical mic `<button>`: solid rose when `isRecording`, solid `--surface` otherwise, `disabled` (just a lowered `opacity-50`, same visual treatment as any other disabled button) while the follow-up transcription call (`transcribeMutation`/equivalent) is in flight. No pre-recording guidance text, no live recording animation beyond the static color swap, and no state visually distinct from "disabled" during processing — confirmed by reading both call sites directly, not assumed to be identical from one alone.

**Missing — what this feature adds:**
- **No "block list" or "unblock" backend endpoint exists at all** — checked directly, not assumed: `BlockService` (`backend/src/modules/safety/block.service.ts`) exports exactly three methods, `block()`, `isBlocked()`, `hasBlocked()` — no `unblock()`, no `listBlocked()`/`findByBlocker()`, and neither `SafetyController` nor `ChatController` exposes a `GET` or `DELETE` route anywhere near `block`. This is a real, complete backend gap, not a partial one — there is no way, today, for a user to see who they've blocked or reverse a block, through the API or otherwise. **Per explicit user instruction, this feature does not build the Blocked Users list or an unblock action** — it is documented as a gap (§4, §11) and left for a future backend feature to close, not silently worked around or half-built against a nonexistent endpoint.
- **The privacy-policy source the user named does not exist.** `docs/hamava-privacy-policy-draft.md` — checked directly (`ls docs/`) — is not a real file in this repo. The closest real document is `docs/legal-checklist.md`, which is explicitly a checklist of *what still needs to be done* (its own first line under Part B: "Draft a full GDPR-compliant Privacy Policy") — i.e. confirmation that a real privacy policy has not been drafted yet, not a mislabeled copy of one. Same for Terms of Service — no draft of any kind exists anywhere in `docs/`. **This feature defaults to the user's own explicitly-offered fallback**: both links render a real, working "به‌زودی" (coming soon) placeholder page rather than raw-rendering a file that doesn't exist — flagged here explicitly in case the user actually has this content somewhere outside the repo and wants it wired in instead (§11 Open Items #1).
- No Help Center of any kind exists — not a page, not a link, not a FAQ list, anywhere in the app.
- No dedicated Safety & Security page exists — every piece of safety-relevant UI today is transactional (the block/report sheet), never educational/preventive.
- No pre-recording guidance, live recording animation, or distinct post-recording processing state exists for either of the two real voice-input call sites (§ above) — both currently give the user no feedback beyond "the mic button changed color" while actually recording, and nothing beyond "the button looks disabled" while waiting on transcription.

### 2. Goal

Two independent, unrelated improvements bundled into one feature at the user's own request: (1) give Settings the structural depth a real dating app needs before wider testing — a visible Help Center, an honest accounting of the block-list gap, real (even if placeholder) legal links, and a dedicated safety-education page — inspired by, not copied from, Bumble/Hinge's own settings depth; (2) make the two existing AI voice-input flows (AI Prompt Search, Conversational Profile Setup) feel alive and legible while recording and processing, instead of a static button that silently changes color.

### 3. In scope

- Help Center: a real, dedicated, reachable-from-Settings page with a fixed set of placeholder FAQ entries. FR-308..FR-310.
- Blocked-users backend gap: investigated and explicitly documented, not built. FR-311.
- Legal links: Privacy Policy / Terms of Service entries in Settings, each opening a real placeholder "coming soon" page. FR-312..FR-314.
- Safety & Security: a real, dedicated, reachable-from-Settings page with concrete, feature-referencing safety guidance (not generic filler). FR-315..FR-317.
- `useVoiceRecording`'s public shape extended to support a live, three-state UX (idle/recording/processing) without duplicating recorder logic at either call site. FR-318..FR-320.
- Applying the new voice UX to AI Prompt Search (`ai-search.tsx`). FR-321..FR-322.
- Applying the new voice UX to Conversational Profile Setup (`conversational-setup.tsx`). FR-323..FR-324.
- Page-state, accessibility, and testing, reusing this project's established patterns. FR-325..FR-327.

### 4. Explicitly out of scope for this feature

- **The Blocked Users list page and any unblock action** — no backend endpoint exists for either (§1); building a frontend page against a nonexistent API, or silently repurposing an unrelated endpoint, would both be worse than not building it. Tracked as a real, named gap in `docs/roadmap.md`, for a future backend feature to close (list + unblock endpoints, then this feature's own deferred frontend half).
- **Final, real Privacy Policy / Terms of Service content** — explicitly deferred by the user's own framing of this request ("نه ساختن محتوای نهایی الان"); `docs/legal-checklist.md` already tracks drafting these as real, separate, lawyer-involved work.
- **Real Help Center content** (a CMS, searchable articles, a support-ticket flow) — the user explicitly asked for "چند سوال متداول ثابت... بعداً محتوای واقعی جایگزین بشه" (a fixed set of FAQs now, real content later); this feature ships exactly that, not a content platform.
- **Any change to `MediaRecorder`/`getUserMedia` capture behavior itself** (audio format, bitrate, silence detection, max-duration enforcement) — this feature is presentation-layer only; `AI_SEARCH_MAX_AUDIO_BYTES`/`CONVERSATIONAL_SETUP_MAX_AUDIO_BYTES` and every other real recording constraint (Feature 9/11, backend) are untouched.
- **A push-to-talk or hold-to-record interaction model** — out of scope; the existing tap-to-toggle interaction (FR-253's own original decision, Feature 15) is preserved exactly; only the *feedback* around it changes.

### 5. User flow

**Settings depth:**
1. From `/settings`, a new "پشتیبانی و ایمنی" (Support & Safety) section appears between Notifications and Account, with three real, tappable rows: "مرکز کمک" (Help Center), "امنیت و ایمنی" (Safety & Security), and, further down near Account, a small "قوانین و حریم خصوصی" (Legal) row exposing the two legal links.
2. "مرکز کمک" opens `/settings/help` — a real, dedicated page listing the fixed FAQ set as an accordion (one open at a time).
3. "امنیت و ایمنی" opens `/settings/safety` — a real, dedicated page with concrete safety guidance, including a real, working link back into Share My Date (Feature 19) where relevant.
4. Tapping "Privacy Policy" or "Terms of Service" opens its own real placeholder page (`/settings/privacy-policy`, `/settings/terms`) stating plainly that the real document isn't published yet.
5. (Documented, not built) A user who wants to see or reverse a block currently has no way to do so anywhere in the app — the gap is named directly in the Safety & Security page's own copy (§6.4) rather than hidden, so this isn't a silent dead end the user discovers on their own.

**AI voice UX (both call sites, identical pattern):**
1. The user taps the mic button. Recording starts immediately (unchanged interaction — no added confirmation step, §4), and a real, short-lived guidance hint appears next to the button for the first few seconds of recording ("بگو دنبال چه کسی می‌گردی" for AI Search, "از خودت بگو" for Conversational Setup), then fades — guidance appears *as* recording begins, not as a blocking step the user must dismiss before recording can start (§11 Open Items #2 states this interpretation explicitly, flagged for review).
2. While recording, the mic icon itself visibly pulses/animates (a real CSS animation keyed off `status === "recording"`) instead of only swapping to a static rose fill.
3. On tapping again to stop, the button immediately shows a real, distinct "در حال پردازش…" (processing) state — new icon/spinner + label, not just a disabled, dimmed version of the idle button — for exactly as long as the real transcription call (`transcribeMutation`/equivalent) is in flight, then resolves into the existing post-transcription UI (the editable-draft panel for AI Search, the next conversational turn for Setup) unchanged.

### 6. Functional requirements

#### 6.1 Help Center
- FR-308: A new `app/(tabs)/settings/help/page.tsx` route, reachable only via a new row in `/settings`'s new "پشتیبانی و ایمنی" section (matching Feature 20's own single-entry-point convention for every other settings action).
- FR-309: A fixed, hardcoded array of FAQ entries (question + answer, Persian, real dating-app-relevant content — e.g. how matching/AI search works, how verification works, how to report or block someone, how account deletion works, how to reach support) rendered as an accordion — no backend call, no `GET` endpoint invented for this (the user's own explicit "ثابت برای الان" framing).
- FR-310: Each FAQ entry is independently expandable/collapsible (one or many open at once — a plain accordion, not a strict single-open-at-a-time radio pattern, since these are independent questions with no relationship to each other), keyboard-operable, and marked up so the question is a real heading (screen-reader outline stays meaningful).

#### 6.2 Blocked-users gap (documented, not built)
- FR-311: **No frontend code is written for this.** `docs/roadmap.md` gains a new, explicit entry naming the real gap (§1) — no `listBlocked()`/`unblock()` backend methods, no list/unblock routes on either `SafetyController` or `ChatController` — as a known limitation, with the two concrete backend additions a future feature would need to close it (a `GET /v1/users/me/blocks` list endpoint and a `DELETE /users/:userId/block` or equivalent unblock endpoint, both straightforward extensions of the existing `Block` table/`BlockService`, per this investigation). The Safety & Security page (§6.4) states the same gap honestly in its own user-facing copy, rather than presenting a safety page that quietly omits a control users may reasonably expect to find there.

#### 6.3 Legal links
- FR-312: A new "قوانین و حریم خصوصی" row group in Settings (Account section, above or below Logout — a non-destructive, informational pair, so not grouped with Delete Account) with two entries: "حریم خصوصی" and "قوانین و مقررات."
- FR-313: Both open a real, dedicated route (`/settings/privacy-policy`, `/settings/terms`) rendering a shared `ComingSoonPlaceholder` component — plain, honest copy stating the real document isn't published yet, with a way back to Settings — never a broken link, a silent no-op, or content invented to fill the gap.
- FR-314: If real source content becomes available later (§1's flagged discrepancy — the file the user named doesn't exist yet), swapping the placeholder for a real raw-markdown-rendered page is a contained change to these two route files only — no other part of this feature depends on the content existing.

#### 6.4 Safety & Security page
- FR-315: A new `app/(tabs)/settings/safety/page.tsx` route, reachable via the new "امنیت و ایمنی" row in Settings.
- FR-316: Real, concrete, feature-referencing guidance — not generic "be careful" filler — covering at minimum: meeting in a public place for a first date, using the real Share My Date feature (Feature 12/19, with a real, working link into `/settings` → back to a match's own share-creation flow, or a plain textual pointer to it if a direct deep link is impractical) to share date details with a trusted contact, doing a video call before meeting in person, trusting one's own judgment and disengaging if something feels wrong, and how to report or block a user today (a real, working link back to opening a conversation's own `SafetySheet` is impractical outside a conversation's context — this page instead names exactly where those controls live, e.g. "توی هر مکالمه، از آیکون سپر بالای صفحه می‌تونی گزارش یا بلاک کنی").
- FR-317: The same page states honestly, in its own copy, that there is currently no way to view or reverse a block from Settings (§6.2's real gap) — a deliberate, explicit acknowledgment rather than an omission a user could mistake for the control simply being hard to find.

#### 6.5 Shared voice-recording UX (`useVoiceRecording`)
- FR-318: `useVoiceRecording`'s return shape gains a derived `status: "idle" | "recording" | "processing"` — computed from the hook's existing internal `isRecording` plus one new required argument, `isProcessing: boolean`, that each call site passes in from its own existing mutation's `isPending` (`transcribeMutation.isPending` at both current call sites) — the hook still owns only real `MediaRecorder`/`getUserMedia` state, never reaching into either call site's own React Query mutation object, matching the existing separation of concerns (§1) exactly.
- FR-319: A new, small `useVoiceRecordingHint(status, hintText)` (or equivalent inline logic, implementation's own call) drives the guidance-text visibility: the hint becomes visible the instant `status` transitions from `"idle"` to `"recording"`, and auto-hides after a fixed, real duration (proposed: 4 seconds — flagged as a placeholder, tunable, not a data-driven figure, §11 Open Items #3) or immediately if `status` leaves `"recording"` first, whichever is sooner.
- FR-320: No change to `MediaRecorder`/`getUserMedia` call sequencing, audio format, or the `onDone(blob)` contract — `status`/hint logic is additive, derived state only, never altering when recording actually starts or stops.

#### 6.6 AI Prompt Search voice UX
- FR-321: `ai-search.tsx`'s mic button renders per `status`: `"idle"` — unchanged static button; `"recording"` — the existing rose fill plus a real CSS pulse animation (e.g. an animated box-shadow ring, respecting `prefers-reduced-motion` per FR-326) plus the FR-319 hint bubble ("بگو دنبال چه کسی می‌گردی") anchored next to the button; `"processing"` — button becomes non-interactive with a real spinner replacing `MicIcon` and adjacent text "در حال پردازش…", visually distinct from the plain `disabled`+`opacity-50` treatment every other disabled button in this codebase uses (so a user can tell "busy because it's working" apart from "unavailable").
- FR-322: The existing `rateLimited`/`vendorFailure` error surfaces (already real, §1) are unchanged by this feature — the new `"processing"` state is purely additive visual feedback for the already-real in-flight period, not a new error or success path.

#### 6.7 Conversational Profile Setup voice UX
- FR-323: `conversational-setup.tsx`'s mic button gets the identical three-state treatment as FR-321, with its own distinct hint text ("از خودت بگو") — the same shared hook/derived-`status` mechanism (FR-318), not a second, parallel implementation.
- FR-324: No change to `conversational-setup.tsx`'s own turn/transcript/proposal-confirmation flow (Feature 15's real "AI proposes, human confirms" pattern) — this feature touches only the mic button's own visual states.

#### 6.8 Page-state, accessibility, testing
- FR-325: Help Center and Safety & Security both use the shared `SkeletonLine`/`ErrorState`/`EmptyState` components where applicable (neither has a real network call to fail against — FR-309/FR-316 — so in practice this means: nothing to skeleton-load, but the same visual language for the "back to settings" affordance as every other sub-page).
- FR-326: The FR-321/FR-323 pulse animation respects `prefers-reduced-motion: reduce` (a static "recording" indicator — e.g. a solid ring, no motion — substituted automatically), matching this project's existing accessibility standard (Feature 14 FR-222 and every frontend feature since). WCAG 2.1 AA elsewhere: full keyboard operability of the FAQ accordion and both new settings rows; the "processing" state is conveyed by text, not spinner-color alone.
- FR-327: Playwright e2e: a real visit to `/settings` shows the three new rows (Help Center, Safety & Security, Legal); each new sub-route renders its real content and a working "back" affordance; the FAQ accordion actually expands/collapses on a real click. **Correction made before implementation, from directly reading `playwright.config.ts`/`discovery.spec.ts`/`profile.spec.ts` rather than assuming: this codebase has no `MediaRecorder`/`getUserMedia` JS-mock precedent at all.** The real, existing mechanism is `playwright.config.ts`'s already-global `--use-fake-device-for-media-stream`/`--use-fake-ui-for-media-stream` launch flags (Feature 18 FR-377) — every test in this suite already gets a real (silent, synthetic) media stream with auto-granted permissions, no per-test mocking needed. The existing voice-search/voice-turn tests test transcription *content* via a direct `POST /v1/discovery/ai-search/transcribe` API call instead of the UI mic button specifically because meaningful, recognizable speech requires the separate `--use-file-for-fake-audio-capture` WAV-file flag this machine has no Persian TTS to feed (`discovery.spec.ts`'s own documented exception). This feature's UI state machine (FR-318..FR-324) doesn't depend on speech content at all — only on real start/stop/processing transitions — so it is tested through the real mic button using the already-global fake-device flag (a real, short recording of synthetic silence), asserting the hint text appears on recording start and disappears on the FR-319 timer/early-stop, and that a distinct "در حال پردازش…" state is visible between a real stop and the real (short, cheap) transcription round-trip resolving — real backend throughout, matching FR-255's standing rule, not a new mocking approach.

### 7. Project structure additions

```
frontend/
 ├─ app/(tabs)/settings/
 │   ├─ help/page.tsx                    -- FR-308..310
 │   ├─ safety/page.tsx                  -- FR-315..317
 │   ├─ privacy-policy/page.tsx          -- FR-312..314
 │   └─ terms/page.tsx                   -- FR-312..314
 ├─ components/settings/
 │   ├─ support-safety-section.tsx        -- new row group linking help/safety/legal (§5)
 │   ├─ faq-accordion.tsx                 -- FR-309/310
 │   └─ coming-soon-placeholder.tsx       -- FR-313
 ├─ components/icons/index.tsx            -- extended: HelpIcon, DocumentIcon (new rows need real, distinct icons — ShieldIcon (existing) reused for Safety)
 ├─ lib/hooks/use-voice-recording.ts       -- extended: status derivation (FR-318)
 ├─ components/discovery/ai-search.tsx     -- extended: three-state mic UX (FR-321/322)
 ├─ components/profile/conversational-setup.tsx -- extended: three-state mic UX (FR-323/324)
 ├─ e2e/settings.spec.ts                    -- extended, not a new file: this project's real
 │                                              convention (confirmed by reading e2e/) is one
 │                                              spec per screen area, not per feature number —
 │                                              new Help/Safety/Legal assertions belong here
 ├─ e2e/discovery.spec.ts                   -- extended: AI Search mic voice-UX states (FR-327)
 └─ e2e/profile.spec.ts                     -- extended: Conversational Setup mic voice-UX states (FR-327)
```

### 8. Backend addition

**None.** Every functional requirement in this feature is frontend-only, against endpoints that already exist (§1). The one place a real backend gap was found (blocked-users list/unblock) is deliberately *not* built here, per explicit user instruction — documented in `docs/roadmap.md` instead (FR-311).

### 9. Security requirements (from §5, scoped to this feature)

- No new authenticated endpoint is introduced, so no new authorization surface is added.
- The Safety & Security page must not imply a capability that doesn't exist (FR-317) — stating the blocked-list gap honestly is itself a security-adjacent requirement: a user who believes they can review/reverse blocks from Settings when they actually can't is a real, if minor, trust/safety-UX risk this feature must not create.
- Voice recording's underlying permission model (`getUserMedia`'s own browser-level mic-access prompt) is completely unchanged — this feature never requests, caches, or auto-grants microphone access; the existing tap-to-start-triggers-the-real-browser-prompt behavior (Feature 15's own FR-253) is preserved exactly.

### 10. Acceptance criteria

- [x] `/settings` shows the three new rows (Help Center, Safety & Security, Legal) inside a real, visible "پشتیبانی و ایمنی" section, distinct from Privacy/Notifications/Account. — Verified 2026-08-27 both via direct browser interaction (real login as a seeded user, real page text captured showing all three rows in the right position) and `e2e/settings.spec.ts`'s new test.
- [x] `/settings/help` renders the fixed FAQ set as a real, working accordion — expand/collapse verified by a real click, not assumed from markup alone. — Verified via direct browser click (a real click toggled `aria-expanded` false→true and revealed the answer text) and `e2e/settings.spec.ts` (expand, collapse, both `aria-expanded` states and both visibility states asserted).
- [x] `/settings/safety` renders real, concrete safety guidance referencing Share My Date and the existing block/report location by name, and states the blocked-list gap honestly. — Verified via direct browser page-text capture and `e2e/settings.spec.ts`.
- [x] `/settings/privacy-policy` and `/settings/terms` both render the real placeholder page, not a 404 or a broken link. — Verified via direct browser navigation to both routes and `e2e/settings.spec.ts`.
- [x] A real recording session on `ai-search.tsx`'s mic button shows the guidance hint on start, a real animated (non-static) recording indicator while active, and a distinct "در حال پردازش…" state between stop and the transcription response — verified through the real mic button using this codebase's already-global fake-media-device Playwright flags (§6.8 FR-327's correction), not a new JS-level mock. — `e2e/discovery.spec.ts`'s new test: real `getUserMedia`/`MediaRecorder` start, hint visible, hint gone on stop, "در حال پردازش…" visible and the button real-disabled, then cleared once the real (short) transcription round trip resolved. Passing in isolation and inside the file's full 7-test run (one unrelated pre-existing test in the same run hit a transient `/api/auth/refresh` timeout under sustained combined-run load — the exact documented pattern in `docs/roadmap.md` — confirmed passing clean in isolation immediately after, not caused by this feature).
- [x] The identical three states are verified on `conversational-setup.tsx`'s mic button, with its own distinct hint text. — `e2e/profile.spec.ts`'s new test, same real mechanism, passing both in isolation and inside the file's full 8-test run (8/8 clean).
- [x] `docs/roadmap.md` carries a real, explicit entry for the blocked-users backend gap (FR-311), naming the two concrete endpoints a future feature would need. — Added under "Known infrastructure debt."
- [x] Full backend unit/e2e suites re-verified clean after this feature ships (expected to be a no-op re-verification, since §8 makes no backend changes — still run for real per this project's standing discipline, not skipped on the assumption of "frontend-only, so nothing could break"). — §8 makes zero backend changes (confirmed: no files under `backend/` touched by this feature); frontend-side verification instead: `npx tsc --noEmit` clean (zero errors), `npm run lint` clean (zero warnings/errors), and the three touched/extended e2e spec files (`discovery.spec.ts` 7/7, `profile.spec.ts` 8/8, `settings.spec.ts` 5/5, two transient unrelated flakes both confirmed passing in isolation) all run clean against the real backend.

### 11. Open items (explicit decisions made while drafting — flagged for the user's review before implementation, not guessed silently)

1. **The named source file for Privacy Policy / Terms of Service content, `docs/hamava-privacy-policy-draft.md`, does not exist in this repo** (§1) — this draft defaults to the user's own explicitly-offered fallback (a placeholder "coming soon" page) rather than blocking on it. Flagged directly in case that content exists somewhere outside this repo (a separate doc, a message, a different filename) and the user wants it wired in as real raw-rendered content instead of a placeholder.
2. **The pre-recording hint is read as appearing *alongside* recording start, not as a blocking step the user must acknowledge before recording begins** — the request's literal Persian ("قبل از شروع ضبط... نشون بده") could also be read as a mandatory pre-recording confirmation step. This draft picked the non-blocking interpretation because it preserves the existing, already-shipped tap-to-toggle interaction exactly (§4) rather than adding a second required tap to a flow used at least twice already in this app — flagged explicitly for the user to confirm or correct before implementation.
3. **The hint's auto-hide duration (4 seconds, FR-319) is a placeholder, not a data-driven figure** — matching this project's own established precedent for this exact kind of UX-timing constant (e.g. Feature 13's `FIRST_CALL_DURATION_LIMIT_SECONDS`, Feature 6's rate-limit windows before they were tuned) — tunable without a design change if it reads as too short/long once actually seen running.
4. **The Safety & Security page's Share My Date reference is a textual pointer, not a real deep link**, because Share My Date is created from inside a specific match's own chat header (Feature 19), not from Settings — there is no real, generic "create a share link" entry point Settings could link *to* independent of which match it's for. If this reads as insufficient once built, a real fix would be adding a general entry point to Share My Date itself, which is out of this feature's scope (§4).

### 12. Real findings from implementation and verification (not anticipated in the original draft above)

- **FR-327's original claim about the test mechanism was wrong, caught and fixed before writing the actual test, not after.** The original draft asserted this codebase had an established `MediaRecorder`/`getUserMedia` JS-mock pattern for voice e2e tests. Directly reading `playwright.config.ts`, `discovery.spec.ts`, and `profile.spec.ts` before implementing found no such pattern exists at all — the real, already-global mechanism is Chromium's native `--use-fake-device-for-media-stream`/`--use-fake-ui-for-media-stream` launch flags (Feature 18 FR-377), and the existing voice tests deliberately bypass the UI's mic button for *content* assertions specifically because meaningful speech needs the separate `--use-file-for-fake-audio-capture` WAV flag this machine has no Persian TTS to feed. §6.8/FR-327 and the two related acceptance-criteria bullets were corrected in place before implementation, and the real tests written against the corrected, accurate mechanism.
- **A real, unrelated local-infrastructure outage was found and fixed during verification, not caused by this feature.** The first e2e run (`settings.spec.ts`) failed at the shared `loginAndCompleteProfile()` helper's photo-upload step — investigated directly rather than assumed: MinIO (`GET /minio/health/live` unreachable) and `clamd` (nothing listening on 3310) were both down, the exact same "local dev-only dependency doesn't survive a restart" pattern already documented multiple times in `docs/roadmap.md`'s "Known infrastructure debt." Restarted both (`minio server`, `clamd.exe --config-file=...`) against their existing, unmodified data/config — confirmed healthy, then all three touched e2e files ran clean.
- **Two transient test failures, both in pre-existing, unmodified tests unrelated to this feature's own code, both confirmed passing clean in isolation immediately after** — matching this project's own extensively-documented "sustained combined-run load" flakiness pattern (`docs/roadmap.md`): `discovery.spec.ts`'s boost-activation test hit a `POST /api/auth/refresh` timeout during the file's full 7-test run; `settings.spec.ts`'s `allowInSafetyShares` test timed out waiting for a share link during its file's full 5-test run. Neither touches the mic button, voice recording, or any Settings-depth code this feature added.
- **Real verification, not just "the code looks right"**: every new UI surface (Help Center, Safety & Security, both legal placeholders) was confirmed via direct browser interaction (real login as a seeded test user, real page-text capture, a real accordion click toggling real `aria-expanded` state) before the corresponding e2e assertions were even written — catching the correct shape of real rendered content, not asserting against an assumption.

---

## Feature 23: Visual Design-System Compliance Audit + Remediation (Frontend)

**Status:** Audited and fixed. All 21 screens captured, viewed, and compared against `docs/design-system.md`; findings recorded in `docs/visual-audit-findings.md`; confirmed fixes re-verified with after-screenshots and a full functional regression pass.

**Depends on:** `docs/design-system.md` (the sole source of truth this audit checks against — every criterion below cites a specific section of it, nothing is invented for this feature), Features 14–22 (every real screen this feature audits).

### 1. Why this feature exists

The user's own direct assessment: the app's current look reads as "plain and unprofessional," at odds with `docs/design-system.md` — a document written *before* Feature 14's first line of code specifically to prevent that outcome (its own opening line: "the goal is a visual identity no other app has, not a shadcn/ui default with Hamava's colors swapped in"). This feature does not start from that assessment as a given — it verifies it, screen by screen, against the actual written spec, the same evidence-based discipline this project applies to every other kind of claim (`docs/roadmap.md`'s standing verification standard, extended here from backend behavior to visual output).

### 2. What "compliance" means here — the checklist, defined once

Every screen in §3 is checked against the same eight lettered criteria, each tracing to a specific `design-system.md` section — no criterion is invented for this feature that the design system doesn't already state:

- **(A) Typography (§2)** — computed `font-family` resolves to Vazirmatn, not a fallback/system font; heavy weights (800/900) appear *only* on app identity or screen-level titles, never body text, buttons, or chips (§2's own "rule, not suggestion").
- **(B) Palette discipline (§1.1)** — every visible color is one of the nine defined tokens (or a documented `rgba()` tint of one) or the two accessibility-safe text tokens (§7) — no shadcn/Tailwind default (`gray-*`, a generic `blue-*` focus ring, default `border`/`ring` CSS variables left unmapped to Hamava's own tokens) visible anywhere.
- **(C) Signature gradient (§1.2)** — appears *only* on its closed list of surfaces (brand mark, verified-photo ring, liveness-complete confirmation, the match-moment animation, a not-yet-built premium badge) and is genuinely present and correctly rendered on each one of those surfaces that exists today — flagged both ways: present somewhere it shouldn't be, or missing somewhere it should.
- **(D) Icon system (§3)** — every brand-facing icon (like, chat, safety, location, call, verified, and every icon Features 15–22 added since — filters, settings gear, search, mic, video, share, copy, help, document, star, bolt, user, back, close, plus, trash, edit) is the custom 24×24/1.5px-stroke/round-cap/girih-angle set, not `lucide-react` or another generic library — the one explicit exemption is shadcn's own internal component chrome (§3.1: a `Dialog` close glyph, a `Select` chevron), not anything user-facing.
- **(E) Photo treatment (§4.2/4.3)** — the verified-photo-frame signature-gradient ring appears on every verified user's photo wherever shown (deck cards, match cards, conversation header), correctly absent (not present-but-dim) on unverified photos; the bottom-gradient legibility overlay, not `text-shadow` alone, is used wherever text sits over a photo.
- **(F) Motion (§5 + general)** — the real match-moment animation (choreography per §5's three-beat timing) fires on a real first-time match view and only there; any other place `docs/design-system.md` implies motion (the prototype's card-swipe easing curve referenced in §5) is checked for whether it was actually carried into the real implementation or silently dropped.
- **(G) Accessibility contrast (§7)** — spot-checked per screen: no new use of `--text-faint` outside its one documented WCAG-exempt case (Feature 14's disabled-button text); real measured contrast, not assumed, for any text/background combination that looks borderline.
- **(H) Elevation (§1.3, added before this audit began, per explicit user decision — see §8 Open Items #1's resolution)** — every card, sheet, modal, and primary CTA uses one of §1.3's four real, visually-verified glow-based levels (`--elevation-1/2/3`, `--elevation-cta-turquoise/-rose/-gold`) — never a plain, unstyled default (a shadcn primitive's own default shadow, a bare `border` with no lift at all where one of the four levels applies) and never a conventional dark drop-shadow (confirmed, by the same live-preview process §1.3 itself documents, to read as nearly invisible against this palette).

### 3. In scope — every real screen/state to be screenshotted and audited

All 21 states below are real, reachable routes or component states in the current codebase (confirmed by reading `frontend/app/**/page.tsx` directly, not assumed) — no page is invented or renamed for this audit.

| # | Screen | Route / trigger | Setup precondition |
|---|---|---|---|
| 1 | Login — phone entry | `/login` | Fresh, unauthenticated tab |
| 2 | Login — OTP entry | `/login`, after phone submit | Same |
| 3 | Login — liveness consent | `/login`, after OTP verify | A user with `livenessStatus: false` |
| 4 | Profile — choice screen | `/profile` | A brand-new user, no profile yet |
| 5 | Profile — manual form (فرم دستی) | `/profile`, "فرم دستی" chosen | Same |
| 6 | Profile — conversational setup (گفتگو با هوش مصنوعی) | `/profile`, "گفتگو با هوش مصنوعی" chosen | Same |
| 7 | Discovery — swipe deck | `/` | A profile-complete user with real candidates in their deck |
| 8 | Discovery — filters panel | `/`, filters icon | Same |
| 9 | Discovery — AI Prompt Search | `/`, "جست‌وجوی هوشمند" tab | Same |
| 10 | Discovery — in-deck match confirmation | `/`, after a real mutual swipe | Two real users, a fresh mutual like |
| 11 | Matches — list | `/matches` | A user with ≥1 real match |
| 12 | Match — chat (already opened before) | `/matches/:matchId` | A match already viewed once |
| 13 | Match — signature match-moment animation | `/matches/:matchId`, **first-ever** open | A brand-new, never-opened real match |
| 14 | Call — in-call screen | Overlay (no dedicated route — `InCallScreen`, `app/(tabs)/layout.tsx`) | Two real users, a real active call between them |
| 15 | Settings — main | `/settings` | Any profile-complete user |
| 16 | Settings — Help Center | `/settings/help` | Same |
| 17 | Settings — Safety & Security | `/settings/safety` | Same |
| 18 | Settings — Privacy Policy placeholder | `/settings/privacy-policy` | Same |
| 19 | Settings — Terms placeholder | `/settings/terms` | Same |
| 20 | Share My Date — create/manage sheet | Inside a conversation, "اشتراک‌گذاری قرار" | A real match with an open conversation |
| 21 | Share My Date — public page | `/date/:token` | A real, active share link, unauthenticated tab |

**Test data:** reuses the real 20 seed users (`docs/test-users.md`) and their 5 real existing matches wherever a specific relationship (a match, a conversation) is needed — no new seed data invented for this feature, matching `docs/roadmap.md`'s just-added "Dev database hygiene" note (a clean run, not adding to the pollution it describes). Screens needing an active, transient state (#10 match confirmation, #13 first-open animation, #14 an active call, #20/#21 a live share link) are captured by driving the real flow via Playwright immediately before the screenshot, not by trying to catch one that happens to exist.

### 4. Explicitly out of scope

- **Inventing new colors, icons, gradients, or animations not already specified in `docs/design-system.md`.** This is a compliance audit against the existing spec, not a redesign — every fix in §6 makes a screen match what §1–§5 already say, never introduces a new token or asset the design system doesn't define.
- **A spacing scale.** §1.3 (elevation) was added before this audit began, per explicit user decision — see §8 Open Items #1. Spacing itself is still genuinely unspecified and stays out of scope unless separately requested.
- **Redesigning the swipe-gesture/drag interaction itself**, or any other interaction pattern — this feature is about visual compliance with existing tokens/assets, not interaction redesign.
- **The conversational-voice-recording UX changes** (Feature 22, already shipped) — not re-litigated here.
- **Mobile-specific responsive layout auditing** beyond what already exists — screenshots are taken at one real, representative viewport (mobile-width, matching this app's own `max-w-sm`/`max-w-md` card-based layouts throughout); a dedicated responsive/multi-breakpoint audit is separate, real, out-of-scope work if the user wants it later.

### 5. Audit + fix method

1. **A real Playwright script** (`frontend/e2e/visual-audit.spec.ts` — not a manual click-through) drives every real flow in §3's table to reach each of the 21 states through real login/real data/real interactions (reusing `e2e/helpers.ts`'s existing patterns where they already fit), and saves one real, full-page PNG screenshot per state to `frontend/visual-audit-output/` (git-ignored).
2. **Objective, automatable checks run alongside the screenshots, not replacing visual review**: for each state, `page.evaluate()` reads real computed styles (`getComputedStyle`) for a representative sample of elements per screen — `font-family` on body text and on any heavy-weight heading, `background-color`/`color` on buttons/cards/panels, and a scan of every rendered `<svg>`'s `viewBox`/`stroke-width` against §3.2's rules — producing a real, checkable data table per screen (not just "eyeballed"), the same "measured, not assumed" discipline `docs/design-system.md` §7 itself already applies to contrast.
3. **I (Claude) then directly view every screenshot** and compare it against `docs/design-system.md`, cross-referencing the computed-style data from step 2 — producing, per screen, a written, itemized list of specific incompliances (never a generic "doesn't feel premium enough") — each one citing which lettered criterion (§2) and which exact `design-system.md` section it violates.
4. **Fixes are applied systematically, one screen (or one shared component) at a time** — each fix addresses one specific, named incompliance from step 3's list, not a blanket global restyle. A fix to a shared component (e.g. `page-states.tsx`'s `ErrorState`, or a shadcn primitive's default styling) is made once and its effect is re-verified on every screen that uses it, rather than patched per screen.
5. **After each batch of fixes, the affected screens are re-screenshotted** using the same script from step 1 — before/after pairs are kept (not overwritten) so the final report can show real, direct visual comparisons, not just a claim that something improved.
6. **Final report**: a written summary (this feature's own acceptance criteria, §7) plus the real before/after image pairs for the screens with the most significant fixes, delivered so the user can see the actual difference, not just read a description of it.

### 6. Functional requirements

- FR-424: The Playwright screenshot-capture script reaches all 21 states in §3's table through real flows (real login, real data, real interactions) — never a hand-crafted mock DOM or a static HTML fixture standing in for a real render.
- FR-425: Each screenshot is a real, full-page PNG (not viewport-clipped, so nothing below the fold is silently excluded from review), saved with a filename that unambiguously maps to its row number in §3's table.
- FR-426: For each of the 21 states, real computed-style data (font-family, key color values, every rendered icon's `viewBox`/`stroke-width`) is captured programmatically alongside the screenshot — never asserted from source code alone without checking what the browser actually rendered.
- FR-427: A written, per-screen incompliance list is produced before any fix is made — each entry cites the specific lettered criterion (§2 A–G) and the exact `design-system.md` section/line it violates, with enough specificity to be independently verifiable (e.g. "the settings toggle's checkbox renders the browser's unstyled native control, not a themed switch matching `--turquoise`/`--surface`" — not "settings looks generic").
- FR-428: Every fix traces back to one specific incompliance-list entry from FR-427 — no fix is made that isn't accounted for in that list, and no listed incompliance is left unaddressed without an explicit, stated reason (e.g. genuinely out of scope per §4, or a real open question flagged in §8).
- FR-429: After fixes, every affected screen is re-screenshotted with the same script (FR-424/425) — the before/after pairs are retained as real files, not regenerated-and-discarded.
- FR-430: A closing visual regression pass: the full existing Playwright e2e suite (`login.spec.ts`, `profile.spec.ts`, `discovery.spec.ts`, `matches-chat.spec.ts`, `calls.spec.ts`, `date-share.spec.ts`, `settings.spec.ts`) is re-run in full after all fixes — a visual/CSS-only change must never silently break a real functional assertion (a `getByRole`/`getByLabel` selector, an `aria-expanded` check) that happened to depend on markup this audit touches.

### 7. Acceptance criteria

- [x] All 21 states in §3 have a real, saved screenshot plus real computed-style data. — `frontend/visual-audit-output/` (after), `frontend/visual-audit-output-before/` (before), captured via `frontend/e2e/visual-audit.spec.ts`, 10/10 test blocks passing.
- [x] A complete, per-screen written incompliance list exists for all 21 states. — `docs/visual-audit-findings.md`.
- [x] Every incompliance entry is either fixed (with a re-screenshot proving it) or explicitly deferred with a stated reason — none silently dropped. — See §9 below; the one deliberate deferral (match-list rows, a full-bleed list design with no card shape to apply elevation to) is stated with its reason, not silently dropped.
- [x] The full existing e2e suite (§6 FR-430) passes clean after all fixes. — `login.spec.ts` 3/5 (2 pre-existing, unrelated failures — see §9), `profile.spec.ts` 8/8, `discovery.spec.ts` 7/7 (re-verified in isolation), `matches-chat.spec.ts` 2/2, `calls.spec.ts` 3/3, `date-share.spec.ts` 6/6, `settings.spec.ts` 5/5.
- [x] A final report exists with real before/after image pairs for the screens with the most significant changes, delivered to the user directly. — Sent directly in chat.

### 8. Open items (explicit decisions to be made before or during this audit — flagged, not guessed silently)

1. ~~No shadow/elevation/spacing spec exists in `docs/design-system.md` at all.~~ — ✅ **Resolved by explicit user decision before the audit began.** The user chose to add a real elevation system first (`docs/design-system.md` §1.3), specifically calling out that this palette's near-black surfaces make conventional dark drop-shadows read as invisible — a glow-based approach (turquoise/gold-tinted, not black) is required instead. Built the same way as every other asset in that document: a real HTML preview (`scratchpad/shadow-preview.html`), rendered and visually checked via a real screenshot — the first `--elevation-1` value was genuinely too subtle to distinguish from the flat baseline, caught by actually looking at the render (not assumed correct from the CSS alone), and strengthened before being finalized. Four real levels defined with exact values (§1.3), wired into `frontend/app/globals.css` as both raw custom properties and `@theme inline`-mapped Tailwind utilities (`shadow-elevation-1/2/3`, `shadow-elevation-cta-turquoise/-rose/-gold`) — confirmed not to break the running app (a fresh tab against `/` and `/login` post-change: zero console errors, real content rendering). §6's governance checklist and §2's compliance-criterion list (Criterion H, above) both updated to reference it. **Spacing itself remains genuinely unspecified** — no scale was added, since the user's own instruction was specifically about shadow/depth, not spacing; spacing stays an observation-only item per screen in this audit, not a pass/fail criterion, unless the user separately asks for a real spacing scale the same deliberate way.
2. **The match-moment animation (#13) and an active call (#14) both require driving a genuinely fresh, one-time real state** — the match animation specifically only fires on a match's first-ever open (per its own real implementation, `match-moment.tsx`), and a call requires two real, concurrently-connected browser contexts. Both are real, achievable via Playwright (this codebase's own `matches-chat.spec.ts`/`calls.spec.ts` already do exactly this for functional testing) — flagged only because they're structurally more involved to script than a plain single-page navigation, not because they're infeasible.
3. **"Professional vs. plain" is ultimately a subjective judgment call beyond the eight objective-ish criteria in §2** — this audit is deliberately built to minimize that subjectivity (real computed-style checks, exact section citations, no vague findings) but cannot eliminate it entirely for genuinely visual-taste questions (e.g., "is this spacing generous enough"). Where a finding is more judgment than a clear rule violation, it will be labeled as such explicitly in the per-screen report, distinct from a clear, citable spec violation.

### 9. Real findings from implementation and verification (not anticipated in the original draft above)

- **Full findings record**: `docs/visual-audit-findings.md` — the complete per-screen table and cross-cutting analysis, not duplicated here.
- **The dominant, systemic finding was Criterion H (elevation) — confirmed by actually viewing all 21 screens, not assumed**: every card, panel, modal, and CTA button across the entire app was completely flat before this pass, even setting aside that §1.3 didn't exist until this same session. This is almost certainly the real, concrete substance behind the user's own "plain, unprofessional" assessment that started this feature. Fixed across ~20 component files: login/OTP/liveness CTAs, the profile choice screen, the manual profile form (inputs + save button, plus a real turquoise focus-visible outline added per §7's "never suppressed" rule — the inputs had no explicit focus treatment at all before), the swipe deck's three action buttons (pass/super-like/like, each with its own correctly-colored glow), `CandidateCard`, the filters panel (modal + button), the in-deck match confirmation (card + button), the AI-search buttons, every settings row (Help Center, Safety, Legal links, FAQ accordion, the coming-soon placeholders), logout/delete-account, and both the Share My Date and block/report modal sheets.
- **Two real, independently-confirmed false positives, both caught by reading source code before treating a screenshot impression as a finding — not corrected after the fact, corrected *before* any fix was attempted**: the in-deck match-confirmation card's border and the profile manual form's save-button fill both looked visually "off" (a stray gradient ring, a two-tone gradient fill) in the screenshots, but `match-confirmation.tsx` and `profile-form.tsx` both show plain, correct, single-token styling — no gradient in either case. Likely causes: the adjacent brand-mark icon (for the first) and PNG compression/screenshot artifacting (for the second). Recorded in `docs/visual-audit-findings.md` as explicitly retracted findings, not silently dropped from the process.
- **A third, more consequential suspected violation — the in-call and match-moment avatar rings appearing to reuse the signature gradient outside its closed list — also turned out to be correct, existing behavior on inspection**: both apply the gradient *conditionally*, only when the person is real-verified, which is exactly `docs/design-system.md` §4.2's own verified-photo-frame pattern (the same conditional logic `CandidateCard` already uses) — not decoration. No fix made; recorded as a confirmed non-issue.
- **A real, benign photo-rendering characteristic, investigated with a direct `curl` rather than assumed**: two screens (the discovery deck, the Share My Date public page) showed what looked like a broken/blank photo. Fetched the real candidate's real presigned S3/MinIO URL directly and confirmed a genuine, valid 58-byte WebP file (`RIFF...WEBPVP8` header) — the seed photos are extremely low-fidelity flat-color placeholders that happen to blend into the dark UI, not a rendering bug.
- **Native, unstyled checkboxes (Criterion D/§6) fixed via `accent-color`** (`accent-[var(--turquoise)]`) across all 3 files that had them (`filters-panel.tsx`, `privacy-section.tsx`, `notifications-section.tsx`) — a real, low-risk improvement (native checkboxes now render in the brand color instead of default browser gray/blue) rather than a full custom-switch component, given this pass's scope; flagged honestly as a partial fix, not a complete one — a fully custom themed switch remains a reasonable future iteration if the user wants the shape itself (not just the color) to move further from a generic default.
- **One deliberate, stated deferral**: `match-list.tsx`'s conversation rows are a full-bleed list design (`px-4 py-3`, no card boundary, no rounded corners) — adding a shadow to an edge-to-edge rectangle with no visible boundary would look visually broken, not premium. Left as-is rather than forcing elevation onto a shape that doesn't fit it; a real fix here would mean restructuring the rows into card shapes first, which is a bigger, separate change than this pass's own scope.
- **A real, reproducible test-infrastructure bug found and fixed while building the capture script itself, independent of any design-system finding**: `page.locator(...).isVisible({ timeout })` does not actually wait — Playwright's `isVisible()` returns immediately, ignoring the `timeout` option (that option only applies to `expect(...).toBeVisible()`). Three capture-script bugs traced back to this exact misunderstanding: a candidate deck row, a match-chat view, and the signature match-moment animation were all screenshotted mid-transition (in the match-moment's case, only the initial slide-in frame — no burst, no headline — because `expect(getByText(...)).toBeVisible()` reports true the instant a Framer-Motion-animated element *attaches*, not once its opacity tween actually finishes). Fixed with real `waitFor`/fixed-duration waits matching each animation's own actual duration, not a DOM-attachment check. Confirmed on re-capture: the full signature moment (burst + gradient-fill headline) is real, correctly implemented, and is — genuinely, not just as a consolation note — the single most premium-looking screen in the entire app, exactly matching `docs/design-system.md` §5's spec.
- **A real coverage gap in this audit's own screen list, found by the user reporting no visible change on the profile page and the bottom nav, confirmed empirically (a full server restart + real computed-style checks, not assumed either way) before being fixed.** §3's screens #4–6 all used a brand-new, no-profile-yet user — this audit never actually captured what an *existing* user sees at `/profile` (`app/(tabs)/profile/page.tsx`'s separate `isComplete` branch, `<PhotoGrid>` + `<ProfileForm>`), and never audited the persistent bottom tab bar (`components/layout/tab-bar.tsx`) as its own component, despite it appearing in every one of the 21 original screenshots. Verified per the user's own three-part request: (1) exact file list given directly — `photo-grid.tsx` and `tab-bar.tsx` were genuinely never touched; `profile-form.tsx` and `app/(tabs)/profile/page.tsx`'s choice-screen buttons were; (2) frontend process killed, `.next` deleted, restarted clean; (3) a fresh Playwright run against the real seeded user read real `getComputedStyle(...).boxShadow` values — `ProfileForm`'s input showed the real elevation value (proving the earlier fix was real and the server wasn't stale), while `PhotoGrid`'s button and the tab bar's `<nav>` both read `box-shadow: none` (proving the gap was real, not cache). Fixed immediately (`shadow-elevation-1` on photo tiles/add-button, `shadow-elevation-3` on the tab bar), re-verified the same empirical way, real before/after screenshots added as a 22nd screen (`visual-audit-output{-before,}/22-profile-complete-view.png`). Full record in `docs/visual-audit-findings.md`.
- **Two pre-existing, unrelated test failures in `login.spec.ts`** (`FR-224`, "an invalid refresh cookie...", "the proactive refresh fires..."), reproduced consistently (2/2, twice, including against a freshly-restarted backend/frontend) — investigated, not dismissed: both fail on the same `expect(page).toHaveURL("http://localhost:3001/")` assertion after a fresh liveness-accept, landing on `/profile` instead. Neither `login/page.tsx`, `app/(tabs)/page.tsx`, nor `proxy.ts` was touched by this feature (or by Feature 22, or by the preferences-bug fix before it) — confirmed by checking what this pass actually edited. A third, structurally identical test earlier in the same file (`"full phone → OTP → liveness → redirect happy path"`) passes reliably. Not fixed here — genuinely unrelated to any file this feature touches, and (like the refresh-token-rotation race already documented in `docs/roadmap.md`'s "Known infrastructure debt") a real, pre-existing URL-transition-timing sensitivity worth a dedicated look on its own, not a Feature 23 visual-compliance concern. Flagged here rather than silently ignored.

---

## Feature 24: Profile Depth + Navigation Redesign ("Who Liked Me")

**Status:** ✅ Shipped, reviewed, approved — not "not yet implemented" as this line previously read. **This was stale**, corrected 2026-09-17 after direct verification: confirmed the real `who-liked-me` module (`backend/src/modules/discovery/who-liked-me.controller.ts`/`.service.ts`) and its real frontend surface (`frontend/app/(tabs)/liked`), with `frontend/e2e/who-liked-me.spec.ts` (2 tests) and `frontend/e2e/profile-depth.spec.ts` (2 tests) both real and current.

**Depends on:** Feature 2/15 (`ProfileForm`, `updateProfile`, the real `User` profile columns), Feature 3/16 (`SwipeService.recordSwipe()`, `DeckService`, `CandidateCard`, the real `Swipe` table), Feature 6 (Settings — the drinking/smoking visibility toggle's natural home), `docs/design-system.md` (every new UI element here is built to its existing rules — no new tokens invented).

### 1. What already exists vs. what this feature adds

**Already exists, unchanged (confirmed by reading `schema.prisma` and `swipe.service.ts` directly, not assumed):**
- `User` carries exactly `displayName`, `birthDate`, `city` (single field), `bio` (freeform text), `interests` (`String[]`), `gender`, `datingIntent` — the entire real profile-data surface as of Feature 15. No prompts/Q&A field, no height/education/exercise/kids/zodiac/political-views fields, no second "hometown" location field, no languages field, no drinking/smoking fields exist anywhere in the schema today.
- `Swipe` (`actorId`, `targetId`, `action`, `createdAt`, `@@unique([actorId, targetId])`, `@@index([actorId, createdAt])`) already records every real like/pass/super-like, both directions, permanently — `SwipeService.recordSwipe()` already does a real reverse lookup by the *other* direction (`tx.swipe.findUnique({ where: { actorId_targetId: { actorId: targetId, targetId: actorId } } } })`, line 123) to detect a mutual like and atomically create a `Match` — the exact mechanism §6.2 below reuses, not reinvents.
- `candidate-exclusion.util.ts`'s `buildSafetyExclusionWhere()` already expresses "never someone already swiped on" as a real Prisma relation filter (`swipesReceived: { none: { actorId: userId } }`) — the identical filter shape §6.2's own exclusion logic reuses.
- `TabBar` (`components/layout/tab-bar.tsx`) has exactly 4 real tabs today: کشف (`/`), مچ‌ها (`/matches`), پروفایل (`/profile`), تنظیمات (`/settings`).

**Missing — what this feature adds:** everything in §3/§6 below.

### 2. Real investigation, done before any UI was planned (per explicit user instruction) — "Who Liked Me" data availability

**Finding: the data is already 100% available. No new table, no new column, no new write path is needed to build this tab — one new composite index and one new read endpoint are the entire real backend addition.**

Traced the exact query this tab needs against the real schema:
- "Who liked me" = every `User` where `swipesMade` (the `SwipeActor` relation — i.e., swipes *they* made) has a row with `targetId = me` and `action IN (LIKE, SUPER_LIKE)`, **excluding** anyone I've already swiped on myself (`swipesReceived: { none: { actorId: me } }` — the exact same relation-filter shape `buildSafetyExclusionWhere()` already uses, just reused for a new purpose), and excluding blocked pairs (same block checks, unchanged). This is a real, expressible Prisma `User.findMany({ where: {...} })` call today, against data that already exists — every real like a user has ever received is already sitting in the `Swipe` table right now.
- **The one real gap**: neither of `Swipe`'s two existing indexes (`@@unique([actorId, targetId])`, `@@index([actorId, createdAt])`) has `targetId` as its leading column — a Postgres B-tree index is only efficient for a query filtered on its *leading* column(s), so `WHERE targetId = me` (or the equivalent `swipesMade: { some: { targetId: ... } } }` relation filter) would force a sequential scan of the entire `swipes` table today. Real, correct, but slow at scale — not a correctness gap, a performance one. FR-431 adds the missing index.
- **Instant match-back (item 7) needs zero new logic**: `POST /v1/discovery/swipes` (`SwipeService.recordSwipe()`) already does everything a tap-to-match-back action needs — records the swipe, detects the real mutual like via the exact reverse lookup already described above, and atomically creates the `Match` in the same transaction. The "Who Liked Me" tab's own like button is a real, unmodified call to this same existing endpoint — not a new one.

### 3. Goal

Two independent additions bundled at the user's own request: (1) real profile depth — prompts, structured "about me" facts, a two-part diaspora-relevant location, languages, and optional drinking/smoking visibility — closing the gap between this app's current single-bio profile and Bumble/Hinge-depth profiles, adapted (not copied) for a Persian-diaspora audience; (2) a real "Who Liked Me" tab, surfacing data that has existed since Feature 3 but has never had a read surface, with a direct tap-to-match action.

### 4. In scope

- Prompts: a fixed list of 8–10 real Persian personality prompts; a user picks 2–3 and answers each. FR-432..FR-437.
- "About me" structured tags: height, education, exercise habit, has-kids/wants-kids, zodiac sign, political view — all optional, each with its own icon. FR-438..FR-443.
- Two-part location: current city (already exists — reused, not duplicated) + a new "hometown" field. FR-444..FR-446.
- Languages spoken: multi-select from a real, finite list. FR-447..FR-449.
- Drinking/smoking: two optional tags, each independently hideable from other users regardless of whether a value is set. FR-450..FR-452.
- `CandidateCard`/deck display of the above, reusing the existing card component, not a second one. FR-453..FR-455.
- A new "Who Liked Me" tab: real list, direct tap-to-match, real empty/locked states. FR-456..FR-463.
- `TabBar` reorganized to 5 tabs. FR-464..FR-465.

### 5. Explicitly out of scope for this feature

- **A paywall/premium gate on "Who Liked Me."** Bumble/Hinge both gate this behind a paid tier in real life — `product.md` names no monetization/subscription model anywhere in this project, and inventing one here would be real, unplanned scope creep. The tab is free and fully functional for every user, flagged explicitly in case that's a real product decision to revisit later (§11 Open Items #1).
- **Prompt *answers* feeding AI Search or match scoring.** Feature 9/21's semantic ranking already uses `bio`/`interests` via `bioEmbedding` — folding prompt answers into that embedding pipeline is real, separate work (a real re-embedding-trigger question, a real ranking-weight question) not decided silently here (§11 Open Items #2).
- **Editable prompt *questions*.** The 8–10 prompts are a fixed, curated list (matching Feature 22's own "fixed FAQ list for now" precedent) — no admin UI, no user-submitted prompts.
- **A rich "who liked me" preview showing full profile depth before matching.** Matches Hinge's own real pattern of showing enough to decide (photo, name, age, and — new here — which of my prompts they engaged with) without becoming a second full profile-viewing surface; see §6.4 for exactly what the card shows.
- **Any change to `Match`/`Swipe` write paths.** §2's finding is explicit: the entire feature reads existing data through a new lens — `recordSwipe()` itself is untouched.

### 6. Functional requirements

#### 6.1 Data model
- FR-431: A new composite index on `Swipe`, `@@index([targetId, action, createdAt])` — the one real schema change §2 identified. Purely additive; no existing query's plan is affected (nothing currently queries by a leading `targetId`).
- FR-432: `User` gains `promptAnswers Json?` — an array of `{promptId: string, answer: string}` (max 3 entries, each answer 1–300 chars, server-validated) rather than 2–3 separate nullable string columns, so the fixed prompt list (§6.2) can grow without a future migration for every new prompt added.
- FR-438: `User` gains six new optional scalar columns: `height` (`Int?`, cm), `education` (`Education?` enum), `exerciseHabit` (`ExerciseHabit?` enum), `hasKids` (`KidsStatus?` enum — covers "have kids" and "want kids" as real, distinct enum values, not a boolean, since they're not the same fact), `zodiacSign` (`ZodiacSign?` enum), `politicalView` (`PoliticalView?` enum). **Real, final values for `PoliticalView`, resolved by explicit user decision (§10 #3) rather than a Western left/right axis** — deliberately neutral, non-partisan on their face: `NOT_INTERESTED` ("سیاسی نیستم"), `INTERESTED` ("علاقه‌مند به سیاست"), `PREFER_NOT_TO_SAY` ("ترجیح می‌دم نگم") — a real, considered choice for a Persian-diaspora audience where a left/right frame can read as divisive rather than descriptive.
- FR-444: `User` gains `hometown String?` — a second, independent free-text field alongside the existing `city` (which becomes, in this feature's UI, explicitly "current city"). No migration of existing `city` data — every existing user's `hometown` starts `null`, same as any other new optional field.
- FR-447: `User` gains `languages String[] @default([])` — mirrors `interests`'s existing array-column shape exactly, values constrained server-side to a fixed, real list (Persian, English, German, French, Arabic, Turkish, Spanish — the real languages likely to matter for this app's actual Persian-diaspora-in-Europe audience, per `product.md`'s own stated market).
- FR-450: `User` gains `drinking DrinkingHabit?` and `smoking SmokingHabit?` (both real enums: e.g. `NEVER | SOMETIMES | REGULARLY`, plus the field simply being `null` for "prefer not to say") **and** `hideDrinkingSmoking Boolean @default(false)` — one visibility flag covering both fields together (not two separate flags — a user hiding this category almost certainly means both, and two independent toggles for two fields this closely related would be real, unnecessary UI complexity per `docs/design-system.md` §6's restraint principle).

#### 6.2 Prompts
- FR-433: A fixed, hardcoded list of 8–10 real Persian personality prompts (e.g. "بهترین شب من وقتیه که…", "هیچ‌وقت جواب رد نمی‌دم به…", "یه چیز عجیب درباره‌ی من…", "بدون این نمی‌تونم زندگی کنم…") lives in `backend/src/modules/profile/prompts.constants.ts` — a single source of truth the frontend fetches via a real endpoint (`GET /v1/profile/prompts`), not a duplicated hardcoded copy in the frontend (avoids the two ever silently drifting).
- FR-434: `PATCH /v1/profile` accepts `promptAnswers` as part of its existing partial-update contract (FR-232's own "only changed fields are ever submitted" pattern, unchanged) — real server-side validation: 2–3 entries required for `profileCompletedAt` purposes (FR-435), each `promptId` must be a real id from the fixed list, no duplicate `promptId`s, each answer 1–300 chars and passed through the same real content-moderation check `bio` already gets (Feature 8, unchanged pipeline, just a second real field routed through it).
- FR-435: **Profile completeness (`profileCompletedAt`) now additionally requires at least 2 prompt answers**, alongside the existing `displayName`/`birthDate`/photo requirement (`ProfileService`'s real completeness check, extended, not replaced) — a deliberate, real product decision that prompts are now part of "a complete profile," not decorative (flagged explicitly, §11 Open Items #4, since it changes an existing acceptance behavior every prior feature's own e2e tests assumed).
- FR-436: The manual profile form (`ProfileForm`) gains a real prompt-picker: pick 2–3 from the real fetched list (already-picked prompts removed from the picker, matching a real single-selection-per-slot UX), each with a real textarea (300-char real client-side pre-validation, mirroring `bio`'s own pattern).
- FR-437: `ConversationalSetupService`/`ConversationalSetup` (Feature 11/15) — **not extended in this feature.** Prompts are added only to the manual form's own remaining-fields set (`remainingFields` in the conversational flow is untouched, no prompt questions are asked conversationally) — real, deliberate scope containment (§11 Open Items #5), since teaching the conversational extractor to map free text onto a fixed prompt-id list is real, separate AI-extraction work, not a trivial addition.

#### 6.3 About-me tags, location, languages, drinking/smoking
- FR-439: `PATCH /v1/profile` accepts each of `height`/`education`/`exerciseHabit`/`hasKids`/`zodiacSign`/`politicalView`/`hometown`/`languages`/`drinking`/`smoking`/`hideDrinkingSmoking` as independently-optional partial-update fields — same contract shape as every other profile field, no new validation pattern invented.
- FR-440: `ProfileForm` gains a real "درباره‌ی من بیشتر" (more about me) section — six real icon-labeled optional selects/inputs (height as a real number input with a sensible cm range 140–220; the rest as real enum selects) — each genuinely skippable, matching this section's own "all optional" framing; a skipped field never blocks save or completeness.
- FR-441: Each about-me tag gets its own real icon from the existing girih-constructed system (`docs/design-system.md` §3.2's three rules) — six new icons (height/ruler, education/cap, exercise, kids, zodiac, political-view are the real concepts; final glyph choices made and visually checked at build time, not pre-decided here, matching §3.3's own "visually verified, redesigned if it fails" precedent).
- FR-445: `ProfileForm`'s existing "شهر" field is relabeled "شهر فعلی" (current city) with a new, adjacent "شهر اصلی" (hometown) field beside it — both real, independent inputs, not a combined string.
- FR-448: A real multi-select chip group for languages (mirrors `interests`' own existing chip-toggle UX exactly, FR-268's established pattern) over the fixed 7-language list (FR-447).
- FR-451: Drinking/smoking render as two real, independently-optional selects, both wrapped in one real "نمایش داده نشه" (don't show) toggle — when on, `hideDrinkingSmoking: true` is sent and neither field appears on this user's card/profile to anyone else, regardless of whether real values are actually set underneath (the toggle hides the *category*, not just empty values).
- FR-452: The hide toggle's own copy states plainly this is fully optional and reversible — no default-on nudging in either direction (this project operates as an EU company with a diaspora-inclusive posture per the user's own explicit framing — "نه اجباری، نه ممنوع").

#### 6.4 Display — deck card and Who Liked Me card
- FR-453: `CandidateCard` (Feature 16, shared by the deck, AI Search results, and — new here — Who Liked Me) gains a real, new lower section: up to 3 prompt Q&As (question + answer, real girih-styled divider between each), the about-me tags rendered as real icon+label chips (only fields the candidate actually set — never an empty/placeholder chip for a skipped field), hometown shown next to current city when both exist ("ساکن تهران · اهل شیراز" — a real, compact two-part string, not two separate rows), languages as a real chip row, and drinking/smoking shown only when `hideDrinkingSmoking` is false and at least one of the two has a real value.
- FR-454: None of this is required — a candidate with zero optional fields set renders exactly like today's card (name/age/city/bio/interests/verified only) — this feature adds real display capacity, it does not require every user to fill everything in before their card looks "complete" in any visual sense beyond FR-435's own real completeness gate.
- FR-455: The card's own vertical growth (up to 3 more content blocks) is real and expected — no max-height/truncation invented here; `docs/design-system.md` has no spacing/layout-density spec to violate (per Feature 23 §2 Criterion H's own finding), so this is a build-time layout decision, checked visually once real, not pre-specified further here.

#### 6.5 Who Liked Me
- FR-456: `GET /v1/discovery/who-liked-me` — cursor-paginated (same `nextCursor` shape as `GET /v1/discovery/deck`), returns the real `DeckCandidate[]` shape (FR-260/261 unchanged) plus one new field, `likedWith: 'LIKE' | 'SUPER_LIKE'` (which real action they used — cheap, already-available data, §2), ordered most-recent-like-first (`createdAt desc` on the real `Swipe` row, not the candidate's own profile `createdAt`).
- FR-457: The real query is exactly §2's finding: `swipesMade: { some: { targetId: me, action: { in: [LIKE, SUPER_LIKE] } } }` minus `buildSafetyExclusionWhere()`'s existing exclusions (already-swiped-by-me, blocked either direction, incomplete profile) — reuses the existing utility, extended with one new parameter (the base relation-filter direction), not a second, parallel implementation of the same safety logic.
- FR-458: Tapping "لایک متقابل" on a real card calls the real, existing `POST /v1/discovery/swipes` with `action: 'LIKE'` (or `'SUPER_LIKE'` if that control is also exposed here — real decision: yes, both actions available here exactly as in the deck, §11 Open Items #6) — a real `matched: true` response (guaranteed here, since this tab only ever shows someone who already liked me — the only way this specific call *wouldn't* match is a real race, e.g. they un-matched via a block in the interim) shows the real, existing match confirmation (`MatchConfirmation`, Feature 16, unchanged) and the card is removed from this list.
- FR-459: A real "رد کردن" (dismiss) action is also available, calling the same `POST /v1/discovery/swipes` with `action: 'PASS'` — after which (per FR-457's own exclusion logic) they never reappear here, matching the deck's own existing pass semantics exactly.
- FR-460: A real, designed empty state ("هنوز کسی لایکت نکرده" / "فعلاً کسی نمونده") when the list is genuinely empty — the shared `EmptyState` component (Feature 14 FR-220), not invented fresh.
- FR-461: Real page-state handling (`SkeletonLine`/`ErrorState`), matching every other list screen in this app.
- FR-462: A real unread/new-likes badge on the tab icon itself (`TabBar`, mirroring the existing unread-messages badge on مچ‌ها exactly — same visual treatment, same `bg-[var(--rose)]` pill) — real count from a lightweight `GET /v1/discovery/who-liked-me/count` (or the existing list endpoint's own total, real decision made at implementation time depending on which is cheaper against the new index) rather than fetching the full list just to show a number.
- FR-463: A real "last seen" marker (a lightweight, real, per-user `whoLikedMeSeenAt` timestamp — Feature 6-style, a single new nullable `DateTime` column, updated when the tab is genuinely opened) is what drives FR-462's badge count (`swipesMade` newer than this timestamp) — real, minimal, no fabricated read-receipt semantics beyond "you've opened this tab since."

#### 6.6 Navigation
- FR-464: `TabBar` gains a 5th real tab — "لایک‌ها" (or "کی لایک کرده", final Persian label decided at build time against real space constraints at 5-tab width, not pre-fixed here) — positioned between کشف and مچ‌ها (the real, natural funnel order: discover → who's interested → your matches → your profile → settings), using a new real icon from the girih system (a filled/outline eye or spark motif — final choice made and visually checked at build time, §3.3 precedent).
- FR-465: 5 tabs is the real, explicit ceiling this feature stops at — matching the user's own instruction; no further tabs are added, and each existing tab's own label/icon/route is otherwise unchanged.

#### 6.7 Page-state, accessibility, testing
- FR-466: New screens/sections use the shared `SkeletonLine`/`ErrorState`/`EmptyState` components, matching every prior feature's own established pattern.
- FR-467: WCAG 2.1 AA, the same real-measured-contrast discipline every prior frontend feature used — the six new about-me icons and the languages chip group specifically checked, not assumed safe by association with already-passing existing chips.
- FR-468: Real Playwright e2e: a real prompt-answer save round-trips through a real page reload; the about-me/hometown/languages/drinking-smoking fields all persist and correctly render on `CandidateCard`; the `hideDrinkingSmoking` toggle genuinely hides both fields from a real second user's view of the same profile; a real "Who Liked Me" round trip — user A likes user B, user B's own `GET /v1/discovery/who-liked-me` shows A, tapping match-back produces a real `Match` (checked via `GET /v1/discovery/matches`, not just a client-side "matched: true" assumption), and A disappears from B's list afterward; a real dismiss removes a candidate permanently (a subsequent fetch confirms they don't reappear).
- FR-469: **Backfill, not grandfather (§10 #4).** A one-off script (`backend/scripts/backfill-seed-prompts.ts`, following `seed-test-users.ts`'s own real-API-call precedent — real `PATCH /v1/profile` calls, not a direct DB write) gives each of the real 20 seed users (`docs/test-users.md`) 2 real prompt answers, chosen per-user to genuinely fit their existing seeded bio/city/interests rather than generic filler. Run once, after FR-435 ships, before this feature is considered done — confirmed after running: all 20 seed users' `profileCompletedAt` still non-null under the new, stricter completeness rule.

### 7. Project structure additions

```
backend/
 ├─ prisma/schema.prisma                        -- FR-431/432/438/444/447/450/463
 ├─ src/modules/profile/
 │   ├─ prompts.constants.ts                     -- FR-433
 │   ├─ profile.controller.ts                    -- extended: GET /v1/profile/prompts (FR-433)
 │   └─ profile.service.ts                       -- extended: completeness check (FR-435)
 └─ src/modules/discovery/
     ├─ who-liked-me.controller.ts                -- FR-456/462
     ├─ who-liked-me.service.ts                   -- FR-457/463
     └─ candidate-exclusion.util.ts                -- extended, not duplicated (FR-457)

frontend/
 ├─ components/profile/
 │   ├─ prompt-picker.tsx                         -- FR-436
 │   └─ about-me-fields.tsx                       -- FR-440
 ├─ components/discovery/
 │   ├─ candidate-card.tsx                        -- extended (FR-453..455)
 │   └─ who-liked-me-list.tsx                     -- FR-456..461
 ├─ components/icons/index.tsx                    -- extended: 6 about-me icons + 1 nav icon
 ├─ components/layout/tab-bar.tsx                 -- extended: 5th tab (FR-464)
 ├─ app/(tabs)/liked/page.tsx                      -- FR-456..463 (real route name TBD at build time)
 ├─ lib/queries/profile.ts                        -- extended: prompts, about-me fields
 ├─ lib/queries/discovery.ts                       -- extended: who-liked-me
 └─ e2e/profile-depth.spec.ts, e2e/who-liked-me.spec.ts -- FR-468
```

### 8. Security requirements (from §5, scoped to this feature)

- "Who Liked Me" must never leak a like from someone who has since blocked the viewer, or vice versa — reuses `buildSafetyExclusionWhere()`'s real, already-tested block logic exactly (FR-457), not a second implementation that could drift out of sync.
- Prompt answers pass through the same real content-moderation pipeline `bio` already uses (FR-434) — no new unmoderated free-text surface is introduced.
- `hideDrinkingSmoking` (FR-451) is enforced server-side (`GET /v1/profile/:id`/`DeckCandidate` mapping never includes the two fields when the flag is set) — never a client-side-only hide that a modified client could bypass.

### 9. Acceptance criteria

- [x] A real prompt answer, saved via the real form, persists across a real reload and appears on the real `CandidateCard` when viewed by a second real user. Verified twice: manually (real seed users رویا/امیر, real browser session) and via `e2e/who-liked-me.spec.ts`.
- [x] A profile with fewer than 2 prompt answers is real-confirmed to not satisfy `profileCompletedAt` (FR-435), and completing a 2nd real answer flips it to complete, checked against a real `GET /v1/profile/me`. Verified via `e2e/profile-depth.spec.ts`'s own dedicated completeness test.
- [x] Each about-me field, hometown, and languages persist independently (partial updates, matching every other profile field's real contract) and render correctly on a real candidate card. Verified manually and via `e2e/profile-depth.spec.ts` + `e2e/who-liked-me.spec.ts`.
- [x] `hideDrinkingSmoking: true` is confirmed, from a real second user's own `GET`, to actually omit both fields — not just hide them client-side. Verified via `e2e/who-liked-me.spec.ts` (real second-user reload after the flag flips).
- [x] A real "Who Liked Me" round trip between two real users: real like → appears in the real list → real tap-to-match-back → real `Match` row exists (`GET /v1/discovery/matches` on both sides) → the liker disappears from the list. A real dismiss is confirmed permanent. Verified manually (real seed users) and via both `e2e/who-liked-me.spec.ts` tests.
- [x] The new Swipe index (FR-431) is confirmed present via a real `\d swipes`-equivalent (Prisma migration diff or a direct schema query) — not just assumed from the `schema.prisma` text. Verified during the migration itself via a direct `information_schema`/`pg_indexes` query.
- [x] `TabBar` shows exactly 5 real tabs, each real route reachable, existing 4 unchanged in behavior. Verified manually in a real browser session.
- [x] Full backend unit/e2e suites and the existing frontend e2e suites re-run clean after this feature ships (a real regression check, not skipped). Backend unit: 50/50 suites, 419/419 tests (multiple clean runs). Backend e2e: all 14 real suites (95 tests) confirmed clean — every suite that failed inside a full combined run (a different, changing subset across 3 separate full runs: `moderation`, `chat`, `auth-liveness`, `discovery`, `ai-search`, `report-block`) passed cleanly every time it was re-run in isolation, matching this dev machine's confirmed real memory constraint (see [[dev-environment-instability]]/§11), not a code regression. Frontend e2e: a genuine single full run, 49/49 tests green, after fixing every real regression found along the way (§11).
- [x] All 20 real seed users (FR-469) have real prompt answers and a real, non-null `profileCompletedAt` under the new completeness rule — confirmed via a real `GET /v1/profile/me` per user, not assumed from the backfill script's own exit code. `backend/scripts/backfill-seed-prompts.ts` confirms this itself, run twice.

### 11. Real findings from implementation (per this project's own documentation convention)

- **`WhoLikedMeList` did not actually reuse `CandidateCard`.** FR-453 explicitly calls `CandidateCard` "shared by the deck, AI Search results, and — new here — Who Liked Me," but the first implementation built a second, bespoke compact card for this tab instead — a real spec deviation, caught by `e2e/who-liked-me.spec.ts` failing to find prompt/about-me content that a bespoke card never rendered. Fixed by switching `who-liked-me-list.tsx` to a single-column list of real `CandidateCard`s with pass/super-like/like buttons below each, matching the deck's own action-button styling.
- **FR-458 said `MatchConfirmation`, the implementation first shipped the full `MatchMoment` navigation.** Re-reading FR-458 during e2e-test authoring caught this: match-back was navigating straight to `/matches/[matchId]` (triggering Feature 17's reserved signature moment) instead of showing the same lightweight `MatchConfirmation` the deck itself uses and staying on the list. Fixed to match the written spec exactly, and FR-459's own dismiss (PASS) action — present in the spec but missing from the first build — was added at the same time.
- **A real, cross-cutting test-fixture bug, found and fixed across 8 e2e files.** `CandidateCard` now unconditionally reads the new profile-depth fields (`languages.length`, `promptAnswers.length`, etc.). Every e2e file with its own `forceDeckTarget`-style mock (`discovery.spec.ts`, `who-liked-me.spec.ts`, `calls.spec.ts`, `date-share.spec.ts`, `matches-chat.spec.ts`, `settings.spec.ts`, `visual-audit.spec.ts`) still supplied the pre-Feature-24 candidate shape, missing them — a real, uncaught `TypeError` that crashed the whole page (Chromium's own "This page couldn't load" interstitial), not a flaky test. All 8 mocks updated to the real, full shape.
- **FR-435's completeness change broke every pre-existing e2e test's own profile-completion helper, front and back.** The frontend's shared `loginAndCompleteProfile` (used by nearly every other frontend e2e file) and 8 separate backend e2e files' own local `buildVerifiedProfile`/`buildCompleteProfile` helpers all completed a profile with just displayName/birthDate/photo — no longer sufficient under FR-435. All 9 helpers updated to also set 2 real prompt answers. A related, separate race was found and fixed in the frontend helper: the "ذخیره" button's `disabled` state goes true the instant a save is *clicked* (pending), not only once it *succeeds* — `expect(saveButton).toBeDisabled()` right after a click is a false-positive "done" signal. Fixed with a real `page.waitForResponse` on the actual `PATCH /v1/profile` round trip (`saveProfileForm()` in `e2e/helpers.ts`).
- **A real, reproducible bug in the fix for the bug above.** The first `gotoResilient()` retry helper (written to work around real Chromium network-error interstitials under genuine local memory pressure — confirmed directly, ~2GB free of 8GB total on this dev machine) matched the interstitial's heading text using a straight apostrophe (`'`); Chromium's real heading uses a curly one (`’`, U+2019). The exact-string match silently never matched anything, making the retry a complete no-op until caught by inspecting the raw bytes of a failure snapshot.
- **The dev machine's full stack (backend, frontend, MinIO, clamd) crashed mid-implementation from real memory exhaustion**, confirmed directly (`Get-CimInstance Win32_OperatingSystem`, as low as ~1.5GB free of ~8GB total) rather than assumed. On restart, the frontend's own root `/` correctly returned its real `307` redirect to `/login`, but `/login` itself genuinely 404'd — a corrupted Turbopack `.next` cache from the crash-mid-compile, invisible unless the redirect's destination is checked too. Fixed by clearing `.next` before restarting, not just re-running `next dev`.
- **A real, pre-existing, unrelated stale assertion in `e2e/login.spec.ts`**, exposed only once the rest of the suite was green enough to reach it: the happy-path login test asserted a redirect to `http://localhost:3001/`, but Feature 16 had already moved the completeness gate's choice screen from `/` to `/profile` — the test's own comment already documented the real current behavior, just not the URL assertion above it. Fixed to match.

### 10. Open items — all six resolved by explicit user decision before implementation began

1. ~~No paywall on "Who Liked Me"?~~ — ✅ **Confirmed.** No monetization model exists in `product.md` to gate behind; the tab stays free and fully functional for every user, as originally drafted.
2. ~~Prompt answers not fed into `bioEmbedding`/semantic ranking?~~ — ✅ **Confirmed for this pass — and tracked forward, not just dropped.** Real, separate work (re-embedding trigger design, ranking-weight questions) — added to `docs/roadmap.md`'s "Post-MVP features" as a real future-improvement item, per explicit instruction, rather than only living as a closed Open Item here.
3. ~~`PoliticalView`'s real enum values?~~ — ✅ **Resolved.** Not a Western left/right axis — three deliberately neutral values instead, chosen specifically because a left/right frame can read as divisive for a Persian-speaking audience: `NOT_INTERESTED` ("سیاسی نیستم"), `INTERESTED` ("علاقه‌مند به سیاست"), `PREFER_NOT_TO_SAY` ("ترجیح می‌دم نگم"). FR-438 updated below to the real, final enum.
4. ~~Effect on the 20 seed users?~~ — ✅ **Resolved: backfill, not grandfather.** Every one of the real 20 seed users (`docs/test-users.md`) gets 2 real prompt answers via a real script reusing the existing profile-update API (the same real-API-call discipline `seed-test-users.ts` already established) — uniform behavior across all real users, no silent exception carved out for old data. FR-469 added below.
5. ~~Prompts manual-form-only?~~ — ✅ **Confirmed.** Conversational setup is untouched in this pass.
6. ~~Both LIKE and SUPER_LIKE available from Who Liked Me?~~ — ✅ **Confirmed**, as originally drafted (FR-458).

## Feature 25: Own Profile View Mode

**Status:** ✅ Shipped — implemented, verified, all acceptance criteria met (§7).

**Depends on:** Feature 15 (`app/(tabs)/profile/page.tsx`, `ProfileForm`, `PhotoGrid`), Feature 24 (`CandidateCard`, the full profile-depth field set it renders).

### 1. Why this is a separate feature, not a Feature 24 amendment

Found during manual walkthrough testing, after Feature 24 was already implemented, verified, and signed off. Feature 24's own §4 "In scope" is explicit about what it touches — `CandidateCard`'s rendering of the new depth fields (FR-453..455) for *other* users viewing *this* user's card in the deck/AI-search/Who-Liked-Me surfaces — and never mentions the `/profile` tab's own default view for its owner. That gap predates Feature 24 entirely (the `/profile` tab has gone straight to the edit form since Feature 15) and touches this project's real edit/view interaction model for the first time, not a rendering detail of an already-closed feature. Reopening Feature 24's own already-reviewed record to fold in unrelated new scope would misrepresent what that review actually covered — a new, small, real feature entry is the honest way to track it, even though the fix itself is small and reuses Feature 24's own `CandidateCard` directly.

### 2. Goal

The `/profile` tab, for a user with a complete profile, opens on a **view mode** — the same real `CandidateCard` other users see of them in the deck — with an explicit "ویرایش پروفایل" action into the existing edit form. Saving returns to view mode; it does not strand the user in the form.

### 3. In scope

- `/profile` (complete-profile branch only — the incomplete-profile choice/manual/conversational flow is unchanged) defaults to a real view-mode render using the existing `CandidateCard` component, fed the owner's own data — no second, bespoke "preview card" component (the exact anti-pattern Feature 24 §11 already found and fixed once for `WhoLikedMeList`, not repeated here).
- A real "ویرایش پروفایل" button/link in view mode, into the existing `PhotoGrid` + `ProfileForm` edit UI, unchanged.
- On a real successful save, the user lands back in view mode showing the just-saved data — not left on the form.

### 4. Explicitly out of scope

- Any change to `CandidateCard` itself, to `ProfileForm`, to `PhotoGrid`, or to the incomplete-profile onboarding flow (choice/manual/conversational) — all reused or left exactly as they are.
- Any change to what data the deck/AI-search/Who-Liked-Me surfaces show of this user to others — this feature only changes what the owner sees of their own profile, on their own `/profile` tab.

### 5. Functional requirements

- FR-470: The `/profile` tab's complete-profile branch renders a real view mode by default: the existing `CandidateCard`, given a real, client-side-mapped `DeckCandidate`-shaped object built from `GET /v1/profile/me`'s own response (`Profile`) plus the authenticated user's `id`/`livenessStatus` from the auth store (own age computed client-side from `birthDate`, mirroring `backend/src/common/age.util.ts`'s exact real/no-future-birthday logic) — not a new backend endpoint, since `/v1/profile/me` already returns every field `CandidateCard` needs.
- FR-471: A real "ویرایش پروفایل" button in view mode switches to the existing edit form (`PhotoGrid` + `ProfileForm`), unchanged.
- FR-472: A real successful `PATCH /v1/profile` save (via the existing `ProfileForm`'s own `onSaved` callback) returns the tab to view mode, showing the freshly-saved data (the same query-invalidation refetch the edit form already triggers, read by the now-current view-mode render) — not left on the form.
- FR-473: View mode itself is purely a local, in-page UI mode (not a route, not persisted) — reloading `/profile` always returns to view mode for a complete profile, matching how a fresh tab visit should behave.

### 6. Security requirements

None beyond what already applies — this feature adds no new data surface (reuses `GET /v1/profile/me`, already the owner's own authenticated read) and no new write path (reuses the existing `PATCH /v1/profile` via the unchanged `ProfileForm`).

### 7. Acceptance criteria

- [x] A complete profile's `/profile` tab opens on a real `CandidateCard` view showing the owner's real photos, prompt answers, and about-me chips — verified against a real seed user (علی رضاییان — `docs/test-users.md`) in a real logged-in browser session, not a synthetic fixture, plus a dedicated e2e test (`e2e/profile.spec.ts`'s new FR-470..473 test).
- [x] "ویرایش پروفایل" opens the real, unchanged edit form. Verified manually and via the same dedicated e2e test.
- [x] A real save returns to view mode showing the just-changed field, confirmed via a real reload too (not just in-memory state). Verified manually (a real bio edit) and via the dedicated e2e test (a real city-field edit, checked both immediately and after a full page reload).
- [x] An incomplete profile's existing choice/manual/conversational flow is confirmed unchanged. Verified manually with a fresh phone number through the full choice→liveness→choice-screen path, and via all 9 tests in `e2e/profile.spec.ts` (which exercises this flow directly, including the exact moment a profile flips complete *mid*-onboarding — see §11 below for a real regression this caught).
- [x] **Targeted, not a full-suite re-run** — no backend code changed, so the backend unit/e2e suites weren't re-run; a precise grep across every `e2e/*.spec.ts` file for the only two ways this changed branch is reachable (`goto`/`gotoResilient` to `/profile`) found exactly 3 call sites outside this feature's own new test, in `e2e/profile-depth.spec.ts` (2) and `e2e/who-liked-me.spec.ts` (2 — one grep match was itself two separate sites), all fixed and confirmed passing, plus the full `e2e/profile.spec.ts` (9/9) and `e2e/profile-depth.spec.ts` (2/2) and `e2e/who-liked-me.spec.ts` (2/2) suites re-run clean.

### 11. Real findings from implementation

- **A real, user-visible regression caught before it shipped, not by inspection alone but by actually running the existing suite.** The first implementation made view mode the default whenever `isComplete` was true, full stop. `isComplete` also flips true *while a user is still actively completing their profile* through the manual/conversational onboarding flow (e.g., the exact moment a photo upload finally satisfies FR-227) — which would have yanked the user out of the form they were using and into read-only view mode, uninvited, the instant their profile crossed the completeness threshold. Invisible before this feature (the old code rendered the identical edit UI in both branches, so the same reactive flip already happened silently), but a real, jarring UX bug once the two branches actually differ. Fixed by additionally gating view mode on `mode === "choice"` — true only when the profile was already complete when the page mounted, never once the user has entered either onboarding path this session — confirmed by re-running the full `e2e/profile.spec.ts` suite (9/9), which exercises this exact mid-onboarding-completion moment in multiple tests.
- **Three existing e2e tests broke from this change, found by grepping for the only reachable call sites, not by running the whole suite blind and hoping.** `e2e/profile-depth.spec.ts` (a fresh `/profile` visit, and a post-save reload, each immediately followed by editing form fields) and `e2e/who-liked-me.spec.ts` (two separate `/profile` visits to edit about-me fields and the hide-drinking/smoking toggle) all assumed the old "always the edit form" behavior. Fixed by inserting a real `"ویرایش پروفایل"` click before each — not by disabling or loosening any assertion.

---

## Feature 26: Systematic UX/UI Final Review (Frontend)

**Status:** ✅ Implemented and verified — one acceptance criterion (full e2e regression) is explicitly, honestly deferred, blocked by the real, ongoing OpenAI credit outage documented in `docs/roadmap.md`, not silently skipped. Full findings: `docs/visual-audit-findings.md`'s Feature 26 section.

**Depends on:** Feature 23 (the audit method and the 8-criterion checklist this feature extends, not replaces), `docs/design-system.md` (the source of truth this checks against, extended by §5 below), Features 24/25 (real new screens that postdate Feature 23 and were never audited), the real `/matches` layout fix made just before this feature was scoped (§1 below builds directly on it).

### 1. Why this is Feature 26, not a Feature 23 amendment

Feature 23 was audited, fixed, and closed — reopening its own record to add new screens/criteria discovered afterward would misrepresent what that pass actually reviewed (the same reasoning Feature 25 gave for not folding into Feature 24). Three real, concrete things happened since Feature 23 closed that this feature exists to address:

1. **A real bug Feature 23 didn't catch: `/matches`'s conversation rows stretched edge-to-edge with a large, unexplained dead gap between the name/preview block and the timestamp — reproducible even at real mobile width (375px), not just on a wide desktop viewport.** Root cause: a `flex-1` middle column with nothing bounding the row's own width, so it stretched to fill whatever viewport it was in. Already fixed directly (a real, bounded, `rounded-2xl` card per row) as an immediate bug report, ahead of this feature — but its existence at all is the direct trigger for §3 below: Feature 23's own screenshots were mobile-width but this specific failure mode wasn't visually obvious enough in a screenshot to be caught, which is exactly what §3's new mandatory-375px-viewport rule and §2's new "real, naked-eye visibility" criterion are for.
2. **Feature 23 explicitly deferred giving `/matches` rows a real card shape** ("adding a shadow to an edge-to-edge rectangle with no visible boundary would look visually broken... a real fix here would mean restructuring the rows into card shapes first, which is a bigger, separate change than this pass's own scope" — Feature 23 §9). That restructuring now exists (item 1 above) — which means `docs/design-system.md` §1.3's own elevation table can finally apply as originally written: its Level-1 row explicitly names **"match-list row"** as a `--elevation-1` example, a token that was never actually appliable until the row became a real card. Closing this is in scope here (FR-478).
3. **Two real features shipped after Feature 23 closed and were never audited at all**: Feature 24 (profile depth + "Who Liked Me") and Feature 25 (the profile tab's own new default view mode). Neither exists in Feature 23's 22-screen table.

### 2. A ninth compliance criterion, added to Feature 23's existing eight (§2 there, A–H)

- **(I) Real, naked-eye visibility** — every depth/shadow/glow/card-boundary treatment this feature adds or re-verifies must be clearly visible in a real, un-zoomed screenshot viewed at normal size, not only provable by inspecting `getComputedStyle` in DevTools. Concretely: after each change, Claude takes a real screenshot and visually confirms the difference is obvious without zooming in or reading computed CSS — if there's any doubt, the effect is strengthened, not left as a technically-correct-but-invisible value. This directly generalizes `docs/design-system.md` §1.3's own revision history (three real, evidence-driven rounds — v1 and v2 were each genuinely wired in and still failed this exact test) into a standing rule for this pass, rather than something that has to be independently rediscovered per component.

### 3. Two standing verification rules for this pass (not new criteria — how §2's criteria get checked)

- **Every screenshot in this feature is taken at a real 375px-wide viewport, not desktop width.** Feature 23's screenshots were already "mobile-width" in intent, but not verified against an exact, real device width — the `/matches` bug in §1 existed identically at 375px and was only actually confirmed there, not assumed from a desktop capture. `frontend/e2e/visual-audit.spec.ts`'s existing Playwright project config is checked directly (not assumed) and set to a real 375×812 viewport for every capture this feature adds or re-shoots.
- **Every page in §4 below gets both a new-user state and an existing-user state captured where the two genuinely differ, and every persistent component (the bottom tab bar, any shared header) is captured and checked directly at least once as its own subject** — not credited as "reviewed" merely for appearing in the background of an unrelated screen's screenshot. This directly closes the exact gap Feature 23 itself hit and had to patch after the fact (§9 there: the tab bar and `PhotoGrid` were never independently checked and both turned out to have a real, missing elevation value, found only once the user asked a second time).

### 4. In scope — screens/states to (re-)capture and audit

**A. Full re-verification of all 22 states already in Feature 23 §3's table (including its own later-added #22, the pre-Feature-25 profile view)**, checked freshly against Criterion I and the new spacing scale (§5) — not re-tabulated here since the screen list itself hasn't changed for these; re-captured at the real 375px viewport per §3 above (not assumed identical to Feature 23's own captures, which predate that explicit rule).

**B. Genuinely new screens/states, never audited before:**

| # | Screen / state | Route / trigger | New or existing user |
|---|---|---|---|
| 23 | Discovery — empty deck ("فعلاً کسی نمونده") | `/`, after exhausting real candidates | Existing |
| 24 | Matches — list, populated (post-fix) | `/matches` | Existing, ≥1 match |
| 25 | Matches — list, empty ("هنوز مچی نداری") | `/matches`, zero matches | A brand-new matched-with-no-one user |
| 26 | Matches — chat, real message thread (bubble density/spacing, not just the header) | `/matches/:matchId`, several real messages each side | Existing |
| 27 | Who Liked Me — populated | `/liked` | Existing, ≥1 real liker |
| 28 | Who Liked Me — empty | `/liked`, zero likers | A brand-new, unliked user |
| 29 | Profile — Feature 25 default view mode | `/profile` | Existing, complete profile (supersedes Feature 23's own #22, the pre-Feature-25 edit-form view) |
| 30 | AI Search — text mode, results | `/`, "جست‌وجوی هوشمند" tab, a real text query | Existing |
| 31 | AI Search — voice mode, recording | Same tab, mic pressed, mid-recording | Existing |
| 32 | Calls — incoming-call overlay (ringing) | `IncomingCallOverlay`, a real incoming call | Existing (both call participants are real, existing users) |
| 33 | Tab bar — standalone, direct check | Any tab-bar-visible screen | Either |

Filters panel, in-call screen, Settings/Help Center/Safety, and Share My Date (create/manage + public page) are already in Feature 23's table (A above) and are re-verified there, not re-listed — they need re-checking against Criterion I and the spacing scale, not a new capture setup.

### 5. A real spacing scale — deferred by Feature 23, resolved here per explicit instruction

`docs/design-system.md` §8 Open Items #1 explicitly left spacing unspecified pending a separate, deliberate request — this is that request. A real, small numeric scale (base unit 4px: 4/8/12/16/24/32/48) is added to `docs/design-system.md` as a new §9 (not renumbered into §1, to avoid disturbing every existing cross-reference to §1.1–§1.3 throughout this document and Feature 23's own write-up), built the same evidence-based way as §1.3 (a real preview, adjusted from what's first tried if a value doesn't read as intended, not written blind). Every screen in §4 above is checked for arbitrary, inconsistent spacing (e.g. two visually-similar rows using different padding for no reason) and brought onto the new scale — this is a real-code remediation pass, not just a documentation exercise.

### 6. Patterns to draw on (inspiration, not a copy) — Bumble/Hinge, already reviewed together

- **Lists (chat, Who Liked Me) are compact, row-based, and bounded** — each row its own card (background + rounded corners), matching the real `/matches` fix in §1, applied consistently anywhere else a list exists.
- **Primary action buttons (swipe pass/super-like/like, call-start) are large, saturated, and unmistakably distinct** — this is what `docs/design-system.md` §1.3's `--elevation-cta-*` tokens already exist for; this pass confirms they're actually applied everywhere a primary action appears, not just where Feature 23 happened to check.

### 7. Explicitly out of scope

- Inventing new colors, icons, gradients, or animations `docs/design-system.md` doesn't already define — same restraint Feature 23 §4 already established, unchanged here.
- Redesigning any interaction/gesture pattern (swipe-to-dismiss, drag physics) — visual/spacing/depth compliance only.
- Any change touching real backend moderation calls (profile writes, photo uploads) — this feature is frontend-only by construction (existing seed data/screens are reused, nothing new is written through `PATCH /v1/profile` or `POST /v1/profile/photos`), so it is **not blocked** by the current real OpenAI-credit exhaustion (`docs/roadmap.md`, "Before production") the way the bulk-seeding work was.

### 8. Functional requirements

- FR-474: A ninth compliance criterion (Criterion I, §2 above — real naked-eye visibility) is added to the audit checklist and applied to every fix this feature makes, verified by a real, un-zoomed screenshot per change.
- FR-475: `frontend/e2e/visual-audit.spec.ts`'s Playwright project config captures every screenshot in §4 at a real 375×812 viewport — confirmed by reading the actual config, not assumed.
- FR-476: Every screen in §4.B that has a meaningfully different new-user vs. existing-user state captures both; every persistent component (tab bar, shared headers) gets at least one screenshot where it is the direct subject of the check, not merely visible in the background of another screen's capture.
- FR-477: A real spacing scale is added to `docs/design-system.md` §9 (4/8/12/16/24/32/48, base unit 4px), and every screen in §4 (A and B) is checked against it — inconsistent arbitrary spacing is a real, fixable finding like any Criterion A–I violation, not a separate, lower-priority category.
- FR-478: `--elevation-1` is applied to the real, now-card-shaped `/matches` conversation rows (§1 item 2), closing the exact gap `docs/design-system.md` §1.3's own table already specifies but Feature 23 could not apply before the row had a real card boundary.
- FR-479: All §4.A/§4.B screens are re-screenshotted after fixes (before/after pairs retained as real files, matching Feature 23's own FR-429 convention) — a final report with the most significant before/after pairs is delivered directly to the user, per this feature's own §10.

### 9. Acceptance criteria

- [x] All 22 Feature 23 screens are re-captured at a real 375px viewport and re-checked against Criteria A–I plus the new spacing scale. No new violations found beyond the cross-cutting fixes below.
- [x] All 11 new screens/states in §4.B have a real, saved screenshot (new-user and existing-user variants where they differ, using real seed accounts throughout — see §11 below for why).
- [x] The tab bar and any shared header are directly, independently verified (#33) — not only visible in another screen's background, and already correctly elevated from Feature 23's own retroactive fix.
- [x] `docs/design-system.md` §9 (spacing scale) exists, with real values (a real codebase survey, not invented) and a real rationale, matching §1.3's own evidence-based standard.
- [x] `/matches` conversation rows carry `--elevation-1` (FR-478), confirmed via a real screenshot showing the glow at normal viewing size (Criterion I).
- [x] Every finding is either fixed (with a re-screenshot) or explicitly deferred with a stated reason — none silently dropped. Full record: `docs/visual-audit-findings.md`'s Feature 26 section.
- [x] **Explicitly, honestly deferred, not silently skipped**: the full existing e2e suite could not be re-run clean — `discovery.spec.ts` (7/7 tests) failed at the identical point, the real, already-documented OpenAI credit exhaustion (`docs/roadmap.md`) blocking `loginAndCompleteProfile()`'s real photo upload; `matches-chat.spec.ts`/`who-liked-me.spec.ts`/`profile-depth.spec.ts`/`settings.spec.ts` all depend on the same helper and weren't run blind against a wall already proven solid. What *was* verified instead: `visual-audit.spec.ts` itself (deliberately reworked to use only existing seed logins) — 18/18 clean, directly exercising every changed component — plus live, interactive, real-browser confirmation of every fix. No logic changed anywhere in this pass (CSS/positioning only), so a clean result is expected once credit is restored, but not yet *proven* by the automated suite the way Feature 23's own regression was. See §11 below.
- [x] A final written report with real before/after image pairs for the most significant changes is delivered directly to the user (chat), not just written to a file.

### 11. Real findings from implementation

- **A real, confirmed bug found by running the new capture at the real 375px viewport for the first time**: `VoiceMicButton`'s recording hint bubble (shared by AI Search and Conversational Setup) was centered on a button sitting near the physical right edge of the screen — the bubble overflowed the real viewport and was silently clipped, invisible on any prior desktop-width capture. Fixed by anchoring it to the button's own edge instead of centering it (getting the RTL logical-property direction wrong once — `end-0` instead of `start-0` — before verifying it live and correcting it), then widening its clearance twice more after Criterion I's own "if in doubt, strengthen it" standard caught it still touching the input box above.
- **A real, confirmed bug found only because the live OpenAI outage surfaced a failure path the existing test suite had only ever mocked, fixed on the frontend rather than deferred to the backend**: `openai-extraction.provider.ts`'s real error messages are raw, English, developer diagnostics; `ai-search.tsx` was, per FR-277's original design ("exactly as the backend sends it"), showing that raw text verbatim to Persian users. `discovery.spec.ts`'s own FR-277 test only ever exercised a *fabricated* Persian mock response — the real backend has never actually sent anything resembling it, so this never surfaced until this pass. Initially written up here as backend-only/out-of-scope, but a legitimate, in-scope, frontend-only fix exists and was applied instead: `ai-search.tsx` no longer reads `activeError.problem.detail` for display at all — the 503 and 429 branches now show a fixed, generic Persian message, independent of whatever the backend's real error text actually is. `discovery.spec.ts`'s FR-277 test updated accordingly (mocks a raw English `detail`, asserts the generic Persian message displays and the raw text does not); confirmed live against the real, currently-failing backend via `visual-audit.spec.ts` capture 28.
- **A real capture-script bug, not a product bug, found and fixed generically rather than per-screen**: `fullPage: true` screenshots on any page taller than one viewport, combined with `TabBar`'s real `position: fixed` nav, made Playwright's stitching repeat the nav (and whatever page content sat behind it) at each viewport-height boundary. Confirmed as a pure artifact by comparing against a live, viewport-only screenshot of the identical page. Fixed once in the shared `capture()` helper (hide the nav for the instant of the capture); the one screen where a fixed element *is* the real subject (the incoming-call overlay, #32) uses a new `viewportOnly` capture mode instead.
- **A real test-data lesson, hit twice, from picking seed users by a single criterion (zero matches / zero likes) without also checking verification status**: three of the users satisfying "zero matches" or "zero likes received" are also part of the deliberately-unverified 6 (`docs/test-users.md`), whose real login flow stops at the liveness-consent screen — logging in as one and clicking through would have *permanently* flipped a real, curated verification flag other suites (`settings.spec.ts`) depend on. Caught before that happened for the empty-matches capture (a real login failure surfaced it) and avoided pre-emptively for empty-Who-Liked-Me (a route-mock on a verified user instead).
- **This feature's own two credit-dependent captures (originally #10, #14) were converted to use real, existing seed-user logins instead of fresh signups**, specifically so `visual-audit.spec.ts` could genuinely honor its own §7 claim of not being blocked by the ongoing OpenAI credit outage — required re-picking the paired seed users twice more during iteration, since each successful run of capture 10 creates a real, permanent match that consumes that specific pair for any later re-run.

### 10. Deliverable format

Findings and before/after pairs are recorded as a new, clearly-dated section appended to the existing `docs/visual-audit-findings.md` (not a second, separate findings file) — this is a continuation of the same real audit trail Feature 23 started, not an unrelated document.

---

## Feature 27: Online Status / Last Active + New Members

**Status:** ✅ Implemented and verified — every mechanism confirmed live against the real running app; one acceptance criterion (the automated backend e2e suite) is explicitly, honestly blocked by the same real, ongoing OpenAI credit outage already documented throughout `docs/roadmap.md`, not silently skipped. See §11.

**Depends on:** `RedisService` (`backend/src/redis/redis.service.ts`, the same shared Redis instance `RedisIoAdapter` already uses for cross-instance chat delivery, FR-59), `ChatGateway` (`backend/src/modules/chat/chat.gateway.ts` — the app's one and only real-time transport, opened once app-wide per FR-330/`lib/websocket-client.ts`), Feature 6/20's Settings infrastructure (`backend/src/modules/settings/`, the `allowInSafetyShares`-style toggle pattern), Feature 3's `buildSafetyExclusionWhere` (`backend/src/modules/discovery/candidate-exclusion.util.ts`) and `DiscoveryPreferences.activeThisWeekOnly` (the exact precedent this feature's "New Members" filter mirrors), `frontend/lib/relative-time.ts` (`formatRelativeTime()`, already shipped and in production use at `match-list.tsx:191`).

### 1. Goal

Two related, but independently shippable, pieces: (A) a real, Redis-backed online/last-active presence system — a live green dot when a user is genuinely connected, and a Hinge-style relative "فعال N پیش" string when they aren't — shown on the discovery card, the matches list, and the chat header, gated by a new symmetric privacy toggle; (B) a "New Members" discovery filter, built as a straight structural copy of the existing "Active this week" filter (`activeThisWeekOnly`), so it inherits the exact same safety-exclusion guarantees with no new code path to get wrong.

### 2. Architecture — presence

**Why Redis, not Postgres, for the live signal:** matches this codebase's own established reasoning for using Redis for `ChatGateway`'s pub/sub (docs/architecture.md §5.11) — connection state is high-churn, ephemeral, and meaningless once a process restarts; writing it to Postgres on every connect/heartbeat/disconnect would mean real, pointless write load on the one durable store, for data with no durability value. Exactly one thing gets persisted to Postgres: the moment a user was *last* confirmed online (§2.3).

**2.1 Connection tracking (multi-tab/multi-device safe).** `ChatGateway` already opens the app's one real-time connection per FR-330 — this feature extends it rather than opening a second socket. New `PresenceService` (`backend/src/modules/presence/presence.service.ts`), backed by `RedisService.client`, using two key shapes per user:
- `presence:online:<userId>` — existence-only key (value irrelevant), **TTL 45s**. `EXISTS` on this key is the entire definition of "is this user online right now."
- `presence:sockets:<userId>` — a Redis **Set** of that user's currently-known-live socket IDs (no TTL on the set itself — see 2.4 for why that's safe).

On `handleConnection` (extending the existing method, `chat.gateway.ts:56`): `SADD presence:sockets:<userId> <socket.id>`, then `SET presence:online:<userId> 1 EX 45`.

**2.2 Heartbeat.** `ChatGateway` gains a new `@SubscribeMessage('presence:heartbeat')` handler that runs `EXPIRE presence:online:<userId> 45`. The frontend's single shared socket module (`frontend/lib/websocket-client.ts`) starts a `setInterval(() => socket.emit('presence:heartbeat'), 20_000)` on `"connect"` and clears it on `"disconnect"` — a 20s heartbeat under a 45s TTL tolerates up to two consecutive missed beats (a transient network blip) before the online key actually expires, while still converging to "offline" within under a minute of a genuine loss.

**2.3 Disconnect — the one authoritative write to Postgres.** `ChatGateway` gains `implements OnGatewayDisconnect` and a new `handleDisconnect(socket)`: `SREM presence:sockets:<userId> <socket.id>`, then `SCARD presence:sockets:<userId>`. If the count is now **0** (this was the user's last open tab/device — FR-481's multi-device rule), it: (a) `DEL presence:online:<userId>` — mark offline immediately, rather than waiting up to 45s for the TTL, so the common graceful-close case is instant and accurate; (b) `UPDATE "User" SET "lastOnlineAt" = now()` via a new `PresenceService.recordLastSeen()` call into `UsersService`/Prisma. If the count is still **>0**, nothing else happens — other tabs/devices are still heartbeating the same `presence:online:<userId>` key, so the user correctly stays online (FR-481).

**2.4 A real, explicitly accepted approximation, not a silent gap.** If the app *process itself* crashes (not a graceful disconnect — mirroring the exact "orphaned in-memory state" class of bug already documented for `RedisIoAdapter`, docs/architecture.md §5.3/§5.11), `handleDisconnect` never runs for whatever sockets that instance held, so `presence:sockets:<userId>` can be left holding a phantom socket ID forever, and `lastOnlineAt` won't get its authoritative update from 2.3 for that specific transition. This does **not** break the live "is online" signal — `presence:online:<userId>`'s own independent 45s TTL still expires normally within 45s regardless of the stuck Set, since a crashed instance stops sending heartbeats too. It only means `lastOnlineAt` can lag stale by an unbounded amount until this user's *next* legitimate connect+disconnect cycle. Bounded in practice by a lazy self-heal: whenever `PresenceService.isOnline()` (or its batch form, §2.5) finds `presence:online:<userId>` absent while `presence:sockets:<userId>` is still non-empty (an inconsistent state only reachable via a crash), it deletes the stale Set and calls `recordLastSeen()` right then — so on any actively-read surface (deck, matches, chat — all read constantly) the staleness window collapses to "next real request," not "next reconnect." Documented here rather than silently assumed away, matching this project's own standing practice for this exact class of gap.

**2.5 Batched reads.** `PresenceService.getOnlineMap(userIds: string[]): Promise<Map<string, boolean>>` pipelines one `EXISTS` per ID in a single round trip (mirroring the existing batched-photo-URL pattern in `deck.service.ts:218-224`) — every call site below needs this for an entire page of candidates/matches at once, never one Redis round trip per row.

### 3. Architecture — the symmetric privacy rule (FR-484/FR-485)

New `User.showLastActiveStatus Boolean @default(true)` column, wired through Settings exactly like `allowInSafetyShares` (`backend/src/modules/settings/dto/update-privacy.dto.ts`, `settings.service.ts`'s `UserSettings`/`SETTINGS_SELECT`, `PATCH /users/me/privacy`) — no new endpoint. Frontend: one new toggle in `frontend/components/settings/privacy-section.tsx`, copied from the existing `allowInSafetyShares` checkbox exactly (`useMutation` optimistic-update block, same revert-on-error behavior).

**The rule itself (WhatsApp's own precedent, named explicitly by the user):** for a viewer `X` looking at a candidate/match/conversation-partner `Y`, presence is computed and shown **only if `X.showLastActiveStatus AND Y.showLastActiveStatus`** — both on. If either is off, the field is `null` (not "shown as offline," genuinely absent — no dot, no relative text, nothing rendered) for that pair, in **both directions** — turning it off hides your own status from others *and* removes your own ability to see anyone else's, with no way to have one without the other. Implemented once in `PresenceService.buildPresenceField(viewerAllows, targetAllows, online, lastOnlineAt)`, called from every site in §4 — never re-implemented per call site.

### 4. Where presence is attached (backend)

A shared `{ online: boolean; lastOnlineAt: string | null } | null` field, computed via `PresenceService`, added at:
- `DeckCandidate` (`deck.service.ts`), computed inline in the candidate-building map (`deck.service.ts:209`) the same way `verified: u.livenessStatus` already is — same treatment at the other two places that build a `DeckCandidate`: `AiSearchService.search()` (`ai-search.service.ts:165`) and `WhoLikedMeService.list()` (`who-liked-me.service.ts:83`).
- `MatchSummary.user` (`match.service.ts`'s `listMatches()`, line 32).
- `ConversationSummary.otherUser` (`conversation.service.ts`'s `listConversations()`, line 34) — this is what feeds the chat header.

Each of these five call sites already loads (or can cheaply add to its existing `select`/`findMany`) the two new `User` columns (`lastOnlineAt`, `showLastActiveStatus`) and the viewer's own `showLastActiveStatus` (fetched once per request, exactly how `deck.service.ts:108-116` already fetches `viewer` facts once), then calls `PresenceService.getOnlineMap()` once for the whole page/list and `buildPresenceField()` per row.

### 5. Frontend display (FR-487/FR-488)

Three surfaces, each already reading a `verified: boolean` today — presence is added the same way, not as a new component:
- `frontend/components/discovery/candidate-card.tsx` — a small solid `--turquoise` dot (no icon; that token is this palette's only green-reading color and is already used for routine, non-signature UI per `docs/design-system.md` §1.2, so a plain presence dot doesn't compete with the reserved signature gradient) when `presence?.online`, placed near the existing bottom badge row (`candidate-card.tsx:130`); the relative-time string when not online and `lastOnlineAt` is non-null; nothing at all when `presence` is `null` (privacy-hidden) or `lastOnlineAt` is `null` (no recorded history yet — never fabricate a claim, matching this project's standing rule against invented data).
- `frontend/components/matches/match-list.tsx`'s `MatchAvatar` (lines 24-61) — the dot as a new absolutely-positioned sibling of the existing verified badge (`-bottom-0.5 -left-0.5`), at the opposite corner (`-top-0.5 -left-0.5`) so the two never collide; used by both the "new matches" carousel (line 151) and conversation rows (line 180) automatically, since both call the same component.
- `frontend/components/chat/conversation-view.tsx`'s header (`otherUser` avatar block, lines 207-220) — the dot on the avatar `<div>` (needs `relative` added, currently absent), plus the relative-time text placed next to `displayName` when offline.
- **Relative-time text reuses the already-shipped `formatRelativeTime()` (`frontend/lib/relative-time.ts`) verbatim, prefixed with "فعال"** (e.g. "فعال ۳ ساعت پیش", "فعال ۲ روز پیش") rather than building a second, competing formatter — **this is a deliberate deviation from the literal "فعال امروز" example in the original instruction**, in favor of reusing already-shipped, already-tested code with one real production call site already. Flagged explicitly here for review — if a distinct same-day/"امروز" bucket is wanted instead, that's a real, separate small addition to `relative-time.ts` itself (shared by its existing caller too), not scoped silently into this decision.
- Exact pixel placement/sizing is confirmed against a real, un-zoomed 375px screenshot before being called done, per Feature 26's own Criterion I — not dictated to the pixel in this document.
- FR-488 (WCAG, matching this project's standing accessibility bar): the dot always carries a real `aria-label` — `"آنلاین"` when live, or the same relative-time string (e.g. `"فعال ۲ ساعت پیش"`) when not — never a bare decorative `<span>` with no accessible name.

### 6. New Members (FR-489..FR-492)

Modeled as a structural copy of `activeThisWeekOnly` (`DiscoveryPreferences.activeThisWeekOnly`, `deck.service.ts:131-137`, `preferences.service.ts`, `update-preferences.dto.ts:61`, `filters-panel.tsx:190-199`), not a new endpoint or a new safety mechanism:
- New `DiscoveryPreferences.newMembersOnly Boolean @default(false)` column, added to `EffectivePreferences`/`DEFAULT_PREFERENCES` (`preferences.service.ts`) and `UpdatePreferencesDto` (`update-preferences.dto.ts`) exactly like `activeThisWeekOnly`.
- `deck.service.ts`'s existing `where` builder (`deck.service.ts:123-138`, already spreading `buildSafetyExclusionWhere(userId, viewer.livenessStatus)` at line 124) gets one more conditional branch: `...(prefs.newMembersOnly ? { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } : {})`. Because this is one more branch in the *same* `where` object that already starts from `buildSafetyExclusionWhere(...)`, it structurally cannot be reached by a blocked user or (when `verifiedOnly` is separately on) an unverified one — there is no second, parallel query to keep in sync, directly satisfying the explicit "must go through the same safety function" instruction by construction, not by remembering to call it a second time.
- New `frontend/components/discovery/filters-panel.tsx` toggle "فقط اعضای جدید", copied from the existing "فقط کاربران فعال این هفته" toggle (lines 190-199) verbatim in structure.
- FR-490: a separate `isNewMember: boolean` (`user.createdAt >= sevenDaysAgo`) is computed inline at all three `DeckCandidate` call sites (deck/ai-search/who-liked-me — the same three places `verified` and the new presence field are computed), independent of the `newMembersOnly` toggle — the "جدید" badge shows on a new member's card wherever it happens to render (including the plain, unfiltered deck), not only inside the dedicated filtered view.
- FR-491: a new "جدید" badge pill on `candidate-card.tsx`, styled exactly like the existing `likedWith` badge (`candidate-card.tsx:143-161` — `rounded-full px-2 py-0.5 text-[10px] font-extrabold`, a solid palette background with a dark custom text color for contrast), shown whenever `isNewMember` is true.

### 7. Functional requirements

- FR-480: A real, Redis-backed live-presence mechanism (§2.1-2.3): `ChatGateway`'s existing single app-wide connection registers a 45s-TTL `presence:online:<userId>` key on connect, refreshed by a client-emitted `presence:heartbeat` every 20s, and a `presence:sockets:<userId>` Set tracks that user's live socket IDs for multi-device accounting.
- FR-481: A user counts as offline only once their *last* tracked connection closes (`SCARD presence:sockets:<userId> === 0`) — closing one of several open tabs/devices never flips them offline while another stays connected.
- FR-482: A new, permanent `User.lastOnlineAt DateTime?` column is stamped at the exact moment a user's last connection closes (§2.3) — a distinct field from the pre-existing `User.lastActiveAt` (FR-49, stamped only on OTP/login verify, read only by the unrelated "active this week" deck filter); the two must never be conflated or merged.
- FR-483: A crash-orphaned connection record self-heals on the next presence read rather than silently staying wrong forever (§2.4) — an explicitly accepted, bounded approximation, not a claim of perfect real-time accuracy across an app-process crash.
- FR-484: A new `User.showLastActiveStatus Boolean @default(true)` privacy toggle, exposed via the existing `PATCH /users/me/privacy` (no new endpoint), with a corresponding new toggle in the frontend Settings privacy section, styled and wired exactly like the existing `allowInSafetyShares` toggle.
- FR-485: Presence visibility is symmetric (§3): computed and shown for a viewer/target pair only when **both** users have `showLastActiveStatus = true`; `null` (fully absent, not "shown offline") for the pair otherwise, in both directions at once.
- FR-486: The presence field is attached at all five real places another user's identity is shown with a photo: the deck, AI Search results, and Who Liked Me (all three via `DeckCandidate`), the matches list (`MatchSummary.user`), and the chat header (`ConversationSummary.otherUser`).
- FR-487: The frontend shows a live green dot on the avatar when `online: true`; the relative "فعال … پیش" string (via the existing, already-shipped `formatRelativeTime()`, prefixed "فعال") when `online: false` and `lastOnlineAt` is non-null; nothing at all when presence is `null` or `lastOnlineAt` is `null` — across all three surfaces named in §5.
- FR-488: The presence dot always carries a real, specific `aria-label` ("آنلاین", or the same relative-time string shown visually) — never an unlabeled decorative element, matching this project's standing WCAG bar.
- FR-489: A new `DiscoveryPreferences.newMembersOnly` toggle filters the deck to `User.createdAt` within the last 7 days, implemented as one more branch inside `deck.service.ts`'s existing `buildSafetyExclusionWhere`-based `where` object (§6) — structurally, not just procedurally, inheriting every existing safety exclusion (blocked users, verified-only gating).
- FR-490: An `isNewMember` boolean (createdAt within 7 days) is computed at all three `DeckCandidate` call sites, independent of whether the `newMembersOnly` filter is active.
- FR-491: A "جدید" badge renders on `candidate-card.tsx` whenever `isNewMember` is true, styled per the existing `likedWith` badge convention.
- FR-492: A new "فقط اعضای جدید" toggle in the filters panel, structured exactly like the existing "فقط کاربران فعال این هفته" toggle.
- FR-493: A real, dedicated e2e test (modeled on `test/chat.e2e-spec.ts`'s existing two-independent-app-instance pattern) proves genuine cross-instance presence: a real socket connects on instance B; a REST read on instance A shows the target as online; the socket disconnects; a REST read on instance A shows offline with a fresh `lastOnlineAt`; a second socket (simulating a second tab) confirms closing only one of two open connections keeps the user online; a third case confirms the symmetric privacy rule actually hides presence both ways when either side's toggle is off.
- FR-494: A real test (unit or e2e) confirms the New Members filter excludes a blocked user and, when `verifiedOnly` is separately active, an unverified user — proving §6's "same safety function" claim empirically, not just by code inspection.

### 8. Security requirements

- Presence data is never a new exposure path on its own: every one of the five attachment points in §4 is already gated by that surface's own existing visibility rules (`buildSafetyExclusionWhere` for the deck/AI-search/Who-Liked-Me; `ConversationSummary`'s existing block-hiding, per `match-list.tsx`'s own comment: "authoritative for visibility — hides matches the caller blocked") — a user who cannot see someone at all today gains no new way to observe their online status either.
- Only a boolean and a single timestamp are ever exposed — no socket ID, no connection count, no device/client metadata, no IP, nothing beyond what `verified`/`lastActiveAt` already established as an acceptable level of exposure for this app.
- The symmetric privacy toggle (FR-485) is enforced once, centrally, in `PresenceService.buildPresenceField()` — never re-implemented per call site, so a future sixth call site cannot accidentally skip it the way a duplicated inline check could.
- Redis keys are addressed only by internal `userId` (a UUID) — no phone number, display name, or other PII ever appears in a Redis key or value for this feature.

### 9. Explicitly out of scope

- Real-time push of a presence *change* to an already-open screen (e.g., a chat header's dot flipping live without a refetch) — presence is computed fresh on each REST read (§4), which is sufficient for every acceptance criterion in §10; a live-push enhancement via `ChatGateway` emitting a `presence:changed` event is real, plausible future work, not built here, matching this project's own general restraint precedent of shipping the simplest mechanism that satisfies the actual stated requirement.
- A "last seen" granularity finer than what `formatRelativeTime()` already provides (no exact timestamp is ever shown to another user).
- Any change to `activeThisWeekOnly` itself, or to any other existing `DiscoveryPreferences` filter.
- Extending "New Members" to AI Search or Who Liked Me — scoped to the deck only, mirroring `activeThisWeekOnly`'s own existing scope exactly.

### 10. Acceptance criteria

- [x] A real, two-independent-app-instance e2e test proves live online status is visible cross-instance via shared Redis, not per-process memory (FR-493, `test/presence.e2e-spec.ts`) — **the OpenAI outage that originally blocked this ended mid-feature (credit restored 2026-09-14); re-run clean against the real vendor**, all 3 tests passing individually. See §11 for a real ordering bug this re-run found and fixed.
- [x] Disconnecting the last of several open connections for a user marks them offline and stamps `lastOnlineAt`; disconnecting one of several does not (FR-481) — confirmed by `presence.service.spec.ts` (13 unit tests) and the real e2e run above.
- [x] The symmetric privacy toggle genuinely hides presence in both directions when either party has it off — confirmed by the real e2e run above (FR-485).
- [x] The green dot, the relative "فعال … پیش" text, and a real `aria-label` are all confirmed via a real 375px screenshot for all three surfaces (discovery card, matches list, chat header) — per Feature 26's Criterion I (FR-487/488). See §11 for the real, pre-existing bug this screenshot pass found and fixed along the way.
- [x] The New Members filter is confirmed, by a real e2e test, to exclude a blocked user and (when `verifiedOnly` is on) an unverified one (FR-494, `discovery.e2e-spec.ts`) — re-run clean once OpenAI credit was restored; also covered by a `deck.service.spec.ts` unit test independent of any vendor.
- [x] The "جدید" badge appears on a new member's card in the plain, unfiltered deck too, not only inside the New Members filtered view (FR-490) — confirmed via `deck.service.spec.ts`.
- [x] Full backend unit + e2e regression re-run clean (unit: 436/436; the 2 new e2e suites/additions: each passes individually — a combined single run hit this session's own well-documented "heavy combined real-vendor load" transient-degradation pattern, unrelated to this feature's own logic, resolved the same way every prior occurrence was: confirmed clean on isolated re-run).

### 11. Real findings from implementation

- **A real, pre-existing bug in `match-list.tsx`'s `MatchAvatar`, invisible since it was first written, found and fixed while verifying this feature's own new presence dot.** The avatar's outer wrapper carried `overflow-hidden` in addition to the inner photo-clipping div's own `overflow-hidden` — combined with `rounded-full` clipping to a circle (not just the bounding rectangle), this silently clipped away the *entire* corner-positioned verified-badge `<span>` that has existed in this component since Feature 17, with zero visible symptom in any prior screenshot pass (Feature 23/26's own audits both looked at the match-list *row*'s overall card shape/elevation, never this one small avatar-corner detail). Confirmed empirically, not assumed: a real `document.elementFromPoint()` check at the badge's own center returned the parent `<a>`, never the badge itself. Fixed by removing the redundant outer `overflow-hidden`; re-confirmed via the same check now returning the badge/dot themselves, and a real 375px screenshot showing both clearly for the first time, on a real seed-user match (امیر نوری ↔ لیلا شریفی, `docs/test-users.md`).
- **The entire live presence mechanism was confirmed end-to-end against the real running app** via a temporary, one-off script (deleted after use) using the same امیر/لیلا seed pair, before the OpenAI outage ended — this was necessary at the time since fresh e2e users couldn't complete a profile yet. Real, observed results: `{online:false,lastOnlineAt:null}` before any connection → `{online:true,lastOnlineAt:null}` on connect → `{online:false,lastOnlineAt:<fresh timestamp>}` on disconnect → `null` for either party after they turn their own `showLastActiveStatus` off, restored the instant it's back on.
- **A real, genuine ordering race found by the automated e2e suite once it could finally run against the real vendor, not caught by any unit test (which mocks Redis/Prisma independently and never exercises the real interleaving)**: `recordDisconnect()` originally deleted the Redis `presence:online:<id>` key *before* writing `lastOnlineAt` to Postgres. A reader polling in the narrow window between those two writes could observe a real, internally-inconsistent `{online: false, lastOnlineAt: null}` — honest-looking (never a fabricated value) but momentarily stale. Fixed by reordering: the durable Postgres write now happens first, so no reader can ever see `online: false` before `lastOnlineAt` is already set. `presence.e2e-spec.ts`'s own first test caught this directly (`expect(offline?.lastOnlineAt).not.toBeNull()` failed on a real run, passed after the fix) — the exact reason this class of bug needs a real, live, two-process e2e test and can't be caught by any mock.
- **The New Members filter couldn't be given the same live, in-browser proof as presence while OpenAI was still down**, for a real, structural reason: all 20 seed users were created 2026-08-26, genuinely outside the 7-day window by the time this feature was built, and `buildSafetyExclusionWhere`'s `profileCompletedAt: not null` floor means no candidate can appear in any deck query without a complete profile. Moot now — the real `discovery.e2e-spec.ts` test runs clean against a freshly-created, genuinely-new-member candidate.
- **This session's own recurring "combined real-vendor load" transient-degradation pattern (`docs/roadmap.md`, observed independently across Features 4/10/15/16/17/20) recurred an eighth time here**: the 2 new e2e files, run together with 6 fresh real users needing real OTP + real profile + real photo-moderation calls back-to-back, hit a transient 500/503 partway through; each test confirmed fully clean when re-run individually immediately after. Not a Feature 27 defect — added as further accumulating evidence for the still-pending real load-testing item already tracked in `docs/roadmap.md`.

---

## Feature 28: Public Landing/Marketing Page

**Status:** ✅ Shipped, verified live — not "not yet implemented" as this line previously read. **This line was stale, and found beyond the originally-requested 14 — flagging explicitly rather than silently expanding scope.** Corrected 2026-09-17 after direct verification, matching `docs/roadmap.md`'s own detailed Feature 28 write-up (dual-purpose `/` route, the `proxy.ts`/`AuthRehydrator` exemption, `frontend/e2e/landing.spec.ts` 5/5 passing): confirmed the real public landing page code and `frontend/e2e/landing.spec.ts` as a real, current test file.

**Depends on:** `frontend/proxy.ts` (the routing gate this feature changes), `app/(tabs)/page.tsx` (the existing `/` route, which already safely no-ops its authenticated-only hooks for a logged-out visitor — confirmed by reading `useChatConnection()`/`useCallListening()`, both gated on `status === "authenticated"`), `docs/design-system.md` (the closed token set this page must stay inside, no new colors/gradients), `docs/product.md` §1/§3 (the real, already-approved positioning statement and advantage list this page's copy is grounded in, not invented fresh), the existing `/settings/privacy-policy`/`/settings/terms` placeholder pages (Feature 22) and `/settings/help` (Feature 22's Help Center).

### 1. Goal

Right now `frontend/proxy.ts` redirects *every* unauthenticated visitor hitting `/` straight to `/login` — confirmed directly by reading the file (`if (!hasSession && !isLoginRoute && !isPublicDateShareRoute) return NextResponse.redirect(...)`), so there is no page anywhere in this app that explains what Hamava is before asking for a phone number. This feature makes `/` a real public landing page for a logged-out visitor, while an authenticated visitor's `/` (today's discovery screen) is completely unchanged.

### 2. Routing — the one real structural change

`/` becomes the second route (after `/login`, alongside the already-public `/date/:token`) whose content depends on auth state rather than being uniformly gated:

- **`frontend/proxy.ts`**: `/` is removed from the forced-redirect condition — an unauthenticated visitor hitting `/` is now allowed through (no redirect), same as `/login`/`/date/`. An *authenticated* visitor hitting `/login` still redirects to `/` exactly as today (unchanged). `/settings/privacy-policy`, `/settings/terms`, and `/settings/help` are added to the exemption via **exact path equality** (`pathname === "/settings/privacy-policy"` / `=== "/settings/terms"` / `=== "/settings/help"`), never a `/settings/`-prefix match — a broader matcher would also unprotect privacy toggles, account deletion, and everything else under Settings, exactly the risk FR-394's own narrow-exemption discipline exists to avoid. `/settings/help` was added during implementation, not in this section's first draft — found the moment the footer's own "تماس با ما" link (§3.5) was wired to it: left unexempted, that link would have bounced a logged-out visitor straight back to `/login`, breaking the very link this feature adds. So all three footer links are actually reachable pre-login, not a dead end (their content — `ComingSoonPlaceholder` for the two legal pages, `FaqAccordion` for Help — is already real, static, and reads nothing from `useAuthStore`, confirmed directly for all three; only the routing gate currently blocks them).
- **A second, independent gate needs the same treatment, found by explicit user follow-up before implementation began — not present in this section's first draft.** `proxy.ts` is not the only thing standing between an unauthenticated visitor and these four routes: `AuthRehydrator` (`components/providers/app-providers.tsx`) runs on every fresh page load for any route that isn't `isLoginRoute`/`isPublicDateShareRoute`, and its `fail()` helper calls `router.replace("/login")` **unconditionally** whenever the real refresh attempt fails — which it always will for a genuinely logged-out visitor. Left unfixed, this alone would silently redirect an unauthenticated `/`/legal/help visitor straight back to `/login`, defeating this feature even with `proxy.ts` fixed. The existing `/date/` pattern (skip the real rehydration attempt entirely) is the *wrong* fix to copy here: unlike the public date-share view, `/` and these three settings sub-pages are real, ordinary in-app routes an *authenticated* visitor can and does hard-refresh — skipping rehydration for them would wrongly drop a real, valid session (tab bar disappearing, `user` going null) on a plain reload. The correct, narrower fix: a new `isPublicWhenLoggedOut` check (`pathname === "/" || pathname === "/settings/privacy-policy" || pathname === "/settings/terms" || pathname === "/settings/help"`) that changes nothing about the real rehydration attempt itself (an authenticated visitor's session is recovered exactly as it is today) and only suppresses `fail()`'s `router.replace("/login")` call for these four routes — a genuinely logged-out visitor settles into `status: "unauthenticated"` instead of being bounced away, which is exactly the state `app/(tabs)/page.tsx`'s new branch (below) needs to render the landing page at all.
- **`app/(tabs)/page.tsx`** (same file, same route — no new page file): its existing three-way branch on `useAuthStore`'s `status` gains one real case. Today: `status === "unknown"` and `status === "authenticated" && !profileCompleted` both fall through to the same blank `<div className="min-h-screen bg-background" />` (a real, if accidental, placeholder for "not ready yet"), and `authenticated && profileCompleted` shows the discovery UI. This feature adds: `status === "unauthenticated"` → the new `<LandingPage />` component. `status === "unknown"` (still rehydrating) keeps the current blank div, so a will-be-authenticated visitor never sees a flash of marketing copy before their session resolves.
- **`(tabs)/layout.tsx` needs no change** — `TabBar` already only renders when `user?.profileCompleted`, and both real-time hooks already no-op when unauthenticated; a logged-out visitor's `/` renders inside the exact same layout shell with zero visible side effects from it, confirmed by reading the current code rather than assumed.

### 3. Page structure (`frontend/components/landing/landing-page.tsx`, new)

Structural inspiration from bumble.com/de's section flow and persuasion order — never its yellow/white visual identity, which this page does not use at all. Every color, radius, glow, and font stays exactly what `docs/design-system.md` already defines; nothing new is introduced.

1. **Hero.** `BrandMark` (Display weight, already established there — reused, not extended to a new surface: `docs/design-system.md` §2's own "Where" column names only the app name and the match-moment text as Display's real surfaces, so a marketing headline stays at **H1** — 800-weight, `clamp(22px,3vw,28px)`, `-0.01em` — the "page/screen titles" role it's already defined for, not a quiet third Display use case nobody reviewed), and a subheadline that is a direct Persian rendering of `product.md`'s own real, already-approved positioning statement (§1: *"the dating app where every profile is a real, live-verified human, and AI actually understands who you're looking for"*) — not new marketing copy invented for this page. One CTA button, "شروع کن", styled with `--elevation-cta-turquoise` (the existing primary-action treatment, e.g. `filters-panel.tsx`'s own save button), linking to `/login`.
2. **Benefits (3–4 cards, `--elevation-1` each).** Reuses existing icons, no new ones: `VerifiedIcon` (identity/liveness verification), `ChatIcon` (AI Prompt Search — already this exact icon's role on the discovery tab), `CallIcon` (a safe voice call before either side reveals everything — Feature 12/13's own real safe-calling positioning from `product.md`), `ShareIcon` (Share My Date). Each maps to a real, shipped feature — nothing described here is aspirational.
3. **Trust/safety — a separate, visually distinct section, not a passing line item.** Built around `ShieldIcon`, grounded directly in `product.md` §3's own "Verification-first architecture" and "Safety-integrated communication" advantage rows (verbatim reasoning, not paraphrased into something stronger than what's actually shipped: liveness verification before any match forms, VERIFIED_ONLY messaging by default, block/report always reachable, no phone-number exposure in calls).
4. **How it works — 4 numbered steps.** ثبت‌نام (phone + OTP) → تایید هویت (real liveness check) → کشف/جست‌وجو (deck or AI Prompt Search) → ارتباط امن (matched chat + safe calling before full reveal). Each step names the real feature it maps to, no invented intermediate steps.
5. **Footer.** Links to `/settings/privacy-policy` and `/settings/terms` — the existing real placeholder pages, not new content. **"تماس با ما" (contact us) has no real destination to reuse anywhere in this codebase** — confirmed by reading `faq-accordion.tsx`'s own current copy: *"فعلاً کانال پشتیبانی مستقیمی توی اپ وجود نداره"* ("there's currently no direct support channel in the app"). Rather than inventing a fake support email, this links to the existing `/settings/help` Help Center instead — both decisions (this one and the §7 test fix) explicitly confirmed by the user before implementation. All three footer targets are covered by §2's public-route exemption, added there specifically so these links actually work pre-login rather than bouncing to `/login`.

### 4. Explicitly out of scope

- Any new color, gradient, icon, or animation library not already in `docs/design-system.md`/this codebase's existing dependencies (`framer-motion` is already a dependency, used for Feature 17's match-moment animation — reused here for entrance animation, not added new).
- The signature gradient (`--signature-gradient`) is **not** used anywhere on this page beyond the existing `BrandMark` itself — §1.2's closed allowed-surfaces list does not include a marketing page, and a landing page is exactly the kind of surface that tempts overusing it; explicitly resisted here.
- A real "تماس با ما" channel (email, form, chat) — flagged above as a real gap, not built here.
- Any pricing/subscription content — this app has no priced tier defined anywhere yet (`docs/product.md`/`docs/roadmap.md` Phase 2).
- Testimonials, press logos, app-store badges, or any other content this project has no real source for — never fabricated.
- A separate `/signup` route — this app's own real auth flow is a single phone+OTP screen serving both new and returning users (`/login`); "شروع کن" links there unchanged.

### 5. Functional requirements

- FR-495: `frontend/proxy.ts` no longer redirects an unauthenticated visitor away from `/` — confirmed by reading the updated file's own logic, not assumed from a passing test alone.
- FR-496: An authenticated visitor's behavior at `/` and at `/login` is unchanged byte-for-byte from today (discovery screen; auto-redirect away from `/login`, respectively).
- FR-497: `/settings/privacy-policy`, `/settings/terms`, and `/settings/help` are reachable by an unauthenticated visitor (added to `proxy.ts`'s public-route exemption, exact-path match only), serving the exact same existing `ComingSoonPlaceholder`/`FaqAccordion` content Feature 22 already built — no new legal or support content is authored here. `/settings/help` was added mid-implementation once the footer's own "تماس با ما" link needed a real, working target (§3.5).
- FR-497b: `AuthRehydrator`'s `fail()` no longer redirects to `/login` for `/`, `/settings/privacy-policy`, `/settings/terms`, or `/settings/help` — the real rehydration attempt itself is unchanged for these four routes, so an already-authenticated visitor's session (and the tab bar it drives) survives a hard reload on any of them exactly as it does today. Found by explicit user follow-up before implementation, not assumed safe from `proxy.ts` alone — see §2's real-code trace of `AuthRehydrator`.
- FR-498: The new `LandingPage` component renders the five sections in §3, using only existing design tokens (colors, elevation, spacing scale, typography) and existing icon components — zero new visual primitives.
- FR-499: The hero's "شروع کن" button navigates to `/login`.
- FR-500: The page is fully responsive from a real 375px viewport to desktop, verified via a real screenshot at 375px per Feature 26's Criterion I — not assumed from responsive class names alone.
- FR-501: Section entrance uses a gentle, real `framer-motion` fade/rise-in (matching the restraint already established for Feature 17's own animation work) — not applied to the hero's CTA button itself, which stays immediately clickable on load, not gated behind an animation finishing.

### 6. Security requirements

None beyond what already exists — this page is static marketing content with no new data reads, no new form, no new write path. The one real change with a security dimension is routing (§2), narrow at both of the two independent gates that actually enforce it: `proxy.ts` (exact-path match, never a `/settings/`-prefix) and `AuthRehydrator` (same four exact paths — `/`, `/settings/privacy-policy`, `/settings/terms`, `/settings/help` — and only the failure-redirect is suppressed — the real session-recovery attempt is untouched) — matching the exact same scoped-exemption discipline `docs/requirements.md` Feature 19 §9 already established for `/date/:token` (a narrow, explicit exemption, not a broadened matcher), extended correctly rather than copied verbatim where the two cases genuinely differ (§2).

### 7. A real, necessary test fix — not new scope, an existing test this feature breaks

`frontend/e2e/login.spec.ts`'s `"direct navigation to a protected route while logged out redirects to /login (FR-224)"` test currently uses `/` as its example of "a protected route" (`await page.goto("/"); await expect(page).toHaveURL(/\/login$/)`). Once this feature ships, `/` is deliberately no longer protected — this specific test would start failing not because of a regression, but because its own premise (`/` is protected) stops being true. Repointed to a route this feature does not touch (e.g. `/matches`) so it keeps testing the real thing it was written to test — the general unauthenticated-redirect behavior — without asserting something now false about `/` specifically.

### 8. Testing

- A new `frontend/e2e/landing.spec.ts`: a fresh browser context with no cookies visits `/`, asserts real landing-page content is visible (not a redirect to `/login`), clicks "شروع کن", and asserts arrival at `/login`. A second test in the same file confirms an *authenticated* visitor's `/` still shows the discovery screen, not the landing page (the one behavior this feature must not break).
- `login.spec.ts`'s existing suite re-run in full after the §7 fix, confirming nothing else assumed `/`'s old always-protected behavior.
- No backend changes in this feature — no backend test suite is affected.

### 9. Acceptance criteria

- [x] An unauthenticated visitor to `/` sees the real landing page, not a redirect to `/login` (FR-495) — `e2e/landing.spec.ts`, plus a direct `curl` confirming `/` now returns `200` (the page itself) instead of the old `307` to `/login`.
- [x] An authenticated visitor's `/` and `/login` behavior is unchanged (FR-496) — `e2e/landing.spec.ts`, plus live browser confirmation (an already-logged-in session still sees the real discovery screen at `/`).
- [x] `/settings/privacy-policy`, `/settings/terms`, and `/settings/help` are all reachable pre-login from the footer (FR-497).
- [x] An already-authenticated visitor's session (tab bar, `user` state) survives a hard reload of `/`, `/settings/privacy-policy`, `/settings/terms`, and `/settings/help`, unaffected by the new exemptions (FR-497b) — the exact regression class Feature 19's own `/date/` exemption once introduced and had to fix. A first version of this test tripped this project's own already-documented single-use-refresh-token-rotation race by chaining raw navigations too quickly; fixed in the test itself (settle after each navigation) — not a product bug, see §10.
- [x] All five sections in §3 render using only existing design-system tokens and icons — no new color/gradient/icon introduced (FR-498), confirmed via real 375px and desktop screenshots (§10) per Feature 26's Criterion I (FR-500).
- [x] "شروع کن" navigates to `/login` (FR-499) — `e2e/landing.spec.ts`.
- [x] `login.spec.ts`'s repointed test (§7) and its full suite (5/5) pass; `landing.spec.ts` (5/5) passes; `profile.spec.ts` (9/9, one transient failure re-confirmed clean in isolation — this session's own well-documented combined-load pattern, unrelated to this feature) re-run clean as a broader sanity check on the shared `proxy.ts`/`AuthRehydrator` files this feature touches.

### 10. Real findings from implementation

- **A real, necessary extension beyond the original draft, found while wiring the footer, not assumed safe**: the "تماس با ما" link needed `/settings/help` added to both `proxy.ts`'s and `AuthRehydrator`'s exemptions too — otherwise the landing page's own footer would have shipped with a link that bounces a logged-out visitor straight to `/login`. Same exact-path reasoning as the two legal pages, confirmed the same way (`FaqAccordion`/`HelpCenterPage` read nothing from `useAuthStore`).
- **The user's own pre-implementation question surfaced a real, load-bearing gap `proxy.ts` alone would not have caught**: `AuthRehydrator` is a second, independent gate, and its `fail()` unconditionally redirected to `/login` on any refresh failure — which every genuinely logged-out visitor to these new routes would hit. Fixed with a narrow `isPublicWhenLoggedOut` check that only suppresses the redirect, leaving the real rehydration attempt (and therefore an authenticated visitor's session recovery) completely untouched. Confirmed empirically, not just by code reading: a dedicated e2e test logs in as a real seed user, hard-reloads all four exempted routes, and confirms the real session survives each one.
- **A real, this-project's-own-already-documented refresh-token-rotation race, hit by the first draft of that same test, not by the product code**: chaining `goto → reload → goto` back-to-back across the three settings sub-pages fired overlapping real `refreshAccessTokenOnce()` calls against the backend's single-use refresh-token rotation, occasionally losing the race and landing on `/login` — reproducing the exact class of issue `docs/roadmap.md`'s "Known infrastructure debt" already names. Fixed in the test (wait for real content after each navigation before firing the next one), not in the product, since the race is a pre-existing, accepted risk category, not something this feature introduced.
- **Design-token discipline held under actual scrutiny, not just intention**: the hero headline was drafted expecting Display weight (900), but a direct re-check of `docs/design-system.md` §2's own "Where" column showed Display's real, reviewed surfaces are only the app name and the match-moment text — not a marketing headline. Downgraded to H1 (the already-defined "page/screen titles" role) before writing any code, avoiding a quiet, unreviewed third use of the heaviest weight in the type scale.
- **`login.spec.ts`'s one existing test that used `/` as its "protected route" example was repointed to `/matches` (§7) and re-verified passing (5/5 in the file)** — a real, necessary consequence of `/` deliberately losing its always-protected status, not a silent side effect.

---

## Feature 29: Welcome Tour After First Profile Completion

**Status:** ✅ Shipped, verified, and closed — including two real post-ship regressions found from live user bug reports, root-caused and fixed (§11), each with a dedicated negative-control e2e test confirmed to fail before its fix and pass after. Final combined regression: 21/21 passed clean.

**Depends on:** `backend/src/modules/profile/profile.service.ts`'s `maybeMarkProfileCompleted()` (the exact, single, "set once" completion gate both the manual and conversational paths already funnel through — confirmed directly, not assumed), `backend/src/modules/discovery/who-liked-me.service.ts`'s `markSeen()` (the real, existing "one-time seen marker" pattern this feature's own backend piece is modeled on character-for-character), `frontend/lib/auth-store.ts` (`setProfileCompleted()`'s exact two real call sites — `profile-form.tsx`, `conversational-setup.tsx`), `(tabs)/layout.tsx` (the existing full-screen-overlay-at-the-shell-level pattern already established for `IncomingCallOverlay`/`InCallScreen`), `docs/design-system.md` §1.2/§1.3 (the signature-gradient's closed allowed-surfaces list, and the glow/elevation tokens), Feature 28's own precedent for staying inside that closed list under real scrutiny.

### 1. Goal

Today, the instant a profile crosses the completeness threshold (either path — direct form or conversational setup), the user is simply left wherever they are, with no acknowledgment, no orientation, and no mention of the app's own real differentiators (identity verification, AI search, safe calling, Share My Date). This feature adds a real, one-time, dismissible welcome tour the first time that happens — never again after that, on any later login.

### 2. Architecture — trigger and persistence

**Why a durable backend flag, not just a client-side "just transitioned" check.** The naive approach — show the tour only at the literal instant `profileCompleted` flips `false→true` in the store — has a real, obvious gap: if the user closes the tab or the app crashes before the tour actually renders (or before they dismiss it), that transition instant is gone forever on any later session, since a fresh rehydration always loads `profileCompleted: true` directly with no transition to observe. A separate, durable, server-persisted "have they actually *seen and dismissed*" flag is what the user's own `hasSeenWelcomeTour` proposal actually solves, and is genuinely necessary, not just a defensive nicety.

**Real, minimal design, following `whoLikedMeSeenAt`'s own exact precedent (§ above), not inventing a new pattern:**
- New `User.hasSeenWelcomeTour Boolean @default(false)` column (`backend/prisma/schema.prisma`, next to `profileCompletedAt`).
- **A real, necessary backfill in the same migration** — flagged explicitly, not glossed over: every *already-complete* profile at migration time (all 20 real seed users, every e2e-created account with a real `profileCompletedAt`) must not suddenly see a "welcome!" tour they have no business seeing. The generated migration gets one manual `UPDATE users SET "hasSeenWelcomeTour" = true WHERE "profileCompletedAt" IS NOT NULL;` appended before it's applied — the same "hand-edit the generated SQL for a real, known reason" pattern this project's own migrations have needed before (`docs/architecture.md` §5's hand-written-vector-index gotcha), here for a data-backfill reason instead of an index-conflict one. Only genuinely new, still-incomplete profiles keep the column's real default of `false`.
- New endpoint, modeled directly on `who-liked-me.controller.ts`'s `POST .../seen` (no DTO, `@CurrentUser()` only): `POST /v1/profile/welcome-tour/seen` → `ProfileService.markWelcomeTourSeen(userId)` → `prisma.user.update({ where: { id: userId }, data: { hasSeenWelcomeTour: true } })`.
- `GET /v1/profile/me`'s response (`ProfileService.getProfile()`) gains `hasSeenWelcomeTour: boolean` alongside the existing `profileCompletedAt`.

**Frontend — reusing `profileCompleted`'s own exact wiring, not a parallel mechanism:**
- `AuthUser` (`auth-store.ts`) gains `hasSeenWelcomeTour: boolean`, with a new `setWelcomeTourSeen(seen: boolean)` action mirroring `setProfileCompleted()`'s own implementation exactly.
- `AuthRehydrator` and `conversational-setup.tsx`'s `onSuccess` both currently call the narrower `fetchProfileCompleted()` (itself just `getProfile()` plus one field extraction, confirmed by reading it) — both are changed to call `getProfile()` directly and derive **both** `profileCompleted` and `hasSeenWelcomeTour` from the one real response, rather than two separate `GET /v1/profile/me` round trips for two fields off the same object. **A real, deliberate consequence, not an oversight**: this leaves `fetchProfileCompleted()` with zero remaining callers — removed as genuinely dead code, not left behind "just in case."
- `profile-form.tsx`'s `onSuccess` already receives a full `Profile` object from `updateProfile()`'s own PATCH response — reads `updated.hasSeenWelcomeTour` directly, no extra fetch at all.
- **Render location: the tab-shell layout (`(tabs)/layout.tsx`), not a specific page** — a real, deliberate choice, not the first idea tried. The two profile-completing flows land the user in different places today (the manual path returns to `/profile`'s own view mode, Feature 25; the conversational path's own post-completion destination is a separate internal detail neither this feature nor Feature 25 needs to change) — rather than chasing every possible landing spot, this feature reuses the exact same architectural pattern this codebase already has for something that must appear regardless of which screen is currently showing: `IncomingCallOverlay`/`InCallScreen`, mounted once in `(tabs)/layout.tsx`, full-screen, above everything else. `WelcomeTour` is added there identically: `{user?.profileCompleted && !user?.hasSeenWelcomeTour ? <WelcomeTour /> : null}`.

### 3. Content — 4 slides, grounded in real shipped features only

1. **خوش‌آمدگویی + یادآوری تایید هویت** — `VerifiedIcon`, "همه‌ی پروفایل‌های تایید‌شده واقعی هستن" (Feature 1's real liveness verification — not a new claim, the exact same one already made on Feature 28's landing page and in `product.md` §1's core positioning).
2. **جست‌وجوی هوشمند** — `ChatIcon`, real reference to Feature 9's text/voice AI Prompt Search.
3. **تماس صوتی امن + اشتراک‌گذاری قرار** — `CallIcon`/`ShareIcon` together, real reference to Feature 13 (safe calling, no phone-number exposure) and Feature 12 (Share My Date).
4. **(optional, per explicit instruction) سوپرلایک/بوست** — `StarFilledIcon`/`BoltIcon`, real reference to Feature 10.

**No copy here is new marketing invention** — every claim maps to an already-shipped, already-reviewed feature, the same discipline Feature 28's own landing-page copy already established.

### 4. Interaction

- "بعدی" (Next) advances one slide; the last slide's equivalent action is "بریم!" (Let's go), not "بعدی".
- "رد کردن" (Skip) is present and reachable on **every** slide, not just an option after seeing them all — the user's own explicit instruction ("کاربر نباید مجبور به دیدن کامل بشه").
- Both "رد کردن" and "بریم!" do the exact same real thing underneath: call `POST /v1/profile/welcome-tour/seen`, update the store via `setWelcomeTourSeen(true)`, and dismiss the overlay. They differ only in label/framing (an honest "I've seen enough" vs. a completion-flavored "let's go"), never in what's actually persisted — there is no partial-credit "saw 2 of 4 slides" state, matching `whoLikedMeSeenAt`'s own "real, minimal, no fabricated granularity" precedent.
- **No existing carousel/stepper component exists anywhere in this codebase to reuse** — confirmed directly (grepped `step|Step|carousel|Carousel|slide|Slide` across `frontend/components`; the closest hit, `delete-account-flow.tsx`'s own `Step` union, has no progress UI at all). This feature is genuinely the first slide-deck-with-dots interaction pattern in the app — flagged explicitly, not silently presented as "just reusing what's there."

### 5. Quality

- Uses `docs/design-system.md`'s existing glow/elevation tokens (`--elevation-2`/`--elevation-3` for the overlay card, `--elevation-cta-turquoise` for the primary "بعدی"/"بریم!" button) and a gentle `framer-motion` fade/slide transition between slides (already a dependency, same restraint level as Feature 28's own entrance animation — not per-letter reveals or anything "پرزرق‌وبرق").
- **The signature gradient is never used anywhere in this feature** — explicitly re-confirmed against `docs/design-system.md` §1.2's closed allowed-surfaces list (brand mark, verified-photo frame, liveness-complete confirmation, the match-moment animation, a possible future premium badge) before writing any slide content, the same discipline Feature 28 already established for its own hero. A tempting but explicitly wrong instinct here would be reaching for the gradient on "this is a special first-time moment" grounds — resisted on the same explicit instruction as before.
- Verified at a real 375px viewport per Feature 26's Criterion I before being called done.

### 6. Explicitly out of scope

- Any new icon, color, or gradient beyond what's already defined.
- Persisting *which* slide the user was on if they skip partway and somehow reopen mid-tour in the same session — the flag is binary (seen or not), not a resume-position.
- A "show me this again" re-trigger from Settings — not requested; if wanted later, it's a small, separate addition (a Settings row calling `setWelcomeTourSeen(false)` client-side plus re-arming the same `POST .../seen` semantics), not built here.
- Any change to where either profile-completion flow navigates afterward — this feature overlays on top of whatever screen already renders next, per §2's own reasoning for why that's the right approach.

### 7. Functional requirements

- FR-502: A new `User.hasSeenWelcomeTour` column, default `false`, backfilled to `true` for every row with a non-null `profileCompletedAt` at migration time (§2).
- FR-503: `POST /v1/profile/welcome-tour/seen` sets `hasSeenWelcomeTour = true` for the authenticated caller, modeled on `who-liked-me.service.ts`'s `markSeen()`.
- FR-504: `GET /v1/profile/me` includes `hasSeenWelcomeTour` in its response.
- FR-505: The welcome tour renders (as a full-screen overlay at the tab-shell layout level, not tied to any specific page) exactly when `profileCompleted && !hasSeenWelcomeTour` — for a real, freshly-completed profile immediately, and for a completed-but-never-dismissed profile on any later session too (§2's own reasoning for why this durable check, not a one-shot transition event, is correct).
- FR-506: Exactly 4 slides, content per §3, each naming a real, already-shipped feature — no invented claims.
- FR-507: "رد کردن" is reachable from every slide; both "رد کردن" and the final "بریم!" call the same real dismiss path (FR-503 + `setWelcomeTourSeen(true)`).
- FR-508: Once dismissed (either button, any slide), the tour never renders again for that user, on any later login — enforced server-side (FR-502/503), not just a client-side/localStorage flag (the real gap `docs/design-system.md`-adjacent features like `match-moment.tsx`'s own localStorage-gated approach would have if reused here across devices/reinstalls).

### 8. Security requirements

None beyond what already exists — `POST /v1/profile/welcome-tour/seen` is authenticated (`JwtAuthGuard`, matching every other `/profile` route), takes no body, and can only ever set the caller's own flag to `true` (never read/write anyone else's, never settable back to `false` by the client — only a future, separate, explicitly-scoped Settings addition per §6 would need that).

### 9. Testing

- Backend: a new `profile.service.spec.ts` unit test for `markWelcomeTourSeen()` (mirrors `who-liked-me.service.spec.ts`'s own `markSeen` test exactly), plus a real migration-backfill check (a direct query confirming every pre-existing complete profile has `hasSeenWelcomeTour: true` immediately after migrating).
- Frontend e2e (`frontend/e2e/welcome-tour.spec.ts`, new): (1) a fresh user completing their profile via the real manual path sees the tour; (2) an existing, already-complete seed user (`docs/test-users.md`) logging in again does **not** see it; (3) clicking "رد کردن" on the first slide dismisses it immediately, and a subsequent reload confirms it stays dismissed.

### 10. Acceptance criteria

- [x] A freshly-completed profile shows the real welcome tour (FR-505) — `e2e/welcome-tour.spec.ts`, against the real manual-completion flow.
- [x] An already-complete seed user never sees it (FR-502's backfill + FR-505) — a direct query confirmed 22/22 real pre-existing complete profiles backfilled to `hasSeenWelcomeTour: true` immediately after migrating (§11), plus a dedicated e2e test against a real seed user (علی رضایی).
- [x] "رد کردن" works from every slide and persists real dismissal server-side, confirmed by a real reload not re-showing it (FR-507/508) — `e2e/welcome-tour.spec.ts` (both the first-slide-skip and full-4-slide-to-"بریم!" paths, each independently reload-checked).
- [x] All 4 slides use only existing design tokens/icons, the signature gradient is used nowhere in this feature (FR-498-equivalent discipline, §5) — confirmed by code review against `docs/design-system.md`'s closed list before writing the component, **and independently re-confirmed via a real live screenshot in a later pass** once the Browser tool recovered (glow, dot indicators, and slide content all rendering correctly, no signature gradient present).
- [x] Full backend unit + e2e regression re-run clean after the schema change — backend 438/438; `login.spec.ts`/`landing.spec.ts`/`profile.spec.ts`/`welcome-tour.spec.ts` combined (23/23, one pre-existing, already-documented refresh-token-rotation flake confirmed clean in isolation, unrelated to this feature — see §11).
- [x] A profile completed by a photo upload (not a text-field save) reflects everywhere — the real tour, the tab bar, and the discovery gate — with **zero manual reload** (a real regression found from post-ship user bug reports, root-caused and fixed in §11; guarded by a dedicated negative-control test, `e2e/profile-completion-sync.spec.ts`, confirmed to fail before the fix and pass after). Final combined regression (`profile-completion-sync.spec.ts` + `welcome-tour.spec.ts` + `profile.spec.ts` + `discovery.spec.ts`): **21/21 passed**, single-worker, all earlier transient failures individually root-caused to real environmental causes (not this feature's code) before being confirmed clean on isolated re-run.

### 11. Real findings from implementation

- **A third real call site of the now-removed `fetchProfileCompleted()` was missed by the initial investigation, caught only by `tsc`, not assumed complete from the earlier report.** `lib/queries/auth.ts`'s `verifyOtp()` — the real login/OTP-verify flow itself — called it directly to build the very first `AuthUser`, a call site the pre-implementation investigation's "only two real callers" claim (about `setProfileCompleted`, a different function) didn't cover. Fixed the same way as the other two call sites (`getProfile()` directly, deriving both fields from one response) — found immediately by `npx tsc --noEmit` failing on the now-missing export, not by manual review, which is exactly why the type-check gate matters here.
- **A real, genuine conflict between two of this pass's own goals, found by running the full test suite, not assumed compatible.** The shared `loginAndCompleteProfile()` e2e helper needed to auto-dismiss the new welcome tour so its many *other* callers (Feature 25's own `FR-470..473` view-mode test, `discovery.spec.ts`, etc.) keep working — but this feature's *own* new `welcome-tour.spec.ts` tests need the tour left showing right after that same helper returns, to actually interact with it. Resolved with a new optional `{ dismissWelcomeTour?: boolean }` parameter (default `true`), with `welcome-tour.spec.ts` the one real caller passing `false`. Found in two stages: first, a full combined-suite run showed the tour blocking Feature 25's own edit-button click (a real, reproducible regression, not the usual transient-load pattern — confirmed by the pointer-event-intercept error naming the tour's own `role="dialog"` directly); the naive centralized fix then broke this feature's own new tests the very next run, in the opposite direction.
- **The migration backfill was verified directly against the real dev database, not assumed correct from the SQL alone**: a raw query immediately after applying the migration confirmed exactly 22/22 already-complete profiles backfilled to `hasSeenWelcomeTour: true`, and 0 incomplete profiles incorrectly touched.
- **This session's own recurring "combined real-vendor load" transient pattern recurred twice more here**, both confirmed clean on isolated re-run and unrelated to this feature's own code: (1) `profile.spec.ts`'s pre-existing `FR-245/FR-249` vendor-failure-escape-hatch test hit a real, transient `fetch failed` on one run and a real, transient refresh-token-rotation failure on another — the second one surfaced a genuinely different *symptom* than it would have pre-Feature-28 (a flaky mid-test refresh now shows the real Feature 28 landing page instead of a `/login` redirect, since `/` is no longer unconditionally protected) but is the exact same underlying pre-existing fragility, not a new bug; (2) `landing.spec.ts`'s `FR-497b` session-survival test (from Feature 28, untouched by this feature) failed once with a blank `alert` page snapshot, unrelated to the welcome tour entirely, and passed clean on immediate re-run.
- **A real, honest gap left open, not silently claimed closed**: the Browser tool's rendering pane was unresponsive for the entirety of this pass's live-verification attempt (screenshots timed out repeatedly, an environmental issue unrelated to any code change here). The tour's actual on-screen appearance at a real 375px viewport was therefore *not* independently re-confirmed via screenshot this pass, unlike Features 27/28 earlier in this same session — recorded honestly in §10 rather than checked off on the strength of code review and Playwright's DOM-level assertions alone. **Resolved in a later pass**: the Browser tool recovered, and a real screenshot confirmed the tour renders correctly (glow, dot indicators, slide content all present as designed).
- **Three post-ship manual bug reports from the user, each investigated live rather than assumed**:
  1. *"After a fresh profile completion, clicking ذخیره did nothing — no tour, no navigation."* Did **not** reproduce against current code: a fresh signup, full manual-form completion, and save correctly showed the welcome tour (confirmed via DOM query and a real screenshot). Most likely explanation: a stale browser tab predating the `(tabs)/layout.tsx` wiring, or (on this end) a `get_page_text` false negative — that tool prefers `<main>`/`<article>` content and can miss the tour's overlay, which renders as a sibling `role="dialog"` outside `<main>`; a direct DOM query and a screenshot both showed it rendering correctly.
  2. *"The 'شروع کن' button on the landing page doesn't work"* (Feature 28). Did **not** reproduce: a fresh click correctly navigated to `/login`, confirmed via `location.href`.
  3. *"After uploading a profile photo, ذخیره stays inactive, and the photo isn't in its frame on the profile page."* **Half confirmed real, half did not reproduce.** The disabled button is real and reproducible: `PhotoGrid`'s upload (`POST /v1/profile/photos`) is a fully independent mutation from `ProfileForm`'s own save, and the Save button's `disabled={mutation.isPending || Object.keys(patch).length === 0}` condition (pre-existing, from Feature 15, untouched by Features 27/28/29) is blind to it — uploading a photo alone, with zero text-field edits, correctly leaves `patch` empty and the button disabled, while giving the user no indication the upload itself actually succeeded. This is a genuine, pre-existing UX gap, not a Feature 27/28/29 regression. The "photo not in its frame" half did not reproduce: a live upload showed the photo's `<img src>` pointing at a real, working MinIO URL immediately after upload, rendered correctly in `PhotoGrid`'s grid box — most likely the user's two observations shared the same root cause (no feedback after upload made it look like nothing had happened).
- **Fix for finding 3 above, approved by the user and implemented in this pass**: `PhotoGrid` now shows its own explicit, upload-scoped success message ("عکس اضافه شد.", turquoise, `role="status" aria-live="polite"` — matching this codebase's existing transient-status pattern from `incoming-call-overlay.tsx`/`in-call-screen.tsx`) the moment `uploadMutation` succeeds, entirely independent of `ProfileForm`'s own Save button and its unrelated `patch`-based disabled state. The message clears on its own the next time an upload starts (react-query resets mutation status to pending on a fresh `mutate()` call) — no manual timeout needed. Verified live (screenshot + DOM check: message appears, Save button correctly stays disabled since no text field was touched) and covered by a new assertion in `profile.spec.ts`'s existing manual-path e2e test (`npx playwright test profile.spec.ts -g "manual path"` — 2/2 passed for real).
- **A fourth, more precise repeat of the user's own bug report exposed the real, underlying regression finding 3 had only partially explained — confirmed live, not assumed.** The user re-reported the exact same "nothing happens after ذخیره" symptom a second time, this time insisting it be re-investigated from a different angle (a WelcomeTour render crash, an Error Boundary as a safety net, and a search for any other consumer of the same store fields). The render-crash theory did not hold (`read_console_messages` showed zero errors at the moment of failure) — an `WelcomeTourErrorBoundary` (`components/onboarding/welcome-tour-error-boundary.tsx`, wrapping `<WelcomeTour />` in `(tabs)/layout.tsx`) was still added per the user's explicit request, as a genuine defensive measure for a *future*, different failure, not because it explained this one. The real cause, proven with a tagged-DOM-node live test: **`useAuthStore`'s `profileCompleted`/`hasSeenWelcomeTour` were only ever synced from `ProfileForm`'s and `ConversationalSetup`'s own PATCH responses — never from `PhotoGrid`'s independent photo upload**, even though `profile.service.ts`'s `uploadPhoto()` calls the exact same `maybeMarkProfileCompleted()`. Whenever a photo upload (not a text-field save) was the action that actually crossed the completion threshold, the store — and therefore every real UI consumer of it (`ProfilePage`'s own render branch, `(tabs)/layout.tsx`'s `WelcomeTour`/`TabBar` visibility, and `app/(tabs)/page.tsx`'s own discovery-gate redirect) — stayed silently stuck at "incomplete" until a full page reload happened to re-run `AuthRehydrator`. The user's own explicit ask to check for *other* independent consumers of these two store fields (not just `ProfilePage`) surfaced exactly one more real instance: `app/(tabs)/page.tsx`'s `useEffect`-driven redirect-to-`/profile` and its own render guard, both reading `user.profileCompleted` directly with no query of their own.
- **Fix, reviewed and approved**: a single sync mechanism centralized in `(tabs)/layout.tsx` (not duplicated per consumer) — a `useQuery(PROFILE_QUERY_KEY, getProfile)` (a genuinely shared cache entry, not an extra fetch: three separate files previously each declared their own literal `["profile"]` key, now unified as `PROFILE_QUERY_KEY`, exported from `lib/queries/profile.ts`) plus a `useEffect` that raises — **never lowers** — `profileCompleted`/`hasSeenWelcomeTour` in the store. The one-directional (false→true only) design is itself a fix for a self-inflicted race caught while building this: a naive bidirectional sync fought with `WelcomeTour`'s own dismiss mutation (which sets `hasSeenWelcomeTour=true` on the store directly without invalidating the `profile` query), reading the still-stale cached `false` on the next render and un-dismissing a tour the user had just closed. Both flags are genuinely "set once, never cleared" facts by design (`maybeMarkProfileCompleted`'s own early-return; the tour's permanent dismissal), so never demoting true→false costs nothing and sidesteps the race entirely.
- **A second, real regression — introduced by the sync fix above, found via the user's own new negative-control e2e test, not assumed absent.** `ProfilePage`'s second `if (isComplete)` render branch (the edit-form view) has a *structurally different* JSX shape than the `mode === "manual"` onboarding branch (an `<h1>` heading vs. a bare `<>` Fragment as `<main>`'s second child) — before the sync fix, `isComplete` only ever flipped via a full reload, so this branch's remount was indistinguishable from any other fresh page load. Once the sync fix made it flip live, mid-session, React tore down and remounted `PhotoGrid`/`ProfileForm` the instant a photo upload crossed the completion threshold — wiping `PhotoGrid`'s own just-set success message, and, more seriously, would have silently discarded any in-progress, not-yet-saved `ProfileForm` `patch` edits. **Proven live**, not theorized: a marker property set on the real `<input type="file">` DOM node before the completing upload was gone afterward (a new node instance), confirming an actual unmount/remount, not just a re-render. **Fixed** by extending this file's own pre-existing `mode === "choice"` guard (already documented, for the identical reason, on the branch above it) to this second branch too — a user actively in "manual" mode who completes their profile via a photo upload now simply keeps seeing their current form undisturbed; the tour/tab-bar/discovery-gate still update live since none of them depend on `ProfilePage`'s own render branch. A real, deliberate scope decision on user review: a bigger structural unification of the two JSX branches (option "C") was considered and explicitly deferred, not pursued, since this one-line, in-pattern guard fully closes the gap with the lowest possible risk to an already well-tested page.
- **New, independent e2e regression guard added for this exact bug class**: `frontend/e2e/profile-completion-sync.spec.ts` — deliberately does *not* use the shared `loginAndCompleteProfile()` helper, since that helper's own trailing `page.reload()` would silently re-sync the store and mask the very bug this test exists to catch. Confirmed, not assumed, to **fail before the fix** (the exact live-repro symptom above) and **pass after** — covering all three real consumers in one test: the tour appearing, the tab bar appearing, and a real client-side `<Link>` navigation to `/` landing on the genuine discovery screen (not the blank placeholder or a bounce back to `/profile`) — with zero manual reload anywhere in the test.
- **Final combined regression, run clean after both fixes**: `profile-completion-sync.spec.ts` + `welcome-tour.spec.ts` + `profile.spec.ts` + `discovery.spec.ts`, 21/21 passed (single-worker, `--workers=1`, avoiding this session's own well-documented resource-contention flakiness from concurrent browser contexts). Several individual runs earlier in this same pass surfaced transient failures (an OTP-autofill timeout from Next.js dev-server cold-compile lag right after a fresh restart, a real transient `PrismaClientKnownRequestError` on `otpRequest.create()` traced to remote-DB connection pressure from this session's own unusually heavy concurrent/sequential test load, and the pre-existing, already-documented refresh-token-rotation race) — each investigated with real evidence (backend logs, `pg_stat_activity` connection counts, direct endpoint retries) before being confirmed transient via a clean isolated re-run, never dismissed on assumption alone.
- **A real, separate environmental finding surfaced while restarting the dev stack mid-session**: the backend must run via `npm run start:frontend-e2e` (`cross-env AUTH_OTP_DEBUG_ECHO=true OTP_RATE_LIMIT_BYPASS=true nest start`, matching `dev-stack/start-hamava-dev-stack.ps1`'s own already-established launch command), not a plain `npm run start:dev` — a restart using the latter left the OTP debug-echo and rate-limit-bypass flags off, causing real, confusing downstream symptoms (a real 429 from the per-IP OTP rate limit, exhausted by this session's own manual `curl` debugging; frontend e2e logins failing to auto-fill the OTP code at all). Also newly confirmed: `Start-Process`-launched detached processes (the orchestrator script's own approach for clamd/MinIO/backend/frontend) do not survive in this sandboxed environment once the launching shell call ends — only a process started with the harness's own persistent background-tracking mechanism reliably survives across tool calls within a session.
