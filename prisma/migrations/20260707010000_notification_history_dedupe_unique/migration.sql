/*
  Warnings:

  - A unique constraint covering the columns `[eventType,dedupeKey]` on the table `NotificationHistory` will be added. If there are existing duplicate values, this will fail.

*/
-- Existing databases may hold duplicate (eventType, dedupeKey) rows from the
-- pre-constraint race window; keep the newest row per key so the unique index
-- below can build. NULL dedupeKeys are distinct in Postgres and untouched.
DELETE FROM "NotificationHistory" a
USING "NotificationHistory" b
WHERE a."eventType" = b."eventType"
  AND a."dedupeKey" = b."dedupeKey"
  AND a."dedupeKey" IS NOT NULL
  AND (a."createdAt" < b."createdAt" OR (a."createdAt" = b."createdAt" AND a."id" < b."id"));

-- DropIndex
DROP INDEX "NotificationHistory_eventType_dedupeKey_idx";

-- CreateIndex
CREATE UNIQUE INDEX "NotificationHistory_eventType_dedupeKey_key" ON "NotificationHistory"("eventType", "dedupeKey");
