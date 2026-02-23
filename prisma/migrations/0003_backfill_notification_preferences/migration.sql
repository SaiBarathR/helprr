INSERT INTO "NotificationPreference" (
  "id",
  "subscriptionId",
  "eventType",
  "enabled",
  "createdAt",
  "updatedAt"
)
SELECT
  'pref-backfill-' || s."id" || '-' || e."eventType" AS "id",
  s."id" AS "subscriptionId",
  e."eventType",
  true AS "enabled",
  CURRENT_TIMESTAMP AS "createdAt",
  CURRENT_TIMESTAMP AS "updatedAt"
FROM "PushSubscription" s
CROSS JOIN (
  VALUES
    ('grabbed'),
    ('imported'),
    ('downloadFailed'),
    ('importFailed'),
    ('upcomingPremiere'),
    ('healthWarning'),
    ('torrentAdded'),
    ('torrentCompleted'),
    ('torrentDeleted'),
    ('jellyfinItemAdded'),
    ('jellyfinPlaybackStart')
) AS e("eventType")
ON CONFLICT ("subscriptionId", "eventType") DO NOTHING;
