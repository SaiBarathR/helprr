-- AlterTable
ALTER TABLE "PollingState" ADD COLUMN "lastHistorySeenIds" JSONB NOT NULL DEFAULT '[]';
