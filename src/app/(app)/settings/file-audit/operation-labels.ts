import type { FileOperation } from '@prisma/client';
import { parentPath } from '@/lib/paths';

// Keyed on the Prisma enum so a new operation can't ship without a badge (the
// type check and operation-labels.test.ts both fail on a missing key).
export const OP_VARIANT: Record<FileOperation, 'default' | 'secondary' | 'destructive'> = {
  EDIT: 'secondary',
  IMPORT: 'default',
  DELETE: 'destructive',
  DELETE_MEDIA: 'destructive',
  DELETE_TORRENT: 'destructive',
  REMOVE_QUEUE: 'destructive',
  CREATE_MEDIA: 'default',
  PUSH_RELEASE: 'default',
  REMOVE_BLOCKLIST: 'secondary',
  MOVE_MEDIA: 'default',
  MARK_FAILED: 'destructive',
  KEEP_MEDIA: 'secondary',
};

export const OP_LABEL: Record<FileOperation, string> = {
  EDIT: 'EDIT',
  IMPORT: 'IMPORT',
  DELETE: 'FILE DELETE',
  DELETE_MEDIA: 'MEDIA DELETE',
  DELETE_TORRENT: 'TORRENT DELETE',
  REMOVE_QUEUE: 'QUEUE REMOVE',
  CREATE_MEDIA: 'MEDIA ADD',
  PUSH_RELEASE: 'RELEASE SENT',
  REMOVE_BLOCKLIST: 'BLOCKLIST REMOVE',
  MOVE_MEDIA: 'ROOT FOLDER',
  MARK_FAILED: 'MARKED FAILED',
  KEEP_MEDIA: 'KEEP',
};

export function countLabel(record: { operation: FileOperation; fileCount: number; mediaType: string }): string {
  const count = record.fileCount;
  if (record.operation === 'DELETE_MEDIA' || record.operation === 'MOVE_MEDIA' || record.operation === 'KEEP_MEDIA' || record.operation === 'CREATE_MEDIA') {
    const noun = record.mediaType === 'series' ? 'series' : record.mediaType;
    return `${count} ${noun}${count === 1 || noun === 'series' ? '' : 's'}`;
  }
  if (record.operation === 'DELETE_TORRENT') return `${count} torrent${count === 1 ? '' : 's'}`;
  if (record.operation === 'REMOVE_QUEUE') return `${count} queue item${count === 1 ? '' : 's'}`;
  if (record.operation === 'REMOVE_BLOCKLIST') return `${count} blocklist entr${count === 1 ? 'y' : 'ies'}`;
  if (record.operation === 'MARK_FAILED') return `${count} download${count === 1 ? '' : 's'}`;
  if (record.operation === 'PUSH_RELEASE') return `${count} release${count === 1 ? '' : 's'}`;
  return `${count} file${count === 1 ? '' : 's'}`;
}

/**
 * The paths a MOVE_MEDIA row shows. A title's own Edit records its old and new folder
 * (`fromPath`, `path`): that move shows old → new, badged as a rename when it stays in its
 * root folder. A bulk root-folder change records only the new root and keeps "→ root".
 */
export function moveMediaPaths(
  record: { operation: FileOperation; details: Record<string, unknown> | null },
): { label: string; from: string | null; to: string } | null {
  if (record.operation !== 'MOVE_MEDIA' || !record.details) return null;
  const { fromPath, path, rootFolderPath } = record.details;
  if (typeof fromPath === 'string' && typeof path === 'string') {
    return { label: parentPath(fromPath) === parentPath(path) ? 'FOLDER RENAME' : OP_LABEL.MOVE_MEDIA, from: fromPath, to: path };
  }
  return typeof rootFolderPath === 'string' ? { label: OP_LABEL.MOVE_MEDIA, from: null, to: rootFolderPath } : null;
}
