-- Who ran a cleanup cycle, and which API request ran an audited operation and
-- when its upstream call started. Nullable columns only: legacy rows keep null.
-- AlterTable
ALTER TABLE "CleanupHistory" ADD COLUMN     "actorUserId" TEXT,
ADD COLUMN     "actorUsername" TEXT;

-- AlterTable
ALTER TABLE "FileOperationAudit" ADD COLUMN     "requestId" TEXT,
ADD COLUMN     "startedAt" TIMESTAMP(3);
