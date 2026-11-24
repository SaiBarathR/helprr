-- "Health Restored" arrived without a starting choice, and a device with no
-- row for an event takes it, so devices that turned "Health Warning" off were
-- told each warning had cleared. Each device and channel now starts with the
-- choice it made for "Health Warning" (on or off, and its filters), as
-- "Upgraded" did from "Imported". A device added later gets it on.

-- Opening the notification settings, or subscribing again, has already given
-- some devices a "Health Restored" row: on, and never changed since it was
-- written (createdAt = updatedAt). That row is the default, not a choice, so
-- it takes the warning's choice too. A row turned off, or changed in any way,
-- was set by its owner and stays. Like the rows copied below, it keeps
-- createdAt = updatedAt: the migration chose it, not its owner.
UPDATE "NotificationPreference" r
SET "enabled" = w."enabled", "tagFilter" = w."tagFilter", "qualityFilter" = w."qualityFilter"
FROM "NotificationPreference" w
WHERE r."eventType" = 'healthRestored' AND r."enabled" AND r."createdAt" = r."updatedAt"
  AND w."subscriptionId" = r."subscriptionId" AND w."eventType" = 'healthWarning';

INSERT INTO "NotificationPreference" ("id", "subscriptionId", "eventType", "enabled", "tagFilter", "qualityFilter", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, p."subscriptionId", 'healthRestored', p."enabled", p."tagFilter", p."qualityFilter", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "NotificationPreference" p
WHERE p."eventType" = 'healthWarning'
ON CONFLICT ("subscriptionId", "eventType") DO NOTHING;

UPDATE "NotificationChannel"
SET "events" = array_append("events", 'healthRestored')
WHERE 'healthWarning' = ANY("events") AND NOT ('healthRestored' = ANY("events"));
