-- Audit value for removing (unblocking) Arr blocklist entries. Additive only.
-- AlterEnum
ALTER TYPE "FileOperation" ADD VALUE 'REMOVE_BLOCKLIST';
