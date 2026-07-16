import { describe, expect, it, vi } from 'vitest';
import {
  CLEANUP_HISTORY_RETENTION_DAYS,
  FILE_OPERATION_AUDIT_RETENTION_DAYS,
  RECOMMENDATION_ACTIVITY_RETENTION_DAYS,
  RECOMMENDATION_IMPRESSION_RETENTION_DAYS,
  runRetentionSweep,
  type RetentionSweepOptions,
} from '@/lib/retention';
import { SESSION_DURATION_SECONDS } from '@/lib/session-policy';

const DAY_MS = 24 * 60 * 60 * 1000;

function databaseFixture(counts: number[] = [1, 2, 3, 4, 5, 6]) {
  const delegates = counts.map((count) => ({
    deleteMany: vi.fn(async () => ({ count })),
  }));
  return {
    database: {
      notificationHistory: delegates[0],
      cleanupHistory: delegates[1],
      scheduledAlertOccurrence: delegates[2],
      session: delegates[3],
      fileOperationAudit: delegates[4],
      recommendationEvent: delegates[5],
    } as unknown as NonNullable<RetentionSweepOptions['database']>,
    delegates,
  };
}

describe('runRetentionSweep', () => {
  it('applies each retention boundary and preserves pending alert occurrences', async () => {
    const nowMs = Date.UTC(2026, 6, 14, 12);
    const { database, delegates } = databaseFixture();
    const pruneImages = vi.fn(async () => ({
      status: 'completed' as const,
      generation: 3,
      metadataEntries: 10,
      deletedFiles: 2,
      deletedBytes: 100,
      deletedGenerations: 1,
    }));

    const result = await runRetentionSweep({
      notificationRetentionDays: 45,
      nowMs,
      database,
      pruneImages,
    });

    expect(delegates[0].deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date(nowMs - 45 * DAY_MS) } },
    });
    expect(delegates[1].deleteMany).toHaveBeenCalledWith({
      where: {
        createdAt: { lt: new Date(nowMs - CLEANUP_HISTORY_RETENTION_DAYS * DAY_MS) },
      },
    });
    expect(delegates[2].deleteMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['sent', 'failed', 'cancelled'] },
        notifyAt: { lt: new Date(nowMs - CLEANUP_HISTORY_RETENTION_DAYS * DAY_MS) },
      },
    });
    expect(delegates[3].deleteMany).toHaveBeenCalledWith({
      where: {
        createdAt: { lt: new Date(nowMs - SESSION_DURATION_SECONDS * 1000) },
      },
    });
    expect(delegates[4].deleteMany).toHaveBeenCalledWith({
      where: {
        createdAt: {
          lt: new Date(nowMs - FILE_OPERATION_AUDIT_RETENTION_DAYS * DAY_MS),
        },
      },
    });
    expect(delegates[5].deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            eventType: 'impression',
            createdAt: { lt: new Date(nowMs - RECOMMENDATION_IMPRESSION_RETENTION_DAYS * DAY_MS) },
          },
          {
            eventType: { in: ['click', 'play', 'watchlist_add', 'request'] },
            createdAt: { lt: new Date(nowMs - RECOMMENDATION_ACTIVITY_RETENTION_DAYS * DAY_MS) },
          },
        ],
      },
    });
    expect(result.counts).toEqual({
      notifications: 1,
      cleanupHistory: 2,
      alertOccurrences: 3,
      expiredSessions: 4,
      operationAudit: 5,
      recommendationEvents: 6,
    });
    expect(result.imageCache.status).toBe('completed');
  });

  it('falls back to 90 days for an invalid notification-retention setting', async () => {
    const nowMs = Date.UTC(2026, 6, 14, 12);
    const { database, delegates } = databaseFixture([0, 0, 0, 0, 0, 0]);

    const result = await runRetentionSweep({
      notificationRetentionDays: Number.NaN,
      nowMs,
      database,
      pruneImages: async () => ({
        status: 'skipped',
        reason: 'generation-uninitialized',
        generation: null,
        metadataEntries: 0,
        deletedFiles: 0,
        deletedBytes: 0,
        deletedGenerations: 0,
      }),
    });

    expect(result.notificationRetentionDays).toBe(90);
    expect(delegates[0].deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date(nowMs - 90 * DAY_MS) } },
    });
  });

  it('reports image-cache failure without blocking successful database retention', async () => {
    const { database } = databaseFixture([0, 0, 0, 0, 0, 0]);
    const result = await runRetentionSweep({
      notificationRetentionDays: 90,
      database,
      pruneImages: async () => {
        throw new Error('Redis unavailable');
      },
    });

    expect(result.imageCache).toEqual({ status: 'failed', message: 'Redis unavailable' });
  });

  it('rejects database failure and does not begin filesystem cleanup', async () => {
    const { database, delegates } = databaseFixture([0, 0, 0, 0, 0, 0]);
    delegates[3].deleteMany.mockRejectedValueOnce(new Error('database unavailable'));
    const pruneImages = vi.fn();

    await expect(runRetentionSweep({
      notificationRetentionDays: 90,
      database,
      pruneImages,
    })).rejects.toThrow('database unavailable');
    expect(pruneImages).not.toHaveBeenCalled();
  });
});
