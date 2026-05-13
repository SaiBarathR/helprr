-- Add a master "logEnabled" switch so operators can disable all log writes
-- (logger.writeLog and the api-logger middleware) from a single setting,
-- instead of toggling each finer-grained flag individually. Existing rows
-- default to true so behavior is unchanged on upgrade.
ALTER TABLE "AppSettings"
  ADD COLUMN "logEnabled" BOOLEAN NOT NULL DEFAULT true;
