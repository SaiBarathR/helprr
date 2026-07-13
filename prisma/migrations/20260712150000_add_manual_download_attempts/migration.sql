CREATE TABLE "ManualDownloadAttempt" (
    "id" TEXT NOT NULL,
    "mappingId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "scanPath" TEXT,
    "commandId" INTEGER,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "ManualDownloadAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ManualDownloadAttempt_mappingId_startedAt_idx" ON "ManualDownloadAttempt"("mappingId", "startedAt");
ALTER TABLE "ManualDownloadAttempt" ADD CONSTRAINT "ManualDownloadAttempt_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "ManualDownloadMapping"("id") ON DELETE CASCADE ON UPDATE CASCADE;
