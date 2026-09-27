-- CreateEnum
CREATE TYPE "ModerationContentType" AS ENUM ('BIO_TEXT', 'PHOTO', 'MESSAGE');

-- CreateEnum
CREATE TYPE "ModerationFlagStatus" AS ENUM ('PENDING_REVIEW', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ModerationFlagResolution" AS ENUM ('UPHELD', 'OVERTURNED');

-- CreateTable
CREATE TABLE "moderation_flags" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contentType" "ModerationContentType" NOT NULL,
    "textContent" TEXT,
    "quarantineStorageKey" TEXT,
    "reason" TEXT,
    "contextRef" TEXT,
    "status" "ModerationFlagStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "resolution" "ModerationFlagResolution",
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "moderation_flags_status_createdAt_idx" ON "moderation_flags"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "moderation_flags" ADD CONSTRAINT "moderation_flags_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_flags" ADD CONSTRAINT "moderation_flags_resolvedByAdminId_fkey" FOREIGN KEY ("resolvedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
