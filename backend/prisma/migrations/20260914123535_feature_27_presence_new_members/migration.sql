-- AlterTable
ALTER TABLE "discovery_preferences" ADD COLUMN     "newMembersOnly" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "lastOnlineAt" TIMESTAMP(3),
ADD COLUMN     "showLastActiveStatus" BOOLEAN NOT NULL DEFAULT true;
