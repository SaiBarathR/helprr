-- Several named feed links per user. The existing link (at most one per user)
-- becomes one named "Calendar"; its URL keeps its own ?type=&instance=&monitored=,
-- and its stored filters stay empty, so it shows exactly what it showed before.

-- DropIndex
DROP INDEX "CalendarFeedToken_userId_key";

-- AlterTable
ALTER TABLE "CalendarFeedToken" ADD COLUMN     "instanceId" TEXT,
ADD COLUMN     "monitoredOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "name" TEXT NOT NULL DEFAULT 'Calendar',
ADD COLUMN     "type" TEXT;

ALTER TABLE "CalendarFeedToken" ALTER COLUMN "name" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "CalendarFeedToken_userId_idx" ON "CalendarFeedToken"("userId");
