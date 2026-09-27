# Data Classification

A documentation deliverable (`docs/architecture-review-v2.md` §F/§9's "PARTIALLY EXISTS — no centralized policy" finding, closed by documentation, not by rewriting anything). Every check named below already exists, is already correct, and is already covered by this project's real e2e tests — this document catalogs them in one place so future code has a single reference to consult, rather than re-deriving "who can see this field" from scratch. **Nothing in this document changes any existing behavior.** The typed, machine-checkable form of this same catalog lives at `backend/src/common/data-classification/data-classification.ts` (`DATA_CLASSIFICATION`, `isVisibleToMatching()`, `isVisibleToAi()`) — new code may consult it; no existing code was migrated onto it.

## Levels

- **PUBLIC** — no restriction beyond normal API access.
- **MATCH_ONLY** — visible to another user only through a match-adjacent surface (the deck, AI search results, a match summary) — never a full-row API response.
- **PRIVATE** — visible only to the owning user themselves (and, where named below, an admin under `AdminGuard`).
- **SENSITIVE** — private, and additionally never used as an AI input.
- **HIGHLY_SENSITIVE** — never returned in any API response at all, to anyone but the data's own admin-gated review surface (if one exists).
- **VERIFIED_ONLY** — a structural gate on visibility itself (Feature 3's FR-47/FR-79 floor), not a confidentiality level — named separately because it's the one classification this codebase specifically protects against AI/prompt influence (`docs/architecture-review-v2.md` §C).

## Catalog

| Field | Level | Visible to matching? | Visible to AI? | Real enforcement mechanism |
|---|---|---|---|---|
| `User.phoneHash` | HIGHLY_SENSITIVE | No | No | Never serialized in any response; read only by `OtpService`/`UsersService` for lookup. |
| `User.bioEmbedding` | PRIVATE | Yes | No | `Unsupported("vector")` — Prisma can't even select it into a normal query; read only via raw SQL in `AiSearchService`. |
| `User.displayName` | MATCH_ONLY | Yes | Yes | `DeckCandidate`'s explicit field list (`deck.service.ts`, `ai-search.service.ts`) — never a full-row serialization. |
| `User.birthDate` | PRIVATE | Yes (as derived `age`) | Yes (as derived `age`, via `MatchExplanationFacts`) | Never returned directly — only `computeAge()`'s output appears anywhere candidate-facing. |
| `User.city` | MATCH_ONLY | Yes | Yes | `DeckCandidate`'s explicit field list. |
| `User.bio` | MATCH_ONLY | Yes | Yes | `DeckCandidate`'s explicit field list; also the source text for `bioEmbedding` and match-explanation facts. |
| `User.interests` | MATCH_ONLY | Yes | Yes | `DeckCandidate`'s explicit field list. |
| `User.gender` | MATCH_ONLY | Yes (filter only) | No | `DiscoveryPreferences.genderPref` filtering — not itself a candidate-facing display field. |
| `User.datingIntent` | MATCH_ONLY | Yes | Yes | `DiscoveryPreferences.relationshipGoalPref` filtering + `MatchExplanationFacts`. |
| `User.livenessStatus` | VERIFIED_ONLY | Yes (as the gate itself) | No | `buildSafetyExclusionWhere()` — the FR-47/FR-79 floor. Structurally unreachable from any prompt/AI output (`AiSearchDto` has no field capable of overriding it). |
| `User.messagingPermission` | PRIVATE | Yes (filter only) | No | `buildSafetyExclusionWhere()` + `SwipeService`'s in-transaction re-check — never exposed to the other party directly. |
| `User.preciseLocationEnabled` | PRIVATE | No | No | Stored/returned by `settings.service.ts` — currently an **inert** boolean with zero consuming logic anywhere in the codebase (confirmed by grep, `docs/architecture-review-v2.md` §H). Recorded here as a real trap for future location work, not a new finding. |
| `ModerationFlag.textContent` / quarantined photo | HIGHLY_SENSITIVE | No | No | `AdminGuard`-gated endpoints only (`admin/moderation.controller.ts`). Never returned to the flagged user or any other party. |
| `Message.content` | PRIVATE | No | No | `ConversationAccessService.assertAccessible()` — match-participant-only. Never a matching/ranking input; the moderation check on send is the one place it's read by anything AI-adjacent, and that check never persists or acts on the content beyond approve/reject. |
| `ProfileAttributeProvenance.*` (Feature 21) | PRIVATE | No | No | No endpoint currently returns this table at all — backend-internal until a product decision says otherwise (`docs/requirements.md` Feature 21 FR-288). |
| `AiUsageEvent.*` (Feature 21) | PRIVATE | No | No | Operational metadata only, no endpoint exposes it yet; contains no prompt/completion content by construction (FR-299). |
| `MatchFeedback.*` (Feature 21) | PRIVATE | No | No | Visible only to the feedback's own author via `GET .../feedback` (FR-295) — never the other match participant, never used as an input to ranking in this feature (instrumentation only, per the master directive's own "first instrument, don't train yet" instruction). |

## What this document deliberately does not do

- It does not introduce a runtime check that didn't already exist. `isVisibleToMatching()`/`isVisibleToAi()` are available for new code; no existing controller/service was changed to call them.
- It does not classify every field in the schema — only the fields that are genuinely candidate-facing, AI-touching, or otherwise relevant to the master directive's audit. Purely operational fields (rate-limit counters, session bookkeeping) are out of scope here; they're already documented inline in `schema.prisma` where they're defined.
- It is not a substitute for the real per-feature security review each new feature already gets (`docs/requirements.md`'s own "§5 Security" section per feature) — it's a shared reference those reviews can now cite instead of re-deriving.
