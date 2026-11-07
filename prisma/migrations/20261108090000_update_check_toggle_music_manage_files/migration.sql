-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "updateCheckEnabled" BOOLEAN NOT NULL DEFAULT true;

-- music.manageFiles is new: Lidarr rename/Organize moved to it from music.delete.
-- A user with an override for music.delete gets the same one for
-- music.manageFiles, so nobody gains or loses rename on upgrade.
UPDATE "User"
SET "permissions" = "permissions" || jsonb_build_object('music.manageFiles', "permissions"->'music.delete')
WHERE jsonb_typeof("permissions") = 'object'
  AND jsonb_typeof("permissions"->'music.delete') = 'boolean'
  AND NOT ("permissions" ? 'music.manageFiles');
