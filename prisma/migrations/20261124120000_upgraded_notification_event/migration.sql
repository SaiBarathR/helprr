-- "Upgraded" splits Sonarr/Radarr upgrades out of "Imported". Until now an
-- upgrade reached every device and channel that took "Imported", so each one
-- starts with the choice it made there (on or off, and its quality and tag
-- filters): nobody loses these alerts, and nobody who turned imports off starts
-- getting them. A device added later gets "Upgraded" on, like other events.
INSERT INTO "NotificationPreference" ("id", "subscriptionId", "eventType", "enabled", "tagFilter", "qualityFilter", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, p."subscriptionId", 'upgraded', p."enabled", p."tagFilter", p."qualityFilter", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "NotificationPreference" p
WHERE p."eventType" = 'imported'
ON CONFLICT ("subscriptionId", "eventType") DO NOTHING;

UPDATE "NotificationChannel"
SET "events" = array_append("events", 'upgraded')
WHERE 'imported' = ANY("events") AND NOT ('upgraded' = ANY("events"));
