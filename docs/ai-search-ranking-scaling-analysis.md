# AI-Search Ranking Query — Scaling Analysis (2026-09-21)

> **Status: Option A decided and implemented (2026-09-21, real migration, real before/after evidence below — §3.2). Options B and C remain an explicit, documented open decision — not resolved, not forgotten.** Written in direct response to the 2026-09-20 finding (`docs/roadmap.md` "HNSW index on `users.bioEmbedding`") that the restored HNSW index is never used by `AiSearchService.search()`'s real query shape, and the user's explicit request for options with trade-offs before any implementation.

## 1. The problem, restated precisely

`AiSearchService.search()` (`ai-search.service.ts:50-152`) is actually **two separate queries chained together**, not one:

1. **Query 1 — candidate generation** (`ai-search.service.ts:94-98`): a normal Prisma `findMany`, applying `buildSafetyExclusionWhere()` plus preference filters (age, gender, dating intent, city, verified-only), capped at `MAX_CANDIDATES_TO_RANK = 2000` (`ai-search.service.ts:28`).
2. **Query 2 — semantic ranking** (`ai-search.service.ts:140-152`): raw SQL, `WHERE id = ANY(<the ≤2000 ids from Query 1>)`, ranks by cosine distance, returns one page.

The 2026-09-20 test (20,523 rows, real `EXPLAIN ANALYZE`, dedicated load-test branch) measured **Query 2 only**: 71.9ms (bitmap scan on `users_pkey` + sort) vs. 6.0ms if the same ranking were done as a bare, unfiltered top-K scan using the HNSW index — a real, reproducible ~12x gap, but on a candidate set already capped at ≤2000 rows.

**The important part this framing was missing until now: Query 2's cost is bounded by the 2000-row cap, not by total table size.** It will not get meaningfully worse as the `users` table grows into the millions — it is already, structurally, a small-input problem. **Query 1 is the one whose cost scales with total table size**, and it has no supporting index for any of the filters it actually applies (`docs/roadmap.md`'s original 2026-09-18 audit, §2.2/2.3, already flagged this independently of the HNSW question; confirmed again directly against the live schema on 2026-09-21 — zero indexes exist on `gender`, `datingIntent`, `birthDate`, or `city`). `DeckService.getDeck()` (`deck.service.ts:140-173`) has the exact same shape, same cap (`MAX_CANDIDATES_TO_TIER = 2000`), same missing indexes — this is not AI-search-specific.

So there are, honestly, **two distinct scaling questions**, and they have different urgency:

- **(a) Can Query 1 reliably produce 2000 candidates without scanning a huge fraction of the table, once the table has millions of rows?** — Real risk, not yet mitigated, independent of anything about HNSW.
- **(b) Should Query 2 be restructured to actually use the HNSW index?** — The question the user asked tonight. Its urgency depends on (a) being solved first, per the options below.

## 2. The non-negotiable constraint

**Every option below preserves this without exception: the safety exclusion (`buildSafetyExclusionWhere()` — never-self, profile-complete, bidirectional block exclusion, prior-swipe exclusion, messaging-permission gate for unverified viewers) and the caller's `verifiedOnly` preference must be fully applied before any candidate is ranked or returned. No option trades this away for speed, ever, at any scale.** Where an option has any elevated risk *to this guarantee specifically* (not just general complexity), it's called out explicitly and weighted heavily — this is the deciding factor between options B and C below, more than raw performance.

## 3. Option A — Fix Query 1 with a real composite index; leave Query 2 exactly as-is

**What**: Add a composite index covering the actual hard/preference filter columns, e.g. `@@index([livenessStatus, gender, datingIntent, birthDate])` on `User` (exact column order should be chosen from real query patterns once they exist — `livenessStatus` first is a reasonable default since `verifiedOnly` is the most commonly-applied filter, per `docs/product.md`). This targets Query 1's actual bottleneck. Query 2 stays exactly as it is today — bounded at ≤2000 rows, bitmap-scan-plus-sort, not using HNSW, same as now.

