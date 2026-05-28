-- Add a stable dedupeKey to NotificationHistory so the upcoming-release poller
-- can suppress duplicate fires by item ID + air date instead of matching the
-- (mutable) body string. Index covers the `(eventType, dedupeKey)` lookup
-- pattern used in checkUpcoming().
ALTER TABLE "NotificationHistory"
  ADD COLUMN "dedupeKey" TEXT;

CREATE INDEX "NotificationHistory_eventType_dedupeKey_idx"
  ON "NotificationHistory" ("eventType", "dedupeKey");

-- Drop the now-unused upcoming alert window setting. It was only meaningful
-- for the removed "once_in_window" timing mode; "before_air" uses
-- upcomingNotifyBeforeMins as its sole gate and "daily_digest" is bounded by
-- the local calendar day.
ALTER TABLE "AppSettings"
  DROP COLUMN "upcomingAlertHours";

-- Migrate any stragglers from the removed "once_in_window" timing mode to
-- "before_air" so they still receive notifications under the new schema.
UPDATE "AppSettings"
  SET "upcomingNotifyMode" = 'before_air'
  WHERE "upcomingNotifyMode" = 'once_in_window';
