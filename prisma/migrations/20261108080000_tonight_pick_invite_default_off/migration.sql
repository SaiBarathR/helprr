-- Tonight pick invites are off by default (owner, 2026-11-07). Push devices
-- were seeded with every event on; a row nobody changed still has
-- "updatedAt" = "createdAt" (Prisma stamps both with one time on create), so
-- only those turn off. A device whose owner saved the event keeps that choice.
UPDATE "NotificationPreference"
SET "enabled" = false
WHERE "eventType" = 'tonightPickInvite'
  AND "enabled" = true
  AND "updatedAt" = "createdAt";
