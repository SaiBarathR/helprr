-- AlterTable
ALTER TABLE "QueueCleanerConfig" ADD COLUMN     "includeLidarr" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "includeRadarr" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "includeSonarr" BOOLEAN NOT NULL DEFAULT true;
