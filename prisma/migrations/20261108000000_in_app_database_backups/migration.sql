-- In-app database backups: schedule, retention and alert settings, and two audit actions. Additive only.
-- AlterEnum
ALTER TYPE "SecurityAuditAction" ADD VALUE 'DATABASE_BACKUP_CREATED';
ALTER TYPE "SecurityAuditAction" ADD VALUE 'DATABASE_BACKUP_FAILED';

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "databaseBackupAlertDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "databaseBackupAlertedAt" TIMESTAMP(3),
ADD COLUMN     "databaseBackupDayOfWeek" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "databaseBackupHour" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "databaseBackupKeep" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "databaseBackupSchedule" TEXT NOT NULL DEFAULT 'off',
ADD COLUMN     "databaseBackupScheduledAt" TIMESTAMP(3);