**Pros**:
- Directly fixes the part of this system that actually degrades as the table grows — Query 1, not Query 2.
- Zero changes to `buildSafetyExclusionWhere()`, `AiSearchService`, or `DeckService`'s query logic. The safety-filter code path is completely untouched — no new risk to the non-negotiable constraint at all.
- Benefits both `DeckService` and `AiSearchService` from one change, since they share the identical filter shape.
- Fully reversible (an index can be dropped with zero data or logic impact), low-risk, small, independently testable with a real `EXPLAIN ANALYZE` before/after — matching this project's own evidentiary standard.

**Cons**:
- Does not address the original question at all — Query 2 still never touches the HNSW index. If the goal is specifically "use the index we have," this option doesn't deliver that.
- Doesn't fix a real, separate correctness concern that gets worse at scale (see §3.1 below): capping Query 1 at 2000 rows means very popular/broad filter combinations may have far more than 2000 real eligible candidates, and the specific 2000 chosen (by `createdAt` order) has no relationship to which of them would rank best semantically — at scale, this is a **quality** problem (real semantic matches silently excluded before ranking ever sees them), not just a latency one.

### 3.1 A correctness concern this option does *not* fix

Independent of speed: once eligible-population-per-filter-combination regularly exceeds 2000 (broad filters, large user base), capping Query 1 at 2000 rows means Query 2 is ranking a somewhat arbitrary subset (whatever happens to be oldest/newest 2000 rows matching the filter, not the 2000 semantically closest). This is a real quality-of-results issue Option A leaves exactly as it is today. Options B and C both structurally improve this, since they let semantic similarity influence *which* candidates get considered, not only how the final 2000 are ordered.

**Urgency**: **Real and not scale-dependent in the same way as B/C below** — this is worth doing independent of user growth, because it's already a confirmed gap today (audit §2.2/2.3, 2026-09-18) affecting the Deck feature (Feature 3), which has real traffic today, not just AI-search. Recommend treating this as the lowest-risk, do-it-regardless item, separate from the HNSW ranking-architecture decision below.

### 3.2 Implemented and verified, 2026-09-21

`@@index([livenessStatus, gender, datingIntent, birthDate])` added to `schema.prisma`, replacing the old standalone `@@index([livenessStatus])` (superseded — `livenessStatus` as the leftmost composite column still serves every query that filtered on it alone). Migration `20260921211104_add_discovery_hard_filter_index` (hand-authored, matching this project's established pattern for indexes `prisma migrate dev`'s shadow-database step can't run against this Neon connection for — see the migration file's own note) applied to the real dev DB via `prisma migrate deploy`. **A second, auto-generated migration proposing to drop the HNSW index (Prisma's diff engine still can't see it — the same recurring artifact documented since 2026-08-20) was generated and discarded, never applied** — confirmed directly afterward: `users_bioEmbedding_hnsw_idx` still present, alongside the new composite index and the untouched `users_createdAt_id_idx`.

**Real before/after evidence**, captured on the dedicated load-test Neon branch (never the shared dev DB) with 100,000 synthetic rows inserted with a realistic `gender`/`datingIntent`/`birthDate`/`livenessStatus` distribution (100,523 total rows), for the exact `DeckService`/`AiSearchService` candidate-generation query shape (`livenessStatus=true, gender=FEMALE, datingIntent=SERIOUS`, a 10-year birth-date band), then cleaned up afterward (verified back to the exact 523-row baseline):

| | Before (old `livenessStatus`-only index) | After (new composite index) |
|---|---|---|
| Plan | `Bitmap Index Scan` on `livenessStatus` alone (50,448 rows fetched), then a row-by-row `Filter` for the other 3 predicates removing 49,691 of them | `Bitmap Index Scan` on all 4 predicates directly (`Index Cond` now covers `livenessStatus`, `gender`, `datingIntent`, `birthDate` together, 768 rows fetched), removing only 11 in the residual filter |
| Buffers | shared hit=2187 read=2 | shared hit=653 read=6 |
| Execution Time | **13.087ms** | **2.032ms** |

**~6.4x faster, ~70% fewer buffer accesses**, at 100k rows — and the gap is structural, not incidental: the old index could only narrow the search to "half the table" (whatever fraction has `livenessStatus=true`), leaving everything else to a row-by-row filter; the new index narrows directly to the real, much smaller matching population. This gap widens, not narrows, as the table grows further, since the "before" cost scales with the `livenessStatus`-only population (roughly half of all rows) while the "after" cost scales with the true combined-filter selectivity (a much smaller, and roughly constant, fraction).

