-- 2026-09-21: docs/ai-search-ranking-scaling-analysis.md §3 (Option A).
-- DeckService.getDeck() and AiSearchService.search() share the exact same
-- candidate-generation filter shape (verifiedOnly=livenessStatus, gender,
-- datingIntent, birthDate range), both capped at 2000 rows, and neither had
-- any supporting index for these columns (confirmed empty via pg_indexes,
-- 2026-09-21) — a real, already-flagged gap (2026-09-18 audit §2.2/2.3)
-- independent of the separate HNSW/vector-ranking question.
--
-- This composite index supersedes the old standalone index on
-- livenessStatus alone (dropped below) — livenessStatus as the leftmost
-- column still serves every query that filtered on it by itself.
--
-- NOTE for the next `prisma migrate dev` run: as with the HNSW index
-- (Unsupported vector column), Prisma's own diff engine CAN express this
-- particular index (plain columns, no Unsupported types) — this file was
-- hand-authored only because `prisma migrate dev`'s shadow-database step
-- hung against this project's Neon connection (no CREATE DATABASE
-- privilege on the pooled/direct users), not because of an HNSW-style
-- diff-visibility gap. A future `migrate dev` run should see this index
-- correctly and not propose dropping it.

-- DropIndex
DROP INDEX "users_livenessStatus_idx";

-- CreateIndex
CREATE INDEX "users_livenessStatus_gender_datingIntent_birthDate_idx" ON "users"("livenessStatus", "gender", "datingIntent", "birthDate");
