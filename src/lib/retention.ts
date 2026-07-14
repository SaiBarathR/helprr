import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  pruneOrphanImageCache,
  type ImageCacheRetentionResult,
} from '@/lib/cache/image-cache-retention';
import { SESSION_DURATION_SECONDS } from '@/lib/session-policy';

const DAY_MS = 24 * 60 * 60 * 1000;

export const CLEANUP_HISTORY_RETENTION_DAYS = 90;
export const FILE_OPERATION_AUDIT_RETENTION_DAYS = 365;

type RetentionDatabase = Pick<
  PrismaClient,
  | 'notificationHistory'
  | 'cleanupHistory'
  | 'scheduledAlertOccurrence'
  | 'session'
  | 'fileOperationAudit'
>;

export interface RetentionCounts {
  notifications: number;
  cleanupHistory: number;
  alertOccurrences: number;
  expiredSessions: number;
  operationAudit: number;
}

export type RetentionImageResult = ImageCacheRetentionResult | {
  status: 'failed';
  message: string;
};

export interface RetentionSweepResult {
  notificationRetentionDays: number;
  counts: RetentionCounts;
  imageCache: RetentionImageResult;
}

export interface RetentionSweepOptions {
  notificationRetentionDays: number;
  nowMs?: number;
  database?: RetentionDatabase;
  pruneImages?: () => Promise<ImageCacheRetentionResult>;
}

function validNotificationRetentionDays(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 3650) return 90;
  return value;
}

/**
 * Apply bounded retention to historical/runtime rows, then reconcile orphaned
 * image files. Database failures reject so the polling loop retries; image
 * cleanup is isolated so a Redis/filesystem outage cannot block DB retention.
 */
export async function runRetentionSweep(
  options: RetentionSweepOptions,
): Promise<RetentionSweepResult> {
  const database = options.database ?? prisma;
  const nowMs = options.nowMs ?? Date.now();
  const notificationRetentionDays = validNotificationRetentionDays(
    options.notificationRetentionDays,
  );
  const historyCutoff = new Date(
    nowMs - CLEANUP_HISTORY_RETENTION_DAYS * DAY_MS,
  );
  const sessionCutoff = new Date(nowMs - SESSION_DURATION_SECONDS * 1000);
  const operationAuditCutoff = new Date(
    nowMs - FILE_OPERATION_AUDIT_RETENTION_DAYS * DAY_MS,
  );
  const notificationCutoff = new Date(
    nowMs - notificationRetentionDays * DAY_MS,
  );

  const [
    notifications,
    cleanupHistory,
    alertOccurrences,
    expiredSessions,
    operationAudit,
  ] = await Promise.all([
    database.notificationHistory.deleteMany({
      where: { createdAt: { lt: notificationCutoff } },
    }),
    database.cleanupHistory.deleteMany({
      where: { createdAt: { lt: historyCutoff } },
    }),
    database.scheduledAlertOccurrence.deleteMany({
      // Pending occurrences are live delivery state, not history.
      where: {
        status: { in: ['sent', 'failed', 'cancelled'] },
        notifyAt: { lt: historyCutoff },
      },
    }),
    database.session.deleteMany({
      // Session JWTs have a fixed lifetime from creation, so these rows can no
      // longer authenticate regardless of lastSeenAt or revokedAt.
      where: { createdAt: { lt: sessionCutoff } },
    }),
    database.fileOperationAudit.deleteMany({
      where: { createdAt: { lt: operationAuditCutoff } },
    }),
  ]);

  let imageCache: RetentionImageResult;
  try {
    imageCache = await (options.pruneImages ?? pruneOrphanImageCache)();
  } catch (error) {
    imageCache = {
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    notificationRetentionDays,
    counts: {
      notifications: notifications.count,
      cleanupHistory: cleanupHistory.count,
      alertOccurrences: alertOccurrences.count,
      expiredSessions: expiredSessions.count,
      operationAudit: operationAudit.count,
    },
    imageCache,
  };
}
