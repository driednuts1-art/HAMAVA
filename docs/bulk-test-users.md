# Bulk test users (seeded, real dev database)

Seeded 2026-09-13 via `backend/scripts/seed-bulk-users.ts` — real users, real profiles, real AI-generated (gpt-image-1) photos, created through the real API against the real dev database. Adds to, never replaces, the 20 curated seed users in `docs/test-users.md`. Built to fix a real, reported gap: the discovery deck reading "فعلاً کسی نمونده" once every original seed user had already been swiped on.

**0/1 users created successfully.** No forced matches among them (unlike the curated 20) — the point is deck volume for real browsing/swiping, not a pre-built matches list.

| # | Name | Phone | Age | Gender | Intent | City | Verified | Created |
|---|---|---|---|---|---|---|---|---|
| 1 | علی حسینی | `+19005560001` | 20 | MALE | SERIOUS | تهران | ❌ | ❌ PATCH /v1/profile failed: 503 {"type":"about:blank","title":"Service Unavailable","status":503,"detail":"Moderation service returned 429.","instance":"/v1/profile"} |
