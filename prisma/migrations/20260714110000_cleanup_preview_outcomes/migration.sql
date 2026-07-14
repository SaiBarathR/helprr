ALTER TABLE "CleanupHistory"
ADD COLUMN "previewId" TEXT,
ADD COLUMN "outcomeStatus" TEXT,
ADD COLUMN "outcomeDetails" JSONB;

CREATE INDEX "CleanupHistory_previewId_idx" ON "CleanupHistory"("previewId");
