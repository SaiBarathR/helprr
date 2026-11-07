-- "What's new" records the running version silently on a user's first visit, so
-- people who used Helprr before it existed would never see a release's notes.
-- Mark every existing user (not an invite nobody has accepted yet) as having
-- seen 1.14.0, so the next release shows its notes once. Users created after
-- this migration are unaffected.
UPDATE "UserSettings" AS s
SET "lastSeenVersion" = '1.14.0', "updatedAt" = CURRENT_TIMESTAMP
FROM "User" AS u
WHERE s."userId" = u."id" AND s."lastSeenVersion" IS NULL AND u."status" <> 'pending';

INSERT INTO "UserSettings" ("id", "userId", "lastSeenVersion", "updatedAt")
SELECT gen_random_uuid()::text, u."id", '1.14.0', CURRENT_TIMESTAMP
FROM "User" AS u
WHERE u."status" <> 'pending'
  AND NOT EXISTS (SELECT 1 FROM "UserSettings" AS s WHERE s."userId" = u."id");
