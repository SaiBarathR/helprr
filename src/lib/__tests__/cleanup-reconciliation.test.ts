import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QBittorrentTorrent, QueueItem } from '@/types';
import type { DownloadDecision, LinkedArr, QueueDecision, SeedingRuleShape } from '@/lib/cleanup/types';

const mocks = vi.hoisted(() => ({
  getQBittorrentClient: vi.fn(),
  getSonarrClient: vi.fn(),
  getRadarrClient: vi.fn(),
  cleanupStrikeDeleteMany: vi.fn(),
  cleanupHistoryCreate: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    cleanupStrike: { deleteMany: mocks.cleanupStrikeDeleteMany },
    cleanupHistory: { create: mocks.cleanupHistoryCreate },
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

function queueLink(instanceId: string, id: number): LinkedArr {
  return {
    source: 'sonarr',
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
    mocks.getSonarrClient.mockImplementation(async (instanceId: string) => (
      instanceId === 'sonarr-1' ? first : second
    ));
    mocks.getQBittorrentClient.mockResolvedValue({
      getTorrents: vi.fn().mockResolvedValue([]),
    });

    const links = [queueLink('sonarr-1', 101), queueLink('sonarr-2', 202)];
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

    const outcome = await executeQueueCleanerRemoval(decision, 'manual', 'preview-1');

    expect(first.deleteQueueItem).toHaveBeenCalledOnce();
    expect(second.deleteQueueItem).toHaveBeenCalledOnce();
    expect(outcome).toMatchObject({
      kind: 'failure',
      status: 'partial',
      action: 'removedFromClient',
      filesDeleted: true,
    });
    expect(outcome.targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ instanceId: 'sonarr-1', after: 'absent' }),
      expect.objectContaining({ instanceId: 'sonarr-2', after: 'present' }),
      expect.objectContaining({ target: 'qbittorrent', after: 'absent' }),
    ]));
    expect(mocks.cleanupHistoryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        previewId: 'preview-1',
        outcomeStatus: 'partial',
        action: 'removedFromClient',
      }),
    }));
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

    const outcome = await executeDownloadCleanerRemoval(decision, 'manual', 'preview-2');

    expect(outcome).toMatchObject({ kind: 'failure', status: 'partial', action: 'failed', filesDeleted: false });
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

    const outcome = await executeDownloadCleanerRemoval(decision, 'manual', 'preview-3');

    expect(outcome).toMatchObject({ kind: 'success', status: 'succeeded', action: 'removedFromClient' });
    expect(mocks.cleanupStrikeDeleteMany).toHaveBeenCalledWith({ where: { hash: 'abc123' } });
  });
});
