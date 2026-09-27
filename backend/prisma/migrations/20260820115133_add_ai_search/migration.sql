-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "AiSearchMode" AS ENUM ('TEXT', 'VOICE');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "bioEmbedding" vector(1536);

-- CreateTable
CREATE TABLE "ai_search_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" "AiSearchMode" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_search_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_search_requests_userId_mode_createdAt_idx" ON "ai_search_requests"("userId", "mode", "createdAt");

-- AddForeignKey
ALTER TABLE "ai_search_requests" ADD CONSTRAINT "ai_search_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex (hand-written: docs/requirements.md Feature 9 §7 — Prisma's schema
-- DSL cannot express a pgvector similarity index. HNSW + cosine ops, matching
-- FR-111's `<=>` (cosine distance) operator. Without this, every ranked search
-- is a full table scan of every embedded user.
CREATE INDEX "users_bioEmbedding_hnsw_idx" ON "users" USING hnsw ("bioEmbedding" vector_cosine_ops);
