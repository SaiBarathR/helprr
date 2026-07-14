-- Extend the released file-operation audit in place so existing rows remain
-- readable while whole-media, torrent, and queue removals share the same trail.
ALTER TYPE "FileOperation" ADD VALUE IF NOT EXISTS 'DELETE_MEDIA';
ALTER TYPE "FileOperation" ADD VALUE IF NOT EXISTS 'DELETE_TORRENT';
ALTER TYPE "FileOperation" ADD VALUE IF NOT EXISTS 'REMOVE_QUEUE';

ALTER TABLE "FileOperationAudit"
  ALTER COLUMN "mediaId" DROP NOT NULL,
  ADD COLUMN "filesDeleted" BOOLEAN;
