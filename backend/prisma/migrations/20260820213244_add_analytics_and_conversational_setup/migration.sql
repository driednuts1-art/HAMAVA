-- CreateEnum
CREATE TYPE "ConversationalSetupRequestKind" AS ENUM ('SESSION_START', 'TEXT_TURN', 'VOICE_TURN');

-- Prisma's diff engine can't see the Feature 9 hand-written raw-SQL HNSW
-- vector index through its own schema DSL, so it generates a spurious
-- DROP INDEX "users_bioEmbedding_hnsw_idx" here on every migration that
-- touches anything else in the schema (docs/architecture.md §5.7) —
-- removed by hand, again, as documented.

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "properties" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversational_setup_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ConversationalSetupRequestKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversational_setup_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analytics_events_userId_event_idx" ON "analytics_events"("userId", "event");

-- CreateIndex
CREATE INDEX "analytics_events_event_createdAt_idx" ON "analytics_events"("event", "createdAt");

-- CreateIndex
CREATE INDEX "conversational_setup_requests_userId_kind_createdAt_idx" ON "conversational_setup_requests"("userId", "kind", "createdAt");

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversational_setup_requests" ADD CONSTRAINT "conversational_setup_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
