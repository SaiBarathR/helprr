-- Keep the frequent unread badge counts and ordered unread lists on the small
-- unread subset. Prisma Migrate applies this migration transactionally, so
-- PostgreSQL's non-transactional CREATE INDEX CONCURRENTLY cannot be used.
CREATE INDEX "NotificationHistory_unread_createdAt_idx"
ON "NotificationHistory" ("createdAt" DESC)
WHERE "read" = false;

CREATE INDEX "NotificationHistory_userId_unread_createdAt_idx"
ON "NotificationHistory" ("userId", "createdAt" DESC)
WHERE "read" = false;
