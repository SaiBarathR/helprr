-- Audit value for changing the root folder of library items (bulk editor),
-- optionally moving their files. Additive only.
-- AlterEnum
ALTER TYPE "FileOperation" ADD VALUE 'MOVE_MEDIA';
