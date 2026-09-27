-- Prisma's diff engine can't see the Feature 9 hand-written raw-SQL HNSW
-- vector index through its own schema DSL, so it generates a spurious
-- DROP INDEX "users_bioEmbedding_hnsw_idx" here on every migration that
-- touches anything else in the schema (docs/architecture.md §5.7) —
-- removed by hand, again, as documented.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "allowInSafetyShares" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "date_share_links" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "datetime" TIMESTAMP(3) NOT NULL,
    "locationText" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "date_share_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "date_share_link_lookup_attempts" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "date_share_link_lookup_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "date_share_links_tokenHash_key" ON "date_share_links"("tokenHash");

-- CreateIndex
CREATE INDEX "date_share_links_userId_createdAt_idx" ON "date_share_links"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "date_share_link_lookup_attempts_ip_createdAt_idx" ON "date_share_link_lookup_attempts"("ip", "createdAt");

-- AddForeignKey
ALTER TABLE "date_share_links" ADD CONSTRAINT "date_share_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "date_share_links" ADD CONSTRAINT "date_share_links_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
