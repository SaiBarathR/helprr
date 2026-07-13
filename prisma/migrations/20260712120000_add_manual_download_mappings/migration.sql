CREATE TYPE "ManualDownloadStatus" AS ENUM ('PREFLIGHT', 'CREATING_MEDIA', 'SUBMITTING_RELEASE', 'QUEUED', 'DOWNLOADING', 'IMPORT_PENDING', 'READY_TO_IMPORT', 'IMPORTING', 'IMPORTED', 'NEEDS_MAPPING', 'BLOCKED', 'IMPORT_BLOCKED', 'FAILED', 'CANCELLED');
CREATE TYPE "ManualDownloadMode" AS ENUM ('ARR_MANAGED', 'QBIT_REVIEWED');

CREATE TABLE "ManualDownloadMapping" (
    "id" TEXT NOT NULL,
    "mode" "ManualDownloadMode" NOT NULL DEFAULT 'ARR_MANAGED',
    "requestKey" TEXT NOT NULL,
    "torrentHash" TEXT,
    "torrentName" TEXT NOT NULL,
    "service" "ServiceType" NOT NULL,
    "instanceId" TEXT NOT NULL,
    "arrItemId" INTEGER NOT NULL,
    "arrTitle" TEXT NOT NULL,
    "externalId" INTEGER NOT NULL,
    "status" "ManualDownloadStatus" NOT NULL DEFAULT 'PREFLIGHT',
    "arrDownloadId" TEXT,
    "arrQueueId" INTEGER,
    "initialFileIds" JSONB,
    "selectedFileIds" JSONB,
    "importCommandId" INTEGER,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdByUserId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManualDownloadMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManualDownloadMapping_requestKey_key" ON "ManualDownloadMapping"("requestKey");
CREATE INDEX "ManualDownloadMapping_status_updatedAt_idx" ON "ManualDownloadMapping"("status", "updatedAt");
CREATE INDEX "ManualDownloadMapping_arrDownloadId_idx" ON "ManualDownloadMapping"("arrDownloadId");
CREATE INDEX "ManualDownloadMapping_torrentHash_idx" ON "ManualDownloadMapping"("torrentHash");
CREATE INDEX "ManualDownloadMapping_instanceId_arrItemId_idx" ON "ManualDownloadMapping"("instanceId", "arrItemId");
ALTER TABLE "ManualDownloadMapping" ADD CONSTRAINT "ManualDownloadMapping_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "ServiceConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
