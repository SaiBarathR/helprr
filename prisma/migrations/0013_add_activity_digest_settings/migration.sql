ALTER TABLE "AppSettings"
ADD COLUMN IF NOT EXISTS "activityDigestMode" TEXT NOT NULL DEFAULT 'off',
ADD COLUMN IF NOT EXISTS "activityDigestHour" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN IF NOT EXISTS "activityDigestDayOfWeek" INTEGER NOT NULL DEFAULT 1;

-- Backfill: ensure every existing PushSubscription has a preference row for
-- the new activityDigest event type. Default enabled=true so the toggle in
-- the settings UI reflects the natural opt-out model (the digest itself
-- stays gated by activityDigestMode='off' until the user enables it).
INSERT INTO "NotificationPreference" (
  "id",
  "subscriptionId",
  "eventType",
  "enabled",
  "createdAt",
  "updatedAt"
)
SELECT
  'pref-activity-digest-' || s."id" AS "id",
  s."id" AS "subscriptionId",
  'activityDigest' AS "eventType",
  true AS "enabled",
  CURRENT_TIMESTAMP AS "createdAt",
  CURRENT_TIMESTAMP AS "updatedAt"
FROM "PushSubscription" s
ON CONFLICT ("subscriptionId", "eventType") DO NOTHING;
