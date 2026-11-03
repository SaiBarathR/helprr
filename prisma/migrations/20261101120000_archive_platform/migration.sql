-- CreateEnum
CREATE TYPE "ArchivePlatform" AS ENUM ('TWITCH', 'YOUTUBE');

-- DropIndex
DROP INDEX "TwitchStreamer_twitchUserId_key";

-- DropIndex
DROP INDEX "TwitchStreamer_folderName_key";

-- DropIndex
DROP INDEX "TwitchVideo_twitchVideoId_key";

-- DropIndex
DROP INDEX "TwitchJob_requestedByUserId_clientRequestId_key";

-- DropIndex
DROP INDEX "TwitchDeletedFile_createdAt_idx";

-- DropIndex
DROP INDEX "TwitchMediaFile_relativePath_key";

-- AlterTable
ALTER TABLE "TwitchStreamer" ADD COLUMN     "platform" "ArchivePlatform" NOT NULL DEFAULT 'TWITCH';

-- AlterTable
ALTER TABLE "TwitchVideo" ADD COLUMN     "platform" "ArchivePlatform" NOT NULL DEFAULT 'TWITCH';

-- AlterTable
ALTER TABLE "TwitchJob" ADD COLUMN     "platform" "ArchivePlatform" NOT NULL DEFAULT 'TWITCH';

-- AlterTable
ALTER TABLE "TwitchDeletedFile" ADD COLUMN     "platform" "ArchivePlatform" NOT NULL DEFAULT 'TWITCH';

-- AlterTable
ALTER TABLE "TwitchMediaFile" ADD COLUMN     "platform" "ArchivePlatform" NOT NULL DEFAULT 'TWITCH';

-- CreateIndex
CREATE UNIQUE INDEX "TwitchStreamer_platform_twitchUserId_key" ON "TwitchStreamer"("platform", "twitchUserId");

-- CreateIndex
CREATE UNIQUE INDEX "TwitchStreamer_platform_folderName_key" ON "TwitchStreamer"("platform", "folderName");

-- CreateIndex
CREATE UNIQUE INDEX "TwitchVideo_platform_twitchVideoId_key" ON "TwitchVideo"("platform", "twitchVideoId");

-- CreateIndex
CREATE UNIQUE INDEX "TwitchJob_platform_requestedByUserId_clientRequestId_key" ON "TwitchJob"("platform", "requestedByUserId", "clientRequestId");

-- CreateIndex
CREATE INDEX "TwitchDeletedFile_platform_createdAt_idx" ON "TwitchDeletedFile"("platform", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TwitchMediaFile_platform_relativePath_key" ON "TwitchMediaFile"("platform", "relativePath");
