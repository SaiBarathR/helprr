-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "watchingEpisodeDays" INTEGER NOT NULL DEFAULT 14;

-- CreateTable
CREATE TABLE "AnnouncedEpisode" (
    "userId" TEXT NOT NULL,
    "episodeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncedEpisode_pkey" PRIMARY KEY ("userId","episodeKey")
);

-- AddForeignKey
ALTER TABLE "AnnouncedEpisode" ADD CONSTRAINT "AnnouncedEpisode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
