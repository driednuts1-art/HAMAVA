# Test users (seeded, real dev database)

Seeded 2026-08-26 via `backend/scripts/seed-test-users.ts` — real users, real profiles, created through the real API against the real dev database (never the load-test branch). All are re-loginable with the real mock OTP flow (`AUTH_OTP_DEBUG_ECHO=true` on the backend shows the code directly on the login screen, matching this project's own established dev-login convention).

**Renamed 2026-09-25 for the English/global identity pivot — same 20 real accounts, same ids, same phones, same real matches, just renamed via a real `PATCH /v1/profile`, never deleted/recreated. See "Global identity rename" below for the full rationale, the old↔new name/city mapping, and independent post-rename verification.** The table and every section below use the current, real names.

**20/20 users created successfully.**

| # | Name | Phone | Age | Gender | Intent | City | Verified | Created |
|---|---|---|---|---|---|---|---|---|
| 1 | Ali Rezaei | `+19005550001` | 24 | MALE | SERIOUS | Tehran | ✅ | ✅ |
| 2 | Sara Ahmadi | `+19005550002` | 28 | FEMALE | SERIOUS | Isfahan | ✅ | ✅ |
| 3 | Reza Mohammadi | `+19005550003` | 35 | MALE | CASUAL | Shiraz | ❌ | ✅ |
| 4 | Negar Hosseini | `+19005550004` | 26 | FEMALE | MARRIAGE_TRACK | Mashhad | ✅ | ✅ |
| 5 | Hossein Karimi | `+19005550005` | 41 | MALE | FRIENDSHIP | Tabriz | ✅ | ✅ |
| 6 | Maryam Sadeghi | `+19005550006` | 23 | FEMALE | NOT_SURE | Toronto | ❌ | ✅ |
| 7 | Amir Nouri | `+19005550007` | 30 | MALE | SERIOUS | Ahvaz | ✅ | ✅ |
| 8 | Zahra Rostami | `+19005550008` | 33 | FEMALE | CASUAL | Qom | ✅ | ✅ |
| 9 | Bahram Yazdani | `+19005550009` | 45 | MALE | MARRIAGE_TRACK | Berlin | ❌ | ✅ |
| 10 | Leila Sharifi | `+19005550010` | 27 | FEMALE | FRIENDSHIP | Urmia | ✅ | ✅ |
| 11 | Kian Moradi | `+19005550011` | 22 | MALE | NOT_SURE | Rasht | ✅ | ✅ |
| 12 | Yasaman Ghasemi | `+19005550012` | 38 | FEMALE | SERIOUS | Sydney | ✅ | ✅ |
| 13 | Arash Taheri | `+19005550013` | 29 | MALE | CASUAL | London | ❌ | ✅ |
| 14 | Niloufar Azizi | `+19005550014` | 25 | FEMALE | MARRIAGE_TRACK | Arak | ✅ | ✅ |
| 15 | Pouya Jafari | `+19005550015` | 31 | MALE | FRIENDSHIP | Yazd | ✅ | ✅ |
| 16 | Shida Akbari | `+19005550016` | 40 | FEMALE | NOT_SURE | Vancouver | ❌ | ✅ |
| 17 | Kamran Farhadi | `+19005550017` | 36 | MALE | SERIOUS | Sari | ✅ | ✅ |
| 18 | Roya Najafi | `+19005550018` | 24 | FEMALE | CASUAL | Dubai | ✅ | ✅ |
| 19 | Sina Bahrami | `+19005550019` | 27 | OTHER | FRIENDSHIP | Qazvin | ✅ | ✅ |
| 20 | Elnaz Heidari | `+19005550020` | 32 | OTHER | MARRIAGE_TRACK | Los Angeles | ❌ | ✅ |

## Real matches (18, as of 2026-09-25 — see "Global identity rename" for how this grew from the original 5, never documented incrementally in between)

- ✅ Ali Rezaei ↔ Sara Ahmadi
- ✅ Amir Nouri ↔ Leila Sharifi
- ✅ Kian Moradi ↔ Niloufar Azizi
- ✅ Kamran Farhadi ↔ Roya Najafi
- ✅ Negar Hosseini ↔ Hossein Karimi
- ✅ Ali Rezaei ↔ Negar Hosseini
- ✅ Ali Rezaei ↔ Roya Najafi
- ✅ Ali Rezaei ↔ Zahra Rostami
- ✅ Ali Rezaei ↔ Kamran Farhadi
- ✅ Leila Sharifi ↔ Zahra Rostami
- ✅ Pouya Jafari ↔ Yasaman Ghasemi
- ✅ Kian Moradi ↔ Zahra Rostami
- ✅ Ali Rezaei ↔ Hossein Karimi
- ✅ Sara Ahmadi ↔ Zahra Rostami
- ✅ Leila Sharifi ↔ Sara Ahmadi
- ✅ Sara Ahmadi ↔ Yasaman Ghasemi
- ✅ Sara Ahmadi ↔ Niloufar Azizi
- ✅ Sara Ahmadi ↔ Roya Najafi

**A real, correctly-explained finding, not a silent retry (original 2026-08-26 seeding)**: the original 5th pairing (Reza Mohammadi ↔ Maryam Sadeghi) genuinely could not match — both are unverified, and this app's real default (`messagingPermission: VERIFIED_ONLY`, `docs/requirements.md` Feature 6 FR-79) means a match can never form unless *each* side meets the *other's* verification requirement. Since every seeded user keeps the real default, **none of the 6 unverified users in this set (Reza Mohammadi, Maryam Sadeghi, Bahram Yazdani, Arash Taheri, Shida Akbari, Elnaz Heidari) can match with anyone here, verified or not** — correct, expected backend behavior, not a bug in the seed script. Replaced with a verified↔verified pair (Negar Hosseini ↔ Hossein Karimi) to reach a real, working 5/5.

## Feature 24 prompt-answer backfill (2026-09-05)

Ran `backend/scripts/backfill-seed-prompts.ts` against these same 20 users — a real, deliberate decision (Feature 24 §10 #4: backfill, not grandfather), since `profileCompletedAt` never re-evaluates once set, so without this every seed user would show a fully "complete" profile with an empty, decorative prompt section. Each user got 2 real prompt answers, hand-written against their own existing bio/city/interests (`backend/scripts/seed-test-users.ts`), applied via the real `PATCH /v1/profile` (never a direct DB write) using the same `VirtualUser`/real-OTP-login pattern `seed-test-users.ts` itself uses.

**20/20 succeeded, real-verified afterward**: every user still has a real, non-null `profileCompletedAt` post-backfill (checked via the same script, not assumed). Idempotent — safe to re-run; it always overwrites with the same 2 real answers per user.

## Pre-deploy cleanup (2026-09-06)

Before the final pre-deploy regression pass: dev DB had grown to 368 users (348 real e2e-test-created accounts, entirely expected per "Dev database hygiene" in `docs/roadmap.md`). Cleaned via `deleteMany({ where: { displayName: { notIn: <20 seed names> } } })`. **A real Prisma gap found doing this**: `notIn` never matches a `NULL` displayName (SQL `NOT IN` against NULL is neither true nor false) — the first pass only deleted 267 non-null non-seed rows, silently leaving 81 `displayName: null` stragglers (incomplete signups from various e2e tests) behind; a second `deleteMany({ where: { displayName: null } })` cleared those, confirmed by checking `nonNullNonSeed` was genuinely `0` before running it. **Final state, real-verified**: exactly 20 users remain, all 20 real seed users present, all 5 original documented matches intact, plus 4 additional real seed-to-seed matches created during this session's own manual Feature 24 verification (Ali Rezaei ↔ Negar Hosseini / Roya Najafi / Zahra Rostami / Kamran Farhadi) — kept, since both sides of each are real seed accounts, not test pollution.

## Post-final-regression cleanup (2026-09-07)

After the final pre-deploy regression pass (backend unit + e2e, full frontend e2e, file-by-file) added another 105 real test-created accounts (63 non-null-displayName + 42 incomplete `displayName: null` signups — the same two-pass `notIn`/`null` cleanup from above applied again, since the `NOT IN`-vs-`NULL` gap is a structural Prisma behavior, not a one-off), re-ran the identical two-pass cleanup. **Final state, re-verified**: exactly 20 users, all seed, and all 9 real matches (the original 5 plus the 4 seed-to-seed ones added during Feature 24) confirmed still intact via a direct query immediately after cleanup.

## The `notIn`/`NULL` gap is now fixed permanently, not worked around a third time

Two occurrences of the exact same manual two-pass workaround (above) is a real, recurring cost — promoted to a permanent script, `backend/scripts/clean-non-seed-users.ts`, that gets both cases right in a **single** `deleteMany` query (an explicit `OR: [{ displayName: { notIn: seedNames } }, { displayName: null }]`, which doesn't share `NOT IN`'s NULL blind spot) — no second manual pass required, ever again. Defaults to a dry run; `--confirm` actually deletes. Refuses to run against anything that doesn't look like this project's own Neon dev database.

**Verified for real, not just written**: a synthetic probe user with `displayName: null` was created directly, the dry run correctly reported it as 1 non-seed user to delete, and `--confirm` deleted it in that single run — confirmed immediately after via a fresh count (20/20 seed users, 9/9 matches intact). The fix closes the gap; it isn't just a rewrite that looks correct on paper.

## A real, separate finding: Ali Rezaei's own `displayName` had silently drifted (2026-09-07)

Found by the new cleanup script itself, not assumed away: a routine dry run reported "Seed users found: 19 (expected 20)" — one exact-name match short. Investigated directly rather than re-run and hope: a real DB query confirmed the row had an extra character appended to its real Persian name (`علی رضاییان` instead of `علی رضایی`) — while `seed-test-users.ts`'s own source still had the original spelling. Likely drifted from this exact real seed account being reused for manual profile-form testing at some earlier point in this project's history (a real risk of testing against real seed accounts instead of disposable ones — worth remembering, not a one-off). Fixed the same way this project fixes any user data: logged in as the real account and corrected the name through the real edit form (a real `PATCH /v1/profile`), not a direct DB write. Re-verified immediately: the cleanup script now reports 20/20 exact seed-name matches, and all 9 real matches remain intact.

## Global identity rename (2026-09-25)

Per explicit user request, following the backend/frontend English-language migration (`docs/i18n-rtl-migration-scope.md`) and Phase 5's backend production-string work: all 20 real seed users renamed from their original Persian display names and Iranian cities to Latin-transliterated English names and (for 7 of them) international cities.

**Mandatory pre-check, run and reported before any change**: every e2e test file in the repo was searched for hardcoded dependencies on these 20 users' names or phone numbers before touching anything.
- `frontend/e2e/visual-audit.spec.ts` — heavy dependency: 13 names hardcoded in `findUnmatchedVerifiedPair()`'s candidate pool, plus several individual tests referencing specific names directly.
- `frontend/e2e/landing.spec.ts` — light dependency: one phone number (`+19005550001`) and one comment naming Ali Rezaei.
- `frontend/e2e/welcome-tour.spec.ts` — lightest: one phone number only, no name dependency.
- `backend/test/*.e2e-spec.ts` (all 16 files) — confirmed zero dependency; every backend e2e test creates its own fresh, uniquely-phoned user and never touches this shared seed data.
- `backend/scripts/seed-test-users.ts`, `backend/scripts/backfill-seed-prompts.ts`, `backend/scripts/clean-non-seed-users.ts` — not tests, but the actual source-of-truth scripts, all updated alongside (`clean-non-seed-users.ts`'s `SEED_DISPLAY_NAMES` especially — a stale entry there would make the *next* cleanup run think these are non-seed accounts and delete them).

**A real, pre-existing drift found by this same pre-check, unrelated to the rename itself**: `docs/test-users.md` (this file) still documented only 5, then later 9, real matches — a direct DB query for this rename found **18 real matches** currently exist among these 20 accounts, accumulated silently across sessions' own manual/exploratory testing and never documented incrementally. The table above now reflects that real, current count.

**Old → new name and city mapping** (ages, genders, dating intents, bios, interests, verification status, and photos are all explicitly untouched — out of scope for this rename):

| Old name (city) | New name (city) |
|---|---|
| علی رضایی (تهران) | Ali Rezaei (Tehran) |
| سارا احمدی (اصفهان) | Sara Ahmadi (Isfahan) |
| رضا محمدی (شیراز) | Reza Mohammadi (Shiraz) |
| نگار حسینی (مشهد) | Negar Hosseini (Mashhad) |
| حسین کریمی (تبریز) | Hossein Karimi (Tabriz) |
| مریم صادقی (کرج) | Maryam Sadeghi (**Toronto** — relocated) |
| امیر نوری (اهواز) | Amir Nouri (Ahvaz) |
| زهرا رستمی (قم) | Zahra Rostami (Qom) |
| بهرام یزدانی (کرمانشاه) | Bahram Yazdani (**Berlin** — relocated) |
| لیلا شریفی (ارومیه) | Leila Sharifi (Urmia) |
| کیان مرادی (رشت) | Kian Moradi (Rasht) |
| یاسمن قاسمی (زاهدان) | Yasaman Ghasemi (**Sydney** — relocated) |
| آرش طاهری (کرمان) | Arash Taheri (**London** — relocated) |
| نیلوفر عزیزی (اراک) | Niloufar Azizi (Arak) |
| پویا جعفری (یزد) | Pouya Jafari (Yazd) |
| شیدا اکبری (همدان) | Shida Akbari (**Vancouver** — relocated) |
| کامران فرهادی (ساری) | Kamran Farhadi (Sari) |
| رویا نجفی (بندرعباس) | Roya Najafi (**Dubai** — relocated) |
| سینا بهرامی (قزوین) | Sina Bahrami (Qazvin) |
| الناز حیدری (زنجان) | Elnaz Heidari (**Los Angeles** — relocated) |

**Why 7 relocated internationally and 13 kept a transliterated Iranian city, a deliberate, documented choice rather than either extreme**: keeping all 20 in Iranian cities would understate the app's now-explicitly-global audience; moving all 20 abroad would erase a real, legitimate part of these curated demo personas' identity and imply Iranian cities aren't part of "global." The 13 that kept their (transliterated) Iranian city are the larger, internationally-recognizable ones (Tehran, Isfahan, Shiraz, Mashhad, Tabriz, Ahvaz, Qom, Urmia, Rasht, Arak, Yazd, Sari, Qazvin) — real cities an international audience would recognize as real places, not evidence of a narrow, single-country product. The 7 relocated to genuinely diverse international cities across 6 different countries and 5 continents (Toronto, Berlin, Sydney, London, Vancouver, Dubai, Los Angeles) were the smaller, less internationally-recognizable ones (Karaj, Kermanshah, Zahedan, Kerman, Hamadan, Bandar Abbas, Zanjan) — chosen so the visual/narrative effect of "this app has real users worldwide" is genuinely visible in the seed data (e.g. capture 07-09's discovery deck, capture 25's who-liked-me screen) without discarding the majority of these personas' original geographic identity.

**Explicitly out of scope, not touched**: bios and interests remain in their original Persian — the user's request was scoped to names and cities only. This mirrors the exact same "backend PROMPTS translated, but content fields users write for themselves stay as-is unless explicitly asked" discipline already applied elsewhere in this migration.

**Applied as a real, direct update — never delete/recreate**: `backend/scripts/migrate-seed-users-global-identity.ts` (new, kept in the repo, idempotent) logged into each of the 20 real, already-existing accounts via the same real OTP flow every other seed script uses (same phone number, same account, same user id — not a new signup), verified the account's *current* name matched the expected old name before writing (a real safety check against ever renaming the wrong account), then PATCHed only `displayName` and `city` via the real `PATCH /v1/profile` endpoint. **Real result: 20/20 succeeded, every PATCH echoed back the exact new values.**

**Independently verified afterward, not assumed**, via direct Postgres queries (not the migration script's own self-report):
- Exactly 20 users found with the new English names; zero rows remain with any of the 20 old Persian names.
- Verification status (`livenessStatus`) unchanged for all 20 — confirmed matching the original ✅/❌ pattern exactly.
- All **18** real matches survived with their exact original match ids (a direct id-by-id diff against the pre-rename query) — confirming these are the same real match rows with the join simply resolving to the new names, not new rows.

**e2e test files updated and independently re-verified with a real run, per the mandatory pre-check above**:
- `frontend/e2e/visual-audit.spec.ts`: every hardcoded name/comment updated to the new English names. `findUnmatchedVerifiedPair()`'s candidate pool was additionally refactored from a hardcoded-displayName lookup to a hardcoded-**user-id** lookup with the real, current displayName fetched fresh from the DB each run — a deliberate resilience improvement (the user's own suggestion) so a *future* rename or seed-data edit doesn't break this test again; explicitly NOT widened to "any two verified users," since that would risk picking arbitrary, un-curated e2e-test-junk accounts instead of these deliberately good-looking demo profiles, defeating the point of a visual design audit.
- `frontend/e2e/landing.spec.ts`: the one comment naming Ali Rezaei updated; no functional change (it only depends on the phone number).
- `frontend/e2e/welcome-tour.spec.ts`: no change needed — confirmed to depend only on the phone number, not the name.
- A pre-existing, unrelated finding surfaced by this same rename's re-verification (not caused by it): `visual-audit.spec.ts`'s "who liked me, populated" capture still expects a real, pending super-like from Ali Rezaei to Hossein Karimi — but (per the entry above) that pair already turned into a real match on 2026-09-16. Tracked separately in `docs/roadmap.md`'s Watch items, not fixed as part of this rename.
