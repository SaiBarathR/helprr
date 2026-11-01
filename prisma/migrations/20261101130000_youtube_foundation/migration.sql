-- AlterEnum
ALTER TYPE "ServiceType" ADD VALUE 'YOUTUBE';

-- AlterEnum
ALTER TYPE "TwitchVideoType" ADD VALUE 'SHORT';

-- AlterEnum
ALTER TYPE "TwitchJobKind" ADD VALUE 'FORMATS';

-- AlterTable
ALTER TABLE "TwitchVideo" ADD COLUMN     "ageRestricted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "formats" JSONB,
ADD COLUMN     "formatsCheckedAt" TIMESTAMP(3),
ADD COLUMN     "liveEndedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TwitchWorkerHeartbeat" ADD COLUMN     "platforms" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "roots" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "YoutubeSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "autoDownloadEnabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultPolicy" JSONB NOT NULL DEFAULT '{}',
    "typePolicies" JSONB NOT NULL DEFAULT '{}',
    "jellyfinLibraryPath" TEXT,
    "jellyfinLibraryItemId" TEXT,
    "pollVideosSecs" INTEGER NOT NULL DEFAULT 600,
    "quotaDay" TEXT,
    "quotaUsed" INTEGER NOT NULL DEFAULT 0,
    "quotaSearches" INTEGER NOT NULL DEFAULT 0,
    "cookies" TEXT,
    "cookiesCheckedAt" TIMESTAMP(3),
    "cookiesValid" BOOLEAN,
    "extractorFailures" INTEGER NOT NULL DEFAULT 0,
    "toolsPausedAt" TIMESTAMP(3),
    "autoCleanupEnabled" BOOLEAN NOT NULL DEFAULT false,
    "cleanupJellyfinUserId" TEXT,
    "cleanupConnectionId" TEXT,
    "cleanupGeneration" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YoutubeSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorPlaylist" (
    "id" TEXT NOT NULL,
    "platform" "ArchivePlatform" NOT NULL DEFAULT 'YOUTUBE',
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerName" TEXT,
    "description" TEXT,
    "thumbnailUrl" TEXT,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "policy" JSONB NOT NULL DEFAULT '{}',
    "baselinedAt" TIMESTAMP(3),
    "nextCheckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorPlaylist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorPlaylistVideo" (
    "playlistId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorPlaylistVideo_pkey" PRIMARY KEY ("playlistId","videoId")
);

-- CreateTable
CREATE TABLE "CreatorPlaylistSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "notifyNewVideos" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorPlaylistSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreatorPlaylist_nextCheckAt_idx" ON "CreatorPlaylist"("nextCheckAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorPlaylist_platform_externalId_key" ON "CreatorPlaylist"("platform", "externalId");

-- CreateIndex
CREATE INDEX "CreatorPlaylistVideo_videoId_idx" ON "CreatorPlaylistVideo"("videoId");

-- CreateIndex
CREATE INDEX "CreatorPlaylistSubscription_playlistId_idx" ON "CreatorPlaylistSubscription"("playlistId");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorPlaylistSubscription_userId_playlistId_key" ON "CreatorPlaylistSubscription"("userId", "playlistId");

-- AddForeignKey
ALTER TABLE "CreatorPlaylistVideo" ADD CONSTRAINT "CreatorPlaylistVideo_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "CreatorPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorPlaylistVideo" ADD CONSTRAINT "CreatorPlaylistVideo_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "TwitchVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorPlaylistSubscription" ADD CONSTRAINT "CreatorPlaylistSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorPlaylistSubscription" ADD CONSTRAINT "CreatorPlaylistSubscription_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "CreatorPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
