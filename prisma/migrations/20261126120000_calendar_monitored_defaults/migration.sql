-- The Calendar page's "Monitored only" default, per user (off = show all, as before).
ALTER TABLE "UserSettings" ADD COLUMN "calendarMonitoredOnly" BOOLEAN NOT NULL DEFAULT false;

-- The iCal feed now fetches unmonitored items and honours each link's own
-- "Monitored only" switch. Until now every link served monitored items only,
-- whatever the switch said, so existing links keep exactly that.
UPDATE "CalendarFeedToken" SET "monitoredOnly" = true;
