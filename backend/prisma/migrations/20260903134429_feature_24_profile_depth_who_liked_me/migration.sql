-- CreateEnum
CREATE TYPE "Education" AS ENUM ('HIGH_SCHOOL', 'BACHELORS', 'MASTERS', 'DOCTORATE', 'TRADE_SCHOOL', 'OTHER');

-- CreateEnum
CREATE TYPE "ExerciseHabit" AS ENUM ('NEVER', 'SOMETIMES', 'REGULARLY', 'DAILY');

-- CreateEnum
CREATE TYPE "KidsStatus" AS ENUM ('HAVE_KIDS', 'WANT_KIDS', 'HAVE_AND_WANT_MORE', 'DONT_WANT_KIDS', 'NOT_SURE');

-- CreateEnum
CREATE TYPE "ZodiacSign" AS ENUM ('ARIES', 'TAURUS', 'GEMINI', 'CANCER', 'LEO', 'VIRGO', 'LIBRA', 'SCORPIO', 'SAGITTARIUS', 'CAPRICORN', 'AQUARIUS', 'PISCES');

-- CreateEnum
CREATE TYPE "PoliticalView" AS ENUM ('NOT_INTERESTED', 'INTERESTED', 'PREFER_NOT_TO_SAY');

-- CreateEnum
CREATE TYPE "DrinkingHabit" AS ENUM ('NEVER', 'SOMETIMES', 'REGULARLY');

-- CreateEnum
CREATE TYPE "SmokingHabit" AS ENUM ('NEVER', 'SOMETIMES', 'REGULARLY');

-- DropIndex
DROP INDEX "users_bioEmbedding_hnsw_idx";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "drinking" "DrinkingHabit",
ADD COLUMN     "education" "Education",
ADD COLUMN     "exerciseHabit" "ExerciseHabit",
ADD COLUMN     "hasKids" "KidsStatus",
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "hideDrinkingSmoking" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hometown" TEXT,
ADD COLUMN     "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "politicalView" "PoliticalView",
ADD COLUMN     "promptAnswers" JSONB,
ADD COLUMN     "smoking" "SmokingHabit",
ADD COLUMN     "whoLikedMeSeenAt" TIMESTAMP(3),
ADD COLUMN     "zodiacSign" "ZodiacSign";

-- CreateIndex
CREATE INDEX "swipes_targetId_action_createdAt_idx" ON "swipes"("targetId", "action", "createdAt");
