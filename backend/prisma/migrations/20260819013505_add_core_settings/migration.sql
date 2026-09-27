-- CreateEnum
CREATE TYPE "MessagingPermission" AS ENUM ('EVERYONE', 'VERIFIED_ONLY');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "messagingPermission" "MessagingPermission" NOT NULL DEFAULT 'VERIFIED_ONLY',
ADD COLUMN     "notifyOnNewMatch" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyOnNewMessage" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyOnSafetyAlert" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "preciseLocationEnabled" BOOLEAN NOT NULL DEFAULT false;
