-- CreateEnum
CREATE TYPE "TwitchDeletionKind" AS ENUM ('FILE', 'ORIGINAL');

-- CreateEnum
CREATE TYPE "TwitchDeletionCause" AS ENUM ('PERSON', 'RULE', 'KEEP_PERIOD', 'OUTSIDE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TwitchJobKind" ADD VALUE 'DELETE_ORIGINAL';
ALTER TYPE "TwitchJobKind" ADD VALUE 'RESTORE_ORIGINAL';

-- AlterTable
ALTER TABLE "TwitchMediaFile" ADD COLUMN     "originalDeletedAt" TIMESTAMP(3),
ADD COLUMN     "originalSizeBytes" BIGINT,
ADD COLUMN     "originalVideoCodec" TEXT,
ADD COLUMN     "reencodeQuality" INTEGER,
ADD COLUMN     "reencodeSkippedAt" TIMESTAMP(3),
ADD COLUMN     "reencodeSkippedBytes" BIGINT;

-- CreateTable
CREATE TABLE "TwitchDeletedFile" (
    "id" TEXT NOT NULL,
    "videoId" TEXT,
    "title" TEXT NOT NULL,
    "streamer" TEXT NOT NULL,
    "kind" "TwitchDeletionKind" NOT NULL,
    "cause" "TwitchDeletionCause" NOT NULL,
    "detail" TEXT,
    "freedBytes" BIGINT NOT NULL,
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TwitchDeletedFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TwitchDeletedFile_createdAt_idx" ON "TwitchDeletedFile"("createdAt");

-- CreateIndex
CREATE INDEX "TwitchDeletedFile_videoId_idx" ON "TwitchDeletedFile"("videoId");

-- AddForeignKey
ALTER TABLE "TwitchDeletedFile" ADD CONSTRAINT "TwitchDeletedFile_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "TwitchVideo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
