-- AlterTable
ALTER TABLE "YoutubeSettings" ADD COLUMN     "cleanupConnectionFingerprint" TEXT,
ADD COLUMN     "cleanupRanAt" TIMESTAMP(3),
ADD COLUMN     "cleanupStatus" TEXT;

-- AlterTable
ALTER TABLE "TwitchMediaFile" ADD COLUMN     "clearsAt" TIMESTAMP(3);
