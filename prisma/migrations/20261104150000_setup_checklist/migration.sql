-- The dashboard setup checklist: when an admin hid it, and the steps they marked done
-- that the server cannot see for itself (installed on a phone, exported a backup).
ALTER TABLE "UserSettings" ADD COLUMN "setupChecklistDismissedAt" TIMESTAMP(3);
ALTER TABLE "UserSettings" ADD COLUMN "setupStepsDone" TEXT[] DEFAULT ARRAY[]::TEXT[];