The safety-exclusion `NOT EXISTS` subqueries (`swipes`, `blocks`) were left completely untouched in this change, exactly as planned — they already had adequate indexes (audit §2.2) and are not what this fix targeted.

## 4. Option B — Single-query ANN ranking with pgvector's iterative index scan

**What**: pgvector **0.8.6 is the installed version** (confirmed live, 2026-09-21) — new enough to support `hnsw.iterative_scan` (`relaxed_order` or `strict_order` mode), which lets an `ORDER BY embedding <=> vec LIMIT k` query keep widening its ANN search automatically when a combined `WHERE` filter reduces the in-order results below `k`, instead of requiring a fixed pre-filtered candidate list. This would mean rewriting Query 1+2 into one query: `SELECT ... FROM users WHERE <safety exclusions + preferences, expressed directly in this SQL> ORDER BY "bioEmbedding" <=> $vec LIMIT $k`, with the iterative-scan GUC set for the session/transaction.

**The real cost of this option**: `buildSafetyExclusionWhere()`'s exclusions (`blocksMade`/`blocksReceived` none, `swipesReceived` none, `profileCompletedAt` not null, messaging-permission gate) are currently expressed once, as type-checked Prisma relation filters, shared verbatim by `DeckService` and `AiSearchService` — the file's own doc comment states the reason explicitly: *"so this logic has exactly one implementation — extending it here extends both callers at once, and a bug fixed here is fixed everywhere."* Folding ranking and filtering into one raw SQL statement means hand-writing the equivalent `NOT EXISTS`/`JOIN` logic directly in SQL for this one call site — a **second, independent implementation of a security-critical exclusion**, which `DeckService` would not share and could silently drift from over time.

**Pros**:
- Genuinely lets HNSW accelerate ranking; cost becomes sublinear in table size for the ranking step itself, not just bounded-by-cap the way Option A leaves it.
- Also improves the §3.1 quality concern: semantic similarity can influence which candidates are even considered, not just how a pre-capped 2000 are ordered.

**Cons / risks**:
- **Directly weakens the "one implementation" guarantee for a security-critical filter — this is the central concern given this project's own non-negotiable requirement, not a minor style objection.** Mitigation, if this option is ever chosen: either (a) write a single shared fragment-builder that emits the exclusion logic as *either* a `Prisma.UserWhereInput` or a `Prisma.sql` fragment from one source function, so there is still conceptually one implementation with two output shapes; or (b) add a mandatory, permanent e2e test asserting `DeckService` and `AiSearchService` produce identical exclusion behavior against the same fixture data, so future drift is caught by CI (once CI can run — `docs/roadmap.md`, `.github/workflows/ci.yml`) rather than trusted to two people keeping two files in sync by memory.
- `iterative_scan` bounds *typical* latency, not worst-case — a very selective filter combination (rare city + narrow age band + specific gender/intent + verified-only) relative to a large table can still force the index to search deep, or pgvector's own internal fallback to a fuller scan, before finding `k` matches. No hard latency ceiling exists the way Option A's approach has (bounded strictly by the 2000-row cap).
- The resulting query is harder to visually audit for "does this definitely exclude every blocked/swiped/incomplete-profile/unverified-per-messaging-permission user" than today's declarative Prisma `where` object — a real cost for a codebase whose own review discipline (per this whole session's history) leans on being able to read and trust exclusion logic directly.

**Urgency**: Meaningful only once **(a) has been addressed and still isn't enough** — specifically, once eligible candidate pools for common filter combinations routinely exceed what a 2000-row Query 1 cap can represent well, *and* that's been confirmed with real usage data (query logs, real filter-selectivity distributions), not assumed. No such data exists yet — no production traffic has ever run against this app (`docs/roadmap.md`/audit §17, §19). Rough, explicitly-uncertain estimate: relevant somewhere in the high-hundreds-of-thousands to low-millions-of-total-users range, *if* real users apply fairly narrow filters in practice — could be much sooner if usage patterns turn out to concentrate on a few popular, narrow filter combinations (e.g. one large city), or much later if usage stays broad. This is a genuine estimate, not a measurement, stated as such deliberately.

## 5. Option C — Keep the safety filter exactly as-is; get the semantic candidate set from a separate, unfiltered ANN query, then intersect

