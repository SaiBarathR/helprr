import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QBittorrentTorrent } from '@/types';

/*
 * QBT-29: the download cleaner on two qBittorrents. Each torrent is re-read,
 * removed and audited on the instance that lists it; a hash both list is
 * skipped (which copy to remove can't be told); an instance that cannot list
 * its torrents stops the whole cycle.
 */
const mocks = vi.hoisted(() => ({
  configFindUnique: vi.fn(), ruleFindFirst: vi.fn(), ruleFindMany: vi.fn(), serviceFindMany: vi.fn(),
  historyCreate: vi.fn(), historyFindFirst: vi.fn(), strikeDeleteMany: vi.fn(), auditCreate: vi.fn(),
  clients: {} as Record<string, ReturnType<typeof qbit>>,
  getQBittorrentClient: vi.fn(),
}));

function qbit(torrents: QBittorrentTorrent[] | Error) {
  const deleted = new Set<string>();
  return {
    getTorrents: vi.fn(async (_f?: string, _c?: string, _s?: string, _r?: boolean, hash?: string) => {
      if (torrents instanceof Error) throw torrents;
      return torrents.filter((t) => !deleted.has(t.hash) && (!hash || t.hash === hash));
    }),
    getTorrentTrackers: vi.fn(async () => []),
    deleteTorrent: vi.fn(async (hash: string) => { deleted.add(hash); }),
  };
}

vi.mock('@/lib/db', () => ({ prisma: {
  downloadCleanerConfig: { findUnique: mocks.configFindUnique },
  seedingRule: { findFirst: mocks.ruleFindFirst, findMany: mocks.ruleFindMany },
  serviceConnection: { findMany: mocks.serviceFindMany },
  cleanupHistory: { create: mocks.historyCreate, findFirst: mocks.historyFindFirst },
  cleanupStrike: { deleteMany: mocks.strikeDeleteMany },
  fileOperationAudit: { create: mocks.auditCreate },
} }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/notification-service', () => ({ notifyEvent: vi.fn() }));
vi.mock('@/lib/service-helpers', () => ({
  getQBittorrentClient: mocks.getQBittorrentClient,
  getQBittorrentClients: async () => Object.entries(mocks.clients).map(([id, client]) => ({ connection: { id, label: id }, client })),
  getSonarrClients: async () => [],
  getRadarrClients: async () => [],
}));

import { runDownloadCleanerCycle } from '@/lib/cleanup/download-cleaner';
import { duplicateHashWarning } from '@/lib/cleanup/torrent-sources';

const owner = { id: 'user-1', username: 'owner' };
const config = { enabled: true, intervalMinutes: 60, ignoredDownloads: [], autoRemoveImportedEnabled: false, autoRemoveImportedCategories: [], autoRemoveImportedDeleteFiles: false, autoRemoveImportedPrivacyType: 'public', autoRunMode: 'disabled' };
const seedRule = { id: 'rule-a', name: 'Seeded enough', enabled: true, priority: 0, categories: [], trackerPatterns: [], tagsAny: [], tagsAll: [], privacyType: 'both', maxRatio: 2, minSeedTimeHours: 0, maxSeedTimeHours: -1, deleteSourceFiles: true, requireImportedConfirmation: false, isSystem: false, createdAt: new Date() };
const torrent = (hash: string): QBittorrentTorrent => ({ hash, name: hash.toUpperCase(), size: 1024, progress: 1, state: 'uploading', category: '', tags: '', ratio: 3, added_on: 0, seeding_time: 7200, time_active: 7200, private: false } as QBittorrentTorrent);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configFindUnique.mockResolvedValue(config);
  mocks.ruleFindFirst.mockResolvedValue(null);
  mocks.ruleFindMany.mockResolvedValue([seedRule]);
  mocks.serviceFindMany.mockResolvedValue([]);
  mocks.historyCreate.mockResolvedValue({});
  mocks.historyFindFirst.mockResolvedValue(null);
  mocks.strikeDeleteMany.mockResolvedValue({ count: 0 });
  mocks.auditCreate.mockResolvedValue({});
  mocks.clients = { q1: qbit([torrent('only-q1'), torrent('both')]), q2: qbit([torrent('only-q2'), torrent('both')]) };
  mocks.getQBittorrentClient.mockImplementation(async (id: string) => mocks.clients[id]);
});

describe('download cleaner on several qBittorrents (QBT-29)', () => {
  it('removes each torrent from the qBittorrent that lists it, and skips a hash both list', async () => {
    const result = await runDownloadCleanerCycle({ dryRun: false, triggeredBy: 'manual', actor: owner });

    expect(result.decisions.map((d) => [d.torrent.hash, d.torrent.qbitInstanceId])).toEqual([['only-q1', 'q1'], ['only-q2', 'q2']]);
    expect(result.warnings).toContain('"BOTH" is in more than one qBittorrent and was skipped');
    expect(mocks.clients.q1.deleteTorrent.mock.calls.map(([hash]) => hash)).toEqual(['only-q1']);
    expect(mocks.clients.q2.deleteTorrent.mock.calls.map(([hash]) => hash)).toEqual(['only-q2']);
    expect(mocks.getQBittorrentClient.mock.calls.every(([id]) => id === 'q1' || id === 'q2')).toBe(true);
    // The preview binding names the instance, so a token can't be spent on another one's torrent.
    expect(result.binding.candidates).toEqual([
      expect.objectContaining({ hash: 'only-q1', qbitInstanceId: 'q1' }),
      expect.objectContaining({ hash: 'only-q2', qbitInstanceId: 'q2' }),
    ]);
    const audits = mocks.auditCreate.mock.calls.map(([arg]) => [arg.data.mediaTitle, arg.data.instanceId]);
    expect(audits.sort()).toEqual([['ONLY-Q1', 'q1'], ['ONLY-Q2', 'q2']]);
    expect(result.outcomes.flatMap((o) => o.targets.map((t) => t.instanceId)).sort()).toEqual(['q1', 'q2']);
  });

  it('evaluates nothing when one qBittorrent cannot list its torrents', async () => {
    mocks.clients.q2 = qbit(new Error('qBittorrent did not answer'));
    const result = await runDownloadCleanerCycle({ dryRun: false, triggeredBy: 'manual', actor: owner });

    expect(result.decisions).toEqual([]);
    expect(result.warnings).toEqual(['qBittorrent torrent listing failed — nothing was evaluated']);
    expect(mocks.clients.q1.deleteTorrent).not.toHaveBeenCalled();
  });
});

describe('duplicateHashWarning', () => {
  it('names the torrents left out, the first few of many', () => {
    expect(duplicateHashWarning([])).toBeNull();
    expect(duplicateHashWarning(['A', 'B'])).toBe('2 torrents are in more than one qBittorrent and were skipped: "A", "B"');
    expect(duplicateHashWarning(['A', 'B', 'C', 'D', 'E'])).toBe('5 torrents are in more than one qBittorrent and were skipped: "A", "B", "C" and 2 more');
  });
});
