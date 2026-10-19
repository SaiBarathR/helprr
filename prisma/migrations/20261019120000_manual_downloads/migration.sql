-- Manual downloads: a hand-supplied magnet or .torrent linked to a Sonarr/Radarr
-- title, with its transition events, and audit values for adding a title and
-- pushing a release. Additive only.
-- CreateEnum
CREATE TYPE "ManualDownloadMode" AS ENUM ('ARR_MANAGED', 'QBIT_REVIEWED');

-- CreateEnum
CREATE TYPE "ManualDownloadStatus" AS ENUM ('PREFLIGHT', 'CREATING_MEDIA', 'SUBMITTING_RELEASE', 'QUEUED', 'DOWNLOADING', 'IMPORT_PENDING', 'IMPORTING', 'IMPORTED', 'NEEDS_MAPPING', 'BLOCKED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ManualDownloadSource" AS ENUM ('MAGNET', 'TORRENT_FILE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FileOperation" ADD VALUE 'CREATE_MEDIA';
ALTER TYPE "FileOperation" ADD VALUE 'PUSH_RELEASE';

-- CreateTable
CREATE TABLE "ManualDownload" (
    "id" TEXT NOT NULL,
    "mode" "ManualDownloadMode" NOT NULL,
    "status" "ManualDownloadStatus" NOT NULL,
    "service" "ServiceType" NOT NULL,
    "instanceId" TEXT,
    "instanceLabel" TEXT NOT NULL,
    "externalId" INTEGER NOT NULL,
    "arrItemId" INTEGER,
    "arrItemTitle" TEXT NOT NULL,
    "createdArrItem" BOOLEAN NOT NULL DEFAULT false,
    "targetEpisodeIds" INTEGER[],
    "releaseTitle" TEXT NOT NULL,
    "source" "ManualDownloadSource" NOT NULL,
    "infoHash" TEXT NOT NULL,
    "torrentName" TEXT NOT NULL,
    "downloadClientId" INTEGER,
    "downloadClientName" TEXT,
    "arrQueueId" INTEGER,
    "baselineFileIds" JSONB NOT NULL,
    "importedFileIds" JSONB,
    "lastError" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "clientRequestId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdByUsername" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ManualDownload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualDownloadEvent" (
    "id" TEXT NOT NULL,
    "downloadId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ManualDownloadStatus" NOT NULL,
    "message" TEXT,
    "details" JSONB,

    CONSTRAINT "ManualDownloadEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManualDownload_status_updatedAt_idx" ON "ManualDownload"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "ManualDownload_instanceId_infoHash_idx" ON "ManualDownload"("instanceId", "infoHash");

-- CreateIndex
CREATE UNIQUE INDEX "ManualDownload_createdByUserId_clientRequestId_key" ON "ManualDownload"("createdByUserId", "clientRequestId");

-- CreateIndex
CREATE INDEX "ManualDownloadEvent_downloadId_at_idx" ON "ManualDownloadEvent"("downloadId", "at");

-- AddForeignKey
ALTER TABLE "ManualDownload" ADD CONSTRAINT "ManualDownload_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "ServiceConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualDownloadEvent" ADD CONSTRAINT "ManualDownloadEvent_downloadId_fkey" FOREIGN KEY ("downloadId") REFERENCES "ManualDownload"("id") ON DELETE CASCADE ON UPDATE CASCADE;
