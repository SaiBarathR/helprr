import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QBittorrentTorrent, QueueItem } from '@/types';
import type { DownloadDecision, LinkedArr, QueueDecision, SeedingRuleShape } from '@/lib/cleanup/types';

const mocks = vi.hoisted(() => ({
  getQBittorrentClient: vi.fn(),
  getSonarrClient: vi.fn(),
  getRadarrClient: vi.fn(),
  cleanupStrikeDeleteMany: vi.fn(),
  cleanupHistoryCreate: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    cleanupStrike: { deleteMany: mocks.cleanupStrikeDeleteMany },
    cleanupHistory: { create: mocks.cleanupHistoryCreate },
    fileOperationAudit: { create: mocks.auditCreate },
  },
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('@/lib/notification-service', () => ({ notifyEvent: vi.fn() }));
vi.mock('@/lib/service-helpers', () => ({
  getQBittorrentClient: mocks.getQBittorrentClient,
  getSonarrClient: mocks.getSonarrClient,
  getRadarrClient: mocks.getRadarrClient,
  getSonarrClients: vi.fn(),
  getRadarrClients: vi.fn(),
}));

import { executeDownloadCleanerRemoval } from '@/lib/cleanup/download-cleaner';
import { executeQueueCleanerRemoval } from '@/lib/cleanup/queue-cleaner';
import { logger } from '@/lib/logger';

const owner = { id: 'user-1', username: 'owner' };
const manual = (previewId: string) => ({ triggeredBy: 'manual' as const, actor: owner, previewId });
const auto = { triggeredBy: 'auto' as const, actor: { id: null, username: 'system:cleanup-scheduler' } };
const auditRows = () => mocks.auditCreate.mock.calls.map(([arg]) => arg.data);

function torrent(overrides: Partial<QBittorrentTorrent> = {}): QBittorrentTorrent {
  return {
    hash: 'ABC123',
    name: 'Example torrent',
    size: 1024,
    progress: 1,
    ratio: 2,
    private: false,
    ...overrides,
  } as QBittorrentTorrent;
}

function queueLink(instanceId: string, id: number, source: LinkedArr['source'] = 'sonarr'): LinkedArr {
  return {
    source,
    instanceId,
    instanceLabel: instanceId,
    queueItem: { id, downloadId: 'ABC123' } as QueueItem,
    contentId: 10,
    title: `Queue ${id}`,
  };
}

const seedingRule: SeedingRuleShape = {
  id: 'rule-1',
  name: 'Seed complete',
  enabled: true,
  priority: 1,
  categories: [],
  trackerPatterns: [],
  tagsAny: [],
  tagsAll: [],
  privacyType: 'both',
  maxRatio: 1,
  minSeedTimeHours: 0,
  maxSeedTimeHours: -1,
  deleteSourceFiles: false,
  requireImportedConfirmation: false,
  isSystem: false,
};

describe('cleanup result reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cleanupHistoryCreate.mockResolvedValue({});
    mocks.cleanupStrikeDeleteMany.mockResolvedValue({ count: 1 });
    mocks.auditCreate.mockResolvedValue({});
  });

  it('continues across Arr targets and records the observed partial result', async () => {
    const first = {
      deleteQueueItem: vi.fn().mockResolvedValue(undefined),
      getQueue: vi.fn().mockResolvedValue({ records: [], totalRecords: 0 }),
    };
    const second = {
      deleteQueueItem: vi.fn().mockRejectedValue(new Error('second Arr rejected deletion')),
      getQueue: vi.fn().mockResolvedValue({ records: [{ id: 202 }], totalRecords: 1 }),
    };
    mocks.getSonarrClient.mockResolvedValue(first);
    mocks.getRadarrClient.mockResolvedValue(second);
    mocks.getQBittorrentClient.mockResolvedValue({
      getTorrents: vi.fn().mockResolvedValue([]),
    });

    const links = [queueLink('sonarr-1', 101), queueLink('radarr-2', 202, 'radarr')];
    const decision: QueueDecision = {
      torrent: torrent(),
      strikeType: 'stall',
      ruleId: 'stall-1',
      ruleName: 'Stalled',
      strikeCount: 3,
      maxStrikes: 3,
      reason: 'Stalled for three cycles',
      linked: links[0],
      linkedAll: links,
      options: { changeCategory: false, deletePrivate: false, reSearch: false },
    };

    const outcome = await executeQueueCleanerRemoval(decision, manual('preview-1'));

    expect(first.deleteQueueItem).toHaveBeenCalledWith(101, { removeFromClient: true, blocklist: false, changeCategory: false });
    expect(second.deleteQueueItem).toHaveBeenCalledWith(202, { removeFromClient: false, blocklist: false, changeCategory: false });
    expect(outcome).toMatchObject({
      kind: 'failure',
      status: 'partial',
      action: 'removedFromClient',
      filesDeleted: true,
    });
    expect(outcome.targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ instanceId: 'sonarr-1', after: 'absent' }),
      expect.objectContaining({ instanceId: 'radarr-2', after: 'present' }),
      expect.objectContaining({ target: 'qbittorrent', after: 'absent' }),
    ]));
    expect(mocks.cleanupHistoryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        previewId: 'preview-1',
        outcomeStatus: 'partial',
        action: 'removedFromClient',
        actorUserId: 'user-1',
        actorUsername: 'owner',
      }),
    }));
    // One audit row per Arr removal call, each with its own observed result.
    // The torrent went with the first call, so that row carries qBittorrent's state.
    const rows = auditRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      userId: 'user-1', username: 'owner', service: 'SONARR', instanceId: 'sonarr-1', operation: 'REMOVE_QUEUE',
      mediaType: 'queue', mediaId: 101, mediaTitle: 'Example torrent', fileCount: 1, filesDeleted: true,
      success: true, errorMessage: null,
      details: {
        cleaner: 'queue', triggeredBy: 'manual', previewId: 'preview-1', hash: 'abc123',
        rule: { id: 'stall-1', name: 'Stalled', strikeType: 'stall' }, queueItemId: 101,
        removeFromClient: true, blocklist: false, changeCategory: false,
        before: 'present', after: 'absent', clientAfter: 'absent', callError: null,
      },
    });
    expect(rows[1]).toMatchObject({
      userId: 'user-1', service: 'RADARR', instanceId: 'radarr-2', operation: 'REMOVE_QUEUE', mediaId: 202,
      filesDeleted: false, success: false, errorMessage: 'second Arr rejected deletion',
      details: { queueItemId: 202, removeFromClient: false, after: 'present', clientAfter: null, callError: 'second Arr rejected deletion' },
    });
    for (const row of rows) expect(row.startedAt).toBeInstanceOf(Date);
  });

  it('audits a queue removal without an Arr link as a qBittorrent deletion', async () => {
    mocks.getQBittorrentClient.mockResolvedValue({
      deleteTorrent: vi.fn().mockResolvedValue(undefined),
      getTorrents: vi.fn().mockResolvedValue([{ hash: 'ABC123' }]),
    });
    const decision: QueueDecision = {
      torrent: torrent(),
      strikeType: 'downloadingMetadata',
      ruleId: null,
      ruleName: null,
      strikeCount: 3,
      maxStrikes: 3,
      reason: 'Stuck on metadata',
      linked: null,
      options: { changeCategory: false, deletePrivate: false, reSearch: false },
    };

    const outcome = await executeQueueCleanerRemoval(decision, auto);

    expect(outcome).toMatchObject({ kind: 'failure', status: 'failed' });
    expect(auditRows()).toEqual([expect.objectContaining({
      userId: null, username: 'system:cleanup-scheduler', service: 'QBITTORRENT', instanceId: null,
      operation: 'DELETE_TORRENT', mediaType: 'torrent', filesDeleted: true, success: false,
      errorMessage: 'qBittorrent still reports the torrent after deletion',
      details: expect.objectContaining({ triggeredBy: 'auto', previewId: null, hash: 'abc123', deleteFiles: true, after: 'present', callError: null }),
    })]);
  });

  it('marks a qBittorrent deletion partial when its final state cannot be read', async () => {
    const qbit = {
      deleteTorrent: vi.fn().mockRejectedValue(new Error('delete timed out')),
      getTorrents: vi.fn().mockRejectedValue(new Error('inspection unavailable')),
    };
    mocks.getQBittorrentClient.mockResolvedValue(qbit);
    const decision: DownloadDecision = {
      torrent: torrent(),
      rule: seedingRule,
      reason: 'Ratio reached',
      seedingHours: 4,
      removalKind: 'seeding',
    };

    const outcome = await executeDownloadCleanerRemoval(decision, manual('preview-2'));

    expect(outcome).toMatchObject({ kind: 'failure', status: 'partial', action: 'failed', filesDeleted: false });
    expect(auditRows()).toEqual([expect.objectContaining({
      userId: 'user-1', service: 'QBITTORRENT', operation: 'DELETE_TORRENT', filesDeleted: false, success: false,
      errorMessage: 'delete timed out; inspection unavailable',
      details: expect.objectContaining({ previewId: 'preview-2', hash: 'abc123', after: 'unknown', callError: 'delete timed out' }),
    })]);
    expect(mocks.cleanupStrikeDeleteMany).not.toHaveBeenCalled();
    expect(mocks.cleanupHistoryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ previewId: 'preview-2', outcomeStatus: 'partial', action: 'failed' }),
    }));
  });

  it('treats an upstream timeout as success when absence is independently confirmed', async () => {
    const qbit = {
      deleteTorrent: vi.fn().mockRejectedValue(new Error('response timed out')),
      getTorrents: vi.fn().mockResolvedValue([]),
    };
    mocks.getQBittorrentClient.mockResolvedValue(qbit);
    const decision: DownloadDecision = {
      torrent: torrent(),
      rule: seedingRule,
      reason: 'Ratio reached',
      seedingHours: 4,
      removalKind: 'seeding',
    };

    const outcome = await executeDownloadCleanerRemoval(decision, manual('preview-3'));

    expect(outcome).toMatchObject({ kind: 'success', status: 'succeeded', action: 'removedFromClient' });
    expect(mocks.cleanupStrikeDeleteMany).toHaveBeenCalledWith({ where: { hash: 'abc123' } });
    // The torrent is gone, so the row says so, and keeps the error the call returned.
    expect(auditRows()).toEqual([expect.objectContaining({
      success: true, errorMessage: null,
      details: expect.objectContaining({ after: 'absent', callError: 'response timed out' }),
    })]);
  });

  // By the time the history row is written the torrent is gone. Letting the
  // write's failure escape made the cycle report the removal as failed, with no
  // files deleted, and send a failure notification for it.
  describe('when the history row cannot be written', () => {
    beforeEach(() => {
      mocks.cleanupHistoryCreate.mockRejectedValue(new Error('database unavailable'));
    });

    it('still reports a download removal that happened', async () => {
      mocks.getQBittorrentClient.mockResolvedValue({
        deleteTorrent: vi.fn().mockResolvedValue(undefined),
        getTorrents: vi.fn().mockResolvedValue([]),
      });
      const decision: DownloadDecision = {
        torrent: torrent(),
        rule: { ...seedingRule, deleteSourceFiles: true },
        reason: 'Ratio reached',
        seedingHours: 4,
        removalKind: 'seeding',
      };

      const outcome = await executeDownloadCleanerRemoval(decision, auto);

      expect(outcome).toMatchObject({ kind: 'success', status: 'succeeded', action: 'removedFromClient', filesDeleted: true });
      expect(logger.error).toHaveBeenCalledWith(
        'Cleanup history write failed',
        expect.objectContaining({ hash: 'abc123', action: 'removedFromClient' }),
        expect.anything(),
      );
    });

    it('still reports a queue removal that happened', async () => {
      const sonarr = {
        deleteQueueItem: vi.fn().mockResolvedValue(undefined),
        getQueue: vi.fn().mockResolvedValue({ records: [], totalRecords: 0 }),
      };
      mocks.getSonarrClient.mockResolvedValue(sonarr);
      mocks.getQBittorrentClient.mockResolvedValue({ getTorrents: vi.fn().mockResolvedValue([]) });
      const link = queueLink('sonarr-1', 101);
      const decision: QueueDecision = {
        torrent: torrent(),
        strikeType: 'stall',
        ruleId: 'stall-1',
        ruleName: 'Stalled',
        strikeCount: 3,
        maxStrikes: 3,
        reason: 'Stalled for three cycles',
        linked: link,
        linkedAll: [link],
        options: { changeCategory: false, deletePrivate: false, reSearch: false },
      };

      const outcome = await executeQueueCleanerRemoval(decision, auto);

      expect(sonarr.deleteQueueItem).toHaveBeenCalledOnce();
      expect(outcome).toMatchObject({ kind: 'success', status: 'succeeded', action: 'removedFromClient' });
      expect(logger.error).toHaveBeenCalledWith(
        'Cleanup history write failed',
        expect.objectContaining({ hash: 'abc123', action: 'removedFromClient' }),
        expect.anything(),
      );
    });
  });

  it('audits a confirmed deletion even when strike cleanup then fails', async () => {
    mocks.cleanupStrikeDeleteMany.mockRejectedValue(new Error('database unavailable'));
    mocks.getQBittorrentClient.mockResolvedValue({
      deleteTorrent: vi.fn().mockResolvedValue(undefined),
      getTorrents: vi.fn().mockResolvedValue([]),
    });
    const decision: DownloadDecision = {
      torrent: torrent(),
      rule: seedingRule,
      reason: 'Ratio reached',
      seedingHours: 4,
      removalKind: 'seeding',
    };

    await executeDownloadCleanerRemoval(decision, manual('preview-5')).catch(() => {});

    expect(auditRows()).toEqual([expect.objectContaining({ userId: 'user-1', success: true })]);
  });

  describe('when the audit row cannot be written', () => {
    it('logs it and still reports the removal that happened', async () => {
      mocks.auditCreate.mockRejectedValue(new Error('database unavailable'));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      mocks.getQBittorrentClient.mockResolvedValue({
        deleteTorrent: vi.fn().mockResolvedValue(undefined),
        getTorrents: vi.fn().mockResolvedValue([]),
      });
      const decision: DownloadDecision = {
        torrent: torrent(),
        rule: { ...seedingRule, deleteSourceFiles: true },
        reason: 'Ratio reached',
        seedingHours: 4,
        removalKind: 'seeding',
      };

      const outcome = await executeDownloadCleanerRemoval(decision, manual('preview-4'));

      expect(outcome).toMatchObject({ kind: 'success', status: 'succeeded', action: 'removedFromClient', filesDeleted: true });
      expect(consoleError).toHaveBeenCalledWith('[FileAudit] Failed to write audit row:', expect.any(Error));
      expect(mocks.cleanupHistoryCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ outcomeStatus: 'succeeded', actorUsername: 'owner' }),
      }));
      consoleError.mockRestore();
    });
  });
});
