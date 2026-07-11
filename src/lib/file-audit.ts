import { Prisma, type FileOperation, type ServiceType } from '@prisma/client';
import type { User } from '@prisma/client';
import { prisma } from '@/lib/db';

// ─────────────────────────────────────────────────────────────────────────────
// Accountability trail for Manage Episodes / Manage Files.
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

export async function recordFileAudit(input: FileAuditInput): Promise<void> {
  try {
    await prisma.fileOperationAudit.create({
      data: {
        userId: input.user?.id ?? null,
        username: input.user?.username ?? 'unknown',
        service: input.service,
        instanceId: input.instanceId ?? null,
        operation: input.operation,
        mediaType: input.mediaType,
        mediaId: input.mediaId,
        mediaTitle: input.mediaTitle,
        fileCount: input.fileCount,
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
