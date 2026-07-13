CREATE TYPE "ManualDownloadStatus" AS ENUM ('DOWNLOADING', 'READY_TO_IMPORT', 'IMPORTING', 'IMPORTED', 'IMPORT_BLOCKED', 'FAILED', 'CANCELLED');

CREATE TABLE "ManualDownloadMapping" (
    "id" TEXT NOT NULL,
    "torrentHash" TEXT NOT NULL,
    "torrentName" TEXT NOT NULL,
    "service" "ServiceType" NOT NULL,
    "instanceId" TEXT NOT NULL,
    "arrItemId" INTEGER NOT NULL,
    "arrTitle" TEXT NOT NULL,
    "status" "ManualDownloadStatus" NOT NULL DEFAULT 'DOWNLOADING',
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

CREATE UNIQUE INDEX "ManualDownloadMapping_torrentHash_key" ON "ManualDownloadMapping"("torrentHash");
CREATE INDEX "ManualDownloadMapping_status_updatedAt_idx" ON "ManualDownloadMapping"("status", "updatedAt");
CREATE INDEX "ManualDownloadMapping_instanceId_arrItemId_idx" ON "ManualDownloadMapping"("instanceId", "arrItemId");
ALTER TABLE "ManualDownloadMapping" ADD CONSTRAINT "ManualDownloadMapping_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "ServiceConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
