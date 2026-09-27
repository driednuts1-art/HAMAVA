-- AlterTable
ALTER TABLE "users" ADD COLUMN     "hasSeenWelcomeTour" BOOLEAN NOT NULL DEFAULT false;

-- Feature 29 (FR-502): backfill — every row that already has a real,
-- completed profile at migration time must not be shown a retroactive
-- "welcome" tour. Only genuinely new/incomplete profiles keep the column's
-- real default of false.
UPDATE "users" SET "hasSeenWelcomeTour" = true WHERE "profileCompletedAt" IS NOT NULL;
