-- Additive only.
-- CreateEnum
CREATE TYPE "TwitchVideoType" AS ENUM ('ARCHIVE', 'HIGHLIGHT', 'UPLOAD', 'CLIP');

-- CreateEnum
CREATE TYPE "TwitchVideoAvailability" AS ENUM ('RECORDING', 'PUBLISHED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "TwitchJobKind" AS ENUM ('DOWNLOAD', 'REENCODE', 'DELETE_FILES');

-- CreateEnum
CREATE TYPE "TwitchJobState" AS ENUM ('QUEUED', 'BLOCKED', 'RUNNING', 'RETRY_WAIT', 'DONE', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TwitchJobSource" AS ENUM ('MANUAL', 'RULE', 'URGENCY', 'URL');

-- CreateTable
CREATE TABLE "TwitchSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "autoDownloadEnabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultPolicy" JSONB NOT NULL DEFAULT '{}',
    "typePolicies" JSONB NOT NULL DEFAULT '{}',
    "jellyfinLibraryPath" TEXT,
    "jellyfinLibraryItemId" TEXT,
    "pollLiveSecs" INTEGER NOT NULL DEFAULT 60,
    "pollVideosSecs" INTEGER NOT NULL DEFAULT 300,
    "lastLivePollAt" TIMESTAMP(3),
    "maxConcurrentDownloads" INTEGER NOT NULL DEFAULT 2,
    "minFreeGb" INTEGER NOT NULL DEFAULT 50,
    "reencodeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "reencodeGlobalQuality" INTEGER NOT NULL DEFAULT 20,
    "reencodePreset" TEXT NOT NULL DEFAULT 'faster',
    "reencodeWindowStart" TEXT NOT NULL DEFAULT '01:00',
    "reencodeWindowEnd" TEXT NOT NULL DEFAULT '08:00',
    "keepOriginalDays" INTEGER NOT NULL DEFAULT 3,
    "jellyfinBusyUntil" TIMESTAMP(3),
    "browserAuthToken" TEXT,
    "browserAuthTokenCheckedAt" TIMESTAMP(3),
    "browserAuthTokenValid" BOOLEAN,
    "pinnedTools" JSONB NOT NULL DEFAULT '{}',
    "toolUpdateRequestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TwitchSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwitchStreamer" (
    "id" TEXT NOT NULL,
    "twitchUserId" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "folderName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "profileImageUrl" TEXT,
    "offlineImageUrl" TEXT,
    "broadcasterType" TEXT NOT NULL DEFAULT '',
    "isLive" BOOLEAN NOT NULL DEFAULT false,
    "liveStreamId" TEXT,
    "liveTitle" TEXT,
    "liveCategory" TEXT,
    "liveMissedChecks" INTEGER NOT NULL DEFAULT 0,
    "lastLiveAt" TIMESTAMP(3),
    "baselinedAt" TIMESTAMP(3),
    "nextVideosCheckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TwitchStreamer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwitchSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "streamerId" TEXT NOT NULL,
    "notifyNewVods" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TwitchSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwitchStreamerPolicy" (
    "id" TEXT NOT NULL,
    "streamerId" TEXT NOT NULL,
    "policy" JSONB NOT NULL DEFAULT '{}',
    "typePolicies" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TwitchStreamerPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwitchVideo" (
    "id" TEXT NOT NULL,
    "twitchVideoId" TEXT NOT NULL,
    "streamerId" TEXT NOT NULL,
    "type" "TwitchVideoType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "twitchCreatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER NOT NULL,
    "thumbnailUrl" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "language" TEXT,
    "streamId" TEXT,
    "mutedSegments" JSONB,
    "availability" "TwitchVideoAvailability" NOT NULL DEFAULT 'PUBLISHED',
    "estimatedExpiresAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "missingSweeps" INTEGER NOT NULL DEFAULT 0,
    "notifiedAt" TIMESTAMP(3),
    "expiryNotifiedAt" TIMESTAMP(3),
    "seasonEpisode" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TwitchVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwitchUserVideoState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3),
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TwitchUserVideoState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwitchJob" (
    "id" TEXT NOT NULL,
    "kind" "TwitchJobKind" NOT NULL,
    "videoId" TEXT,
    "mediaFileId" TEXT,
    "state" "TwitchJobState" NOT NULL DEFAULT 'QUEUED',
    "source" "TwitchJobSource" NOT NULL DEFAULT 'MANUAL',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "options" JSONB NOT NULL DEFAULT '{}',
    "trace" JSONB,
    "requestedByUserId" TEXT,
    "requestedByUsername" TEXT,
    "clientRequestId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "stage" TEXT,
    "progress" DOUBLE PRECISION,
    "bytesDone" BIGINT,
    "bytesTotal" BIGINT,
    "errorClass" TEXT,
    "lastError" TEXT,
    "needsJellyfinRefresh" BOOLEAN NOT NULL DEFAULT false,
    "failureNotifiedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TwitchJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwitchJobEvent" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TwitchJobEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwitchMediaFile" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "sidecars" JSONB NOT NULL DEFAULT '[]',
    "sizeBytes" BIGINT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "videoCodec" TEXT NOT NULL,
    "height" INTEGER,
    "reencodedAt" TIMESTAMP(3),
    "originalRelativePath" TEXT,
    "originalDeleteAfter" TIMESTAMP(3),
    "keepForever" BOOLEAN NOT NULL DEFAULT false,
    "jellyfinItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TwitchMediaFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwitchWorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "tools" JSONB NOT NULL DEFAULT '{}',
    "gpuAvailable" BOOLEAN NOT NULL DEFAULT false,
    "diskFreeBytes" BIGINT,
    "diskTotalBytes" BIGINT,
    "lanes" JSONB NOT NULL DEFAULT '{}',
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TwitchWorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TwitchStreamer_twitchUserId_key" ON "TwitchStreamer"("twitchUserId");

-- CreateIndex
CREATE UNIQUE INDEX "TwitchStreamer_folderName_key" ON "TwitchStreamer"("folderName");

-- CreateIndex
CREATE INDEX "TwitchStreamer_nextVideosCheckAt_idx" ON "TwitchStreamer"("nextVideosCheckAt");

-- CreateIndex
CREATE INDEX "TwitchSubscription_streamerId_idx" ON "TwitchSubscription"("streamerId");

-- CreateIndex
CREATE UNIQUE INDEX "TwitchSubscription_userId_streamerId_key" ON "TwitchSubscription"("userId", "streamerId");

-- CreateIndex
CREATE UNIQUE INDEX "TwitchStreamerPolicy_streamerId_key" ON "TwitchStreamerPolicy"("streamerId");

-- CreateIndex
CREATE UNIQUE INDEX "TwitchVideo_twitchVideoId_key" ON "TwitchVideo"("twitchVideoId");

-- CreateIndex
CREATE INDEX "TwitchVideo_streamerId_twitchCreatedAt_idx" ON "TwitchVideo"("streamerId", "twitchCreatedAt");

-- CreateIndex
CREATE INDEX "TwitchVideo_availability_estimatedExpiresAt_idx" ON "TwitchVideo"("availability", "estimatedExpiresAt");

-- CreateIndex
CREATE INDEX "TwitchUserVideoState_videoId_idx" ON "TwitchUserVideoState"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "TwitchUserVideoState_userId_videoId_key" ON "TwitchUserVideoState"("userId", "videoId");

-- CreateIndex
CREATE INDEX "TwitchJob_state_kind_priority_runAfter_idx" ON "TwitchJob"("state", "kind", "priority", "runAfter");

-- CreateIndex
CREATE INDEX "TwitchJob_videoId_idx" ON "TwitchJob"("videoId");

-- CreateIndex
CREATE INDEX "TwitchJob_needsJellyfinRefresh_idx" ON "TwitchJob"("needsJellyfinRefresh");

-- CreateIndex
CREATE UNIQUE INDEX "TwitchJob_requestedByUserId_clientRequestId_key" ON "TwitchJob"("requestedByUserId", "clientRequestId");

-- CreateIndex
CREATE INDEX "TwitchJobEvent_jobId_createdAt_idx" ON "TwitchJobEvent"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "TwitchJobEvent_createdAt_idx" ON "TwitchJobEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TwitchMediaFile_relativePath_key" ON "TwitchMediaFile"("relativePath");

-- CreateIndex
CREATE INDEX "TwitchMediaFile_videoId_idx" ON "TwitchMediaFile"("videoId");

-- CreateIndex
CREATE INDEX "TwitchMediaFile_originalDeleteAfter_idx" ON "TwitchMediaFile"("originalDeleteAfter");

-- CreateIndex
CREATE UNIQUE INDEX "TwitchWorkerHeartbeat_workerId_key" ON "TwitchWorkerHeartbeat"("workerId");

-- AddForeignKey
ALTER TABLE "TwitchSubscription" ADD CONSTRAINT "TwitchSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TwitchSubscription" ADD CONSTRAINT "TwitchSubscription_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "TwitchStreamer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TwitchStreamerPolicy" ADD CONSTRAINT "TwitchStreamerPolicy_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "TwitchStreamer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TwitchVideo" ADD CONSTRAINT "TwitchVideo_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "TwitchStreamer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TwitchUserVideoState" ADD CONSTRAINT "TwitchUserVideoState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TwitchUserVideoState" ADD CONSTRAINT "TwitchUserVideoState_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "TwitchVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TwitchJob" ADD CONSTRAINT "TwitchJob_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "TwitchVideo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TwitchJob" ADD CONSTRAINT "TwitchJob_mediaFileId_fkey" FOREIGN KEY ("mediaFileId") REFERENCES "TwitchMediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TwitchJobEvent" ADD CONSTRAINT "TwitchJobEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "TwitchJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TwitchMediaFile" ADD CONSTRAINT "TwitchMediaFile_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "TwitchVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "TwitchSettings" ADD COLUMN     "extractorFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "toolCheckedAt" TIMESTAMP(3),
ADD COLUMN     "toolLatest" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "toolsPausedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TwitchVideo" ADD COLUMN     "category" TEXT,
ADD COLUMN     "chapters" JSONB;

-- AlterTable
ALTER TABLE "TwitchJob" ADD COLUMN     "etaSeconds" INTEGER,
ADD COLUMN     "speedBps" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "TwitchUserLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "twitchUserId" TEXT,
    "login" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "deviceCode" TEXT,
    "deviceExpires" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TwitchUserLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TwitchUserLink_userId_key" ON "TwitchUserLink"("userId");

-- AddForeignKey
ALTER TABLE "TwitchUserLink" ADD CONSTRAINT "TwitchUserLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
