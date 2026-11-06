-- The release whose "What's new" each user last saw or dismissed (null until their first visit).
ALTER TABLE "UserSettings" ADD COLUMN     "lastSeenVersion" TEXT;