**What**: Run two independent queries instead of one combined one:
1. An **unfiltered** ANN query (uses HNSW natively, confirmed 6ms at 20k rows tonight): `SELECT id FROM users WHERE "bioEmbedding" IS NOT NULL ORDER BY "bioEmbedding" <=> $vec LIMIT $k_large` (e.g. `k_large` = 5,000–10,000 — a tunable, not the final page size).
2. Today's **exact, unmodified** `buildSafetyExclusionWhere()`-based Prisma query, but scoped to just those `k_large` ids (`WHERE id IN (<k_large ids>) AND <existing safety/preference filters>`) instead of scanning the whole table — this keeps `buildSafetyExclusionWhere()` and every preference filter completely unchanged, byte-for-byte, in the same shared, single-implementation function `DeckService` also uses.
3. If step 2 returns fewer than the page size needed (the eligible fraction of `k_large` was too small), retry with a larger `k_large` (bounded number of retries, e.g. 2–3, doubling each time), falling back to today's exact current behavior (Option A's shape) if retries are exhausted.

**Pros**:
- **Zero changes to `buildSafetyExclusionWhere()` or any safety-filter code path — the strongest guarantee against regressing the non-negotiable constraint of any option here**, because the exclusion logic isn't touched, translated, or duplicated at all; it's called exactly as `DeckService` calls it today.
- Still genuinely uses the HNSW index for the semantic part (step 1 is a bare top-K scan, the case already confirmed fast).
- Conceptually simple to reason about and to review: two independently-correct queries, intersected — easier to test each half in isolation than Option B's single fused query.
- Also improves the §3.1 quality concern, the same way Option B does — semantic similarity now shapes which candidates are even considered.

**Cons / risks**:
- More moving parts than Option A: a retry/widen loop needs real design and real tests (what's the retry ceiling, what's logged when it's hit, what does the final fallback return).
- Two round-trips to the database per search instead of one (though step 2 is now scoped to ≤`k_large` ids, so it's cheap regardless of total table size — this is not the same cost as today's unindexed Query 1 over the whole table).
- Same fundamental limit as Option B in the worst case: if `k_large`'s nearest-neighbor set has very little overlap with the eligible set (a narrow filter against a huge table), several retries may be needed before finding enough results — bounded and safe (falls back to Option A's behavior), but not free.

**Urgency**: Same trigger as Option B — relevant once real usage data shows the 2000-cap in Query 1 is both a latency *and* a quality problem. Given it carries essentially none of Option B's safety-duplication risk, **if and when this becomes worth doing, Option C is the recommended shape over Option B** — it gets the same scaling benefit without touching the one piece of code this project has explicitly, deliberately kept singular for security reasons.

## 6. Summary table

| | Fixes Query 1 (the actual scale risk today) | Uses HNSW for ranking | Touches safety-filter code | New failure mode | Recommended urgency |
|---|---|---|---|---|---|
| **A — composite index** | Yes | No | No | None (index-only) | Do regardless of scale — already a confirmed gap today |
| **B — single fused query + iterative_scan** | No (would need A too) | Yes | **Yes — real duplication risk** | Unbounded worst-case latency on very selective filters; safety-logic drift risk | Only after A, and only once real usage data shows A isn't enough |
| **C — separate ANN query + intersect** | No (would need A too) | Yes | No | Needs a retry/widen loop; two round-trips | Only after A, and only once real usage data shows A isn't enough — preferred over B if that point is reached |

## 7. Decision record (2026-09-21)

- **Option A: DECIDED — implemented and verified.** See §3.2 for the real before/after evidence (~6.4x faster, ~70% fewer buffer accesses at 100k rows, real migration on the real dev DB).
- **Options B and C: EXPLICITLY DEFERRED, not resolved and not forgotten.** Recorded here verbatim per direct user decision (2026-09-21): **"Without real production traffic data, this decision is premature; if it's needed later, Option C is preferred over Option B because it doesn't re-implement the safety filter."** No further action on B/C until real production query-pattern data exists (actual filter selectivity, actual candidate-pool sizes, actual latency percentiles) — this is the explicit trigger for revisiting this section, not a timeline or a scale threshold guessed in advance.

---

*Option A closed out 2026-09-21. Options B/C remain open, tracked here, revisit only with real production data.*
