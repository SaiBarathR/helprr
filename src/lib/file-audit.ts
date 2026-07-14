import { Prisma, type FileOperation, type ServiceType } from '@prisma/client';
import type { User } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { QBittorrentClient } from '@/lib/qbittorrent-client';

// ─────────────────────────────────────────────────────────────────────────────
// Unified accountability trail for file operations and destructive media,
// torrent, and queue operations.
//
// These operations touch the user's own media on disk and are largely
// irreversible, so EVERY attempt — success or failure — gets a FileOperationAudit
// row stamped with the acting user. recordFileAudit() is fire-and-await but
// FAIL-SOFT: a failed audit write must never turn a completed (or failed) file
// operation into a 500. The op already happened; the worst case is a missing log
// line, which we surface via console.error rather than propagating.
// ─────────────────────────────────────────────────────────────────────────────

export interface FileAuditInput {
  /** Acting user; pass the resolved User from requireUser()/getCurrentUser(). */
  user: Pick<User, 'id' | 'username'> | null;
  service: Extract<ServiceType, 'SONARR' | 'RADARR' | 'LIDARR'>;
  /** ServiceConnection instance the op ran against (undefined = default). */
  instanceId?: string | null;
  operation: FileOperation;
  mediaType: 'series' | 'movie' | 'artist';
  /** Sonarr seriesId / Radarr movieId / Lidarr artistId. */
  mediaId: number;
  mediaTitle: string;
  /** Number of files targeted by the operation. */
  fileCount: number;
  /**
   * Free-form context: file paths, field deltas, recycleBinConfigured,
   * importMode, command id, per-file results. Kept loose so callers can record
   * whatever makes the action reconstructable later.
   */
  details?: Record<string, unknown> | null;
  success: boolean;
  errorMessage?: string | null;
}

export interface OperationAuditInput {
  user: Pick<User, 'id' | 'username'> | null;
  service: Extract<ServiceType, 'SONARR' | 'RADARR' | 'LIDARR' | 'QBITTORRENT'>;
  instanceId?: string | null;
  operation: FileOperation;
  targetType: 'series' | 'movie' | 'artist' | 'album' | 'torrent' | 'queue';
  /** Numeric upstream target id. Torrent hashes are recorded in details instead. */
  targetId?: number | null;
  targetTitle: string;
  /** Number of media items, files, torrents, or queue entries targeted. */
  itemCount: number;
  filesDeleted?: boolean | null;
  details?: Record<string, unknown> | null;
  success: boolean;
  errorMessage?: string | null;
}

export async function recordOperationAudit(input: OperationAuditInput): Promise<void> {
  try {
    await prisma.fileOperationAudit.create({
      data: {
        userId: input.user?.id ?? null,
        username: input.user?.username ?? 'unknown',
        service: input.service,
        instanceId: input.instanceId ?? null,
        operation: input.operation,
        mediaType: input.targetType,
        mediaId: input.targetId ?? null,
        mediaTitle: input.targetTitle,
        fileCount: input.itemCount,
        filesDeleted: input.filesDeleted ?? null,
        details:
          input.details == null
            ? Prisma.JsonNull
            : (input.details as Prisma.InputJsonValue),
        success: input.success,
        errorMessage: input.errorMessage ?? null,
      },
    });
  } catch (err) {
    // Never let an audit failure mask the real operation result.
    console.error('[FileAudit] Failed to write audit row:', err);
  }
}

/** Preserve the ownership-validated Manage Files API while writing to the unified model. */
export async function recordFileAudit(input: FileAuditInput): Promise<void> {
  await recordOperationAudit({
    user: input.user,
    service: input.service,
    instanceId: input.instanceId,
    operation: input.operation,
    targetType: input.mediaType,
    targetId: input.mediaId,
    targetTitle: input.mediaTitle,
    itemCount: input.fileCount,
    filesDeleted: input.operation === 'DELETE' ? true : null,
    details: input.details,
    success: input.success,
    errorMessage: input.errorMessage,
  });
}

/**
 * Run one validated upstream mutation and persist its truthful result. Audit writes
 * remain fail-soft so a logging outage never masks the real upstream response.
 */
export async function runWithOperationAudit<T>(
  input: Omit<OperationAuditInput, 'success' | 'errorMessage'>,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    const result = await operation();
    await recordOperationAudit({ ...input, success: true });
    return result;
  } catch (error) {
    await recordOperationAudit({
      ...input,
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Upstream operation failed',
    });
    throw error;
  }
}

export interface TorrentDeleteAuditSnapshot {
  targetTitle: string;
  itemCount: number;
  details: Record<string, unknown>;
}

/** Best-effort labels and immutable identifiers for single or qBittorrent-style bulk hashes. */
export async function snapshotTorrentDeleteTargets(
  client: QBittorrentClient,
  rawHashes: string,
): Promise<TorrentDeleteAuditSnapshot> {
  const hashes = [...new Set(rawHashes.split('|').map((hash) => hash.trim()).filter(Boolean))];
  let torrents: Awaited<ReturnType<QBittorrentClient['getTorrents']>> = [];
  try {
    torrents = await client.getTorrents(undefined, undefined, undefined, undefined, hashes.join('|'));
  } catch {
    // Snapshot enrichment must not change whether an already-authorized deletion runs.
  }

  const targets = torrents.map((torrent) => ({
    hash: torrent.hash,
    name: torrent.name,
    size: torrent.size,
    progress: torrent.progress,
  }));
  const itemCount = hashes.length || 1;
  return {
    targetTitle: targets.length === 1
      ? targets[0].name
      : `${itemCount} ${itemCount === 1 ? 'torrent' : 'torrents'}`,
    itemCount,
    details: { hashes, targets },
  };
}
