-- CreateEnum
CREATE TYPE "CallType" AS ENUM ('VOICE', 'VIDEO');

-- CreateEnum
CREATE TYPE "CallSessionStatus" AS ENUM ('RINGING', 'ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "CallEndReason" AS ENUM ('COMPLETED', 'DECLINED', 'MISSED', 'DURATION_LIMIT_REACHED');

-- Prisma's diff engine can't see the Feature 9 hand-written raw-SQL HNSW
-- vector index through its own schema DSL, so it generates a spurious
-- DROP INDEX "users_bioEmbedding_hnsw_idx" here on every migration that
-- touches anything else in the schema (docs/architecture.md §5.7) —
-- removed by hand, again, as documented.

-- CreateTable
CREATE TABLE "call_sessions" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "initiatorId" TEXT NOT NULL,
    "type" "CallType" NOT NULL,
    "status" "CallSessionStatus" NOT NULL DEFAULT 'RINGING',
    "durationLimitSeconds" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endReason" "CallEndReason",
    "connectionType" TEXT,
    "qualityStatsRef" TEXT,

    CONSTRAINT "call_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "call_sessions_matchId_createdAt_idx" ON "call_sessions"("matchId", "createdAt");

-- CreateIndex
CREATE INDEX "call_sessions_initiatorId_createdAt_idx" ON "call_sessions"("initiatorId", "createdAt");

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_initiatorId_fkey" FOREIGN KEY ("initiatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
