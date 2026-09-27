# AI Evaluation Framework

Feature 21's answer to the master directive's §19/§20/§21: a real, runnable evaluation harness against the real OpenAI account (never mocked, matching this project's standing testing discipline — `docs/architecture.md` throughout), with synthetic, purpose-authored fixtures (never real user data, per the master directive's explicit prohibition). This is a **baseline-measurement tool, not a pass/fail CI gate** — the master directive is explicit that "perfect numerical metrics" are not required up front, only real, honest, reproducible measurement.

## Structure

```
backend/scripts/ai-evals/
  eval-conversational-extraction.ts   -- domain 1, populated, run for real (below)
  eval-ai-search-extraction.ts        -- domain 2, populated, run for real (below)
  fixtures/
    conversational-extraction.json
    ai-search-extraction.json
```

Run either with `npx ts-node scripts/ai-evals/<script>.ts` from `backend/`. Both need the same real `OPENAI_API_KEY`/timeout env vars the app itself uses (`.env`) — no separate eval-only credentials.

## Domains — status

Per the master directive's named list of seven domains:

| Domain | Status | Where |
|---|---|---|
| Profile Extraction (conversational setup) | ✅ Populated, run for real | `eval-conversational-extraction.ts` |
| Search Filter Extraction (AI Prompt Search) | ✅ Populated, run for real | `eval-ai-search-extraction.ts` |
| Intent Detection | Not applicable as a separate domain — `datingIntent` is a plain enum field extracted as part of the AI-search filter-extraction domain above, not a standalone intent-classification model (`docs/architecture-review-v2.md` §G: no dynamic Intent concept exists). |
| Match Ranking | 🔲 Structured, not populated — needs real seeded candidate pairs with known-correct rank order; deferred, not rushed (`docs/requirements.md` Feature 21 Open Items #4). |
| Match Explanation | 🔲 Structured, not populated — the *safety* half (grounding-check discrimination) is already covered by real e2e tests (`match-explanation-boost.e2e-spec.ts`); a dedicated *quality* eval (are the reasons/mismatches actually useful, not just non-hallucinated) is separate, deferred work. |
| Translation | 🔲 Not applicable yet — no translation feature exists in this codebase (`docs/architecture-review-v2.md` §G: MISSING). Structure reserved for when one is built. |
| Speech Recognition (Whisper) | 🔲 Not populated — this project's existing precedent (`docs/architecture.md` §5.6/§5.8) already verifies real Whisper transcription end-to-end per feature via a real committed audio fixture; a dedicated accuracy eval (WER against a known transcript) is separate, deferred work. |
| Moderation | 🔲 Not populated — `test/moderation.e2e-spec.ts` already exercises real vendor classification of both benign and genuinely threatening content per-feature; a dedicated false-positive/false-negative rate eval across a larger fixture set is separate, deferred work. |

Two of seven populated for real in this pass, deliberately — see `docs/requirements.md` Feature 21 Open Items #4 for why the rest aren't rushed just to fill the table.

## Real baseline results (run 2026-08-23, against `gpt-4o-mini`)

**Conversational extraction** (8 fixtures): **field accuracy 7/8 (87.5%)**, **value accuracy 4/4 (100%)** on the fixtures where a specific value was checked.

**AI-search filter extraction** (6 fixtures, 12 checked dimensions across city/age/gender/relationshipGoal): **11/12 (91.7%)**.

Both numbers are single-run snapshots against a genuinely non-deterministic vendor — re-running will not reproduce them exactly, and that's expected, not a bug in the harness.

### The one real failure worth documenting in detail, not just as a percentage

Conversational-extraction fixture #5 fed the message **"هوا امروز خیلی خوبه"** ("the weather is nice today" — no location, no name, nothing about any of the five profile fields) with `city` still needed. The system prompt explicitly instructs: *"Never invent a value that isn't actually stated or clearly implied... set field to null."* The eval's single run returned `field: "city", stringValue: "تهران"` — a real hallucination, not a borderline judgment call.

**Root-caused, not just logged as a percentage**: re-ran the identical input 5 times in isolation. **4/5 correctly returned `field: null`**; **1/5 reproduced the same hallucination** (`field: "city", stringValue: "تهران", confidence: 0.8`). This confirms a real, low-frequency (~1-in-5 on this specific adversarial-ish input), non-deterministic vendor failure mode — not a one-off fluke, not a harness bug, and not something the existing system prompt fully prevents despite explicitly instructing against it.

**Why this doesn't compromise data integrity, and why it's still worth tracking**: `ConversationalSetupService`'s confirmation gate (`docs/architecture-review-v2.md` §D) means this hallucinated proposal is never written anywhere by itself — a human would have to see "تهران" proposed for a field they never mentioned and actively confirm it. The structural safeguard holds. What this finding *does* call into question is **how much the `confidence` field (FR-287) itself can be trusted**: the hallucinated proposal carried `confidence: 0.8`, the same high-confidence range a correct extraction would carry — the model was not self-aware that this particular proposal was invented. **Recorded here as a known, real limitation**: `confidence` is a useful signal for *typical* cases but should not be read as a reliable hallucination detector for the conversational-extraction path — there is no independent grounding-check step here the way `MatchExplanationService` has for match explanations (`docs/architecture-review-v2.md` §C), and building one is real, separate, deferred work, not assumed to already exist.

AI-search extraction's one miss (fixture #5, "بالای ۳۵ سال" → `minAge: 36` instead of `35`) is a minor, defensible off-by-one interpretation ("above 35" read as exclusive rather than inclusive), not a hallucination — noted for completeness, not flagged as a real problem.

## How to read a future run

- **A percentage moving meaningfully down** after a prompt/schema/model change is the actual signal to act on — re-run before and after any change to `openai-conversational-extraction.provider.ts` or `openai-extraction.provider.ts`.
- **A specific failure that reproduces** (like the one above) is worth a root-cause pass exactly like the one performed here — five repeats, not one, before concluding anything about frequency.
- **A specific failure that doesn't reproduce on re-run** is ordinary LLM non-determinism — not evidence of a regression by itself, matching this project's own established standard for treating single AI-generation failures (`docs/architecture.md` §5.7's grounding-check precedent).

## Adding a new fixture case

Edit the relevant `fixtures/*.json` file directly — each case is self-describing (input + expected output on whichever dimensions matter for that case; omitting an `expected*` key means "not checked for this case," not "expected to be empty"). No code change needed for a new case within an existing domain.
