-- AlterEnum
ALTER TYPE "CleanupAction" ADD VALUE 'removedFromLibrary';

-- AlterEnum
ALTER TYPE "FileOperation" ADD VALUE 'KEEP_MEDIA';

-- CreateTable
CREATE TABLE "LibraryCleanupConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "keepTag" TEXT NOT NULL DEFAULT 'keep',
    "countdownDays" INTEGER NOT NULL DEFAULT 14,
    "notifyOnMark" BOOLEAN NOT NULL DEFAULT true,
    "importListExclusion" BOOLEAN NOT NULL DEFAULT false,
    "movieRule" JSONB,
    "seriesRule" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryCleanupConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeavingSoonItem" (
    "id" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "service" "ServiceType" NOT NULL,
    "instanceId" TEXT NOT NULL,
    "arrId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "year" INTEGER,
    "tmdbId" INTEGER,
    "tvdbId" INTEGER,
    "imdbId" TEXT,
    "posterUrl" TEXT,
    "sizeBytes" BIGINT NOT NULL,
    "lastWatchedAt" TIMESTAMP(3),
    "reasons" JSONB NOT NULL,
    "requestedBy" JSONB NOT NULL,
    "markedByUserId" TEXT,
    "markedByUsername" TEXT NOT NULL,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleteAfter" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeavingSoonItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeavingSoonItem_deleteAfter_idx" ON "LeavingSoonItem"("deleteAfter");

-- CreateIndex
CREATE UNIQUE INDEX "LeavingSoonItem_service_instanceId_arrId_key" ON "LeavingSoonItem"("service", "instanceId", "arrId");

