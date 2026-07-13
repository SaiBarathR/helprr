-- Preserve the original manual-download migration exactly as first deployed.
-- This forward migration upgrades legacy qBittorrent-managed mappings to the
-- newer Arr-owned model without discarding their history.

ALTER TABLE "ManualDownloadMapping"
ADD COLUMN "mode" "ManualDownloadMode",
ADD COLUMN "requestKey" TEXT,
ADD COLUMN "externalId" INTEGER,
ADD COLUMN "arrDownloadId" TEXT,
ADD COLUMN "arrQueueId" INTEGER,
ADD COLUMN "initialFileIds" JSONB;

-- Rows created by the previous workflow are completed qBittorrent-reviewed
-- mappings. Stable synthetic values retain them as history while keeping new
-- Arr-managed request keys and external IDs semantically separate.
UPDATE "ManualDownloadMapping"
SET
    "mode" = 'QBIT_REVIEWED',
    "requestKey" = 'legacy:' || "id",
    "externalId" = 0;

ALTER TABLE "ManualDownloadMapping"
ALTER COLUMN "mode" SET DEFAULT 'ARR_MANAGED',
ALTER COLUMN "mode" SET NOT NULL,
ALTER COLUMN "requestKey" SET NOT NULL,
ALTER COLUMN "externalId" SET NOT NULL,
ALTER COLUMN "torrentHash" DROP NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'PREFLIGHT';

DROP INDEX "ManualDownloadMapping_torrentHash_key";

CREATE UNIQUE INDEX "ManualDownloadMapping_requestKey_key" ON "ManualDownloadMapping"("requestKey");
CREATE INDEX "ManualDownloadMapping_arrDownloadId_idx" ON "ManualDownloadMapping"("arrDownloadId");
CREATE INDEX "ManualDownloadMapping_torrentHash_idx" ON "ManualDownloadMapping"("torrentHash");
