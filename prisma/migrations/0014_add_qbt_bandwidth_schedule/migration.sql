ALTER TABLE "AppSettings"
ADD COLUMN IF NOT EXISTS "qbtBandwidthSchedule" JSONB;
