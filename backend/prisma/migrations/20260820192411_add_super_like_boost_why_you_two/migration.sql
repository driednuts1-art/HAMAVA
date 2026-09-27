-- NOTE: Prisma's diff wanted to DROP INDEX "users_bioEmbedding_hnsw_idx" here —
-- it's a hand-written raw-SQL index (Feature 9's ai_search migration) that
-- Prisma's schema DSL can't express, so its own migration-history replay
-- doesn't "see" it as declared and proposes dropping it on every subsequent
-- migrate dev. Deliberately removed from this file — that index is real
-- infrastructure (pgvector HNSW similarity search) and must not be dropped.

-- AlterTable
ALTER TABLE "matches" ADD COLUMN     "whyYouTwo" TEXT;

-- AlterTable
ALTER TABLE "swipes" ADD COLUMN     "aiExplanation" TEXT;

-- CreateTable
CREATE TABLE "boosts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "boosts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "boosts_userId_endsAt_idx" ON "boosts"("userId", "endsAt");

-- CreateIndex
CREATE INDEX "boosts_userId_createdAt_idx" ON "boosts"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "boosts" ADD CONSTRAINT "boosts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
