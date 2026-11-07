-- When scripts/backup.sh last made and validated a dump; shown in Settings. Additive only.
-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN "lastDatabaseBackupAt" TIMESTAMP(3);
