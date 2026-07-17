import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QBittorrentTorrent } from '@/types';
import type { SeedingRuleShape } from '@/lib/cleanup/types';

const mocks = vi.hoisted(() => ({
  configFindUnique: vi.fn(), ruleFindFirst: vi.fn(), ruleFindMany: vi.fn(), ruleCreate: vi.fn(),
  ruleUpdate: vi.fn(), ruleDelete: vi.fn(), ruleDeleteMany: vi.fn(), serviceFindMany: vi.fn(),
  historyCreate: vi.fn(), historyFindFirst: vi.fn(), strikeDeleteMany: vi.fn(), getQBittorrentClient: vi.fn(),
  getSonarrClients: vi.fn(), getRadarrClients: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: {
  downloadCleanerConfig: { findUnique: mocks.configFindUnique },
  seedingRule: { findFirst: mocks.ruleFindFirst, findMany: mocks.ruleFindMany, create: mocks.ruleCreate, update: mocks.ruleUpdate, delete: mocks.ruleDelete, deleteMany: mocks.ruleDeleteMany },
  serviceConnection: { findMany: mocks.serviceFindMany }, cleanupHistory: { create: mocks.historyCreate, findFirst: mocks.historyFindFirst },
  cleanupStrike: { deleteMany: mocks.strikeDeleteMany },
} }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/notification-service', () => ({ notifyEvent: vi.fn() }));
vi.mock('@/lib/service-helpers', () => ({
  getQBittorrentClient: mocks.getQBittorrentClient, getSonarrClients: mocks.getSonarrClients,
  getRadarrClients: mocks.getRadarrClients,
}));

import { runDownloadCleanerCycle } from '@/lib/cleanup/download-cleaner';

const baseConfig = { enabled: true, intervalMinutes: 60, ignoredDownloads: [], autoRemoveImportedEnabled: false, autoRemoveImportedCategories: ['sonarr', 'radarr', 'tv-sonarr'], autoRemoveImportedDeleteFiles: true, autoRemoveImportedPrivacyType: 'public', autoRunMode: 'disabled' };

function torrent(overrides: Partial<QBittorrentTorrent> = {}): QBittorrentTorrent {
  return { hash: 'ABC123', name: 'Example', size: 1024, progress: 1, dlspeed: 0, upspeed: 0, num_seeds: 1, num_leechs: 0, state: 'uploading', eta: 0, category: 'sonarr', tags: '', priority: 0, added_on: 0, completion_on: Date.now() / 1000 - 7200, save_path: '', amount_left: 0, completed: 1024, downloaded: 1024, uploaded: 2048, downloaded_session: 0, uploaded_session: 0, dl_limit: 0, up_limit: 0, magnet_uri: '', time_active: 7200, seeding_time: 7200, availability: 1, ratio: 2.5, seq_dl: false, f_l_piece_prio: false, force_start: false, auto_tmm: false, max_ratio: -1, max_seeding_time: -1, private: false, ...overrides };
}

function rule(overrides: Partial<SeedingRuleShape> = {}): SeedingRuleShape {
  return { id: 'rule-a', name: 'Seed rule', enabled: true, priority: 0, categories: ['sonarr'], trackerPatterns: [], tagsAny: [], tagsAll: [], privacyType: 'both', maxRatio: 2, minSeedTimeHours: 0, maxSeedTimeHours: -1, deleteSourceFiles: true, requireImportedConfirmation: false, isSystem: false, ...overrides };
}

function setTorrents(torrents: QBittorrentTorrent[], trackerUrl?: string) {
  mocks.getQBittorrentClient.mockResolvedValue({
    getTorrents: vi.fn().mockResolvedValue(torrents),
    getTorrentTrackers: vi.fn().mockResolvedValue(trackerUrl ? [{ url: trackerUrl }] : []),
  });
}

function setTorrentsWithTrackerFailure(torrents: QBittorrentTorrent[]) {
  mocks.getQBittorrentClient.mockResolvedValue({
    getTorrents: vi.fn().mockResolvedValue(torrents),
    getTorrentTrackers: vi.fn().mockRejectedValue(new Error('tracker offline')),
  });
}

function setSonarrHistory(result: { records: Array<{ eventType: string; date?: string }> } | Error) {
  const getHistory = result instanceof Error ? vi.fn().mockRejectedValue(result) : vi.fn().mockResolvedValue(result);
  mocks.getSonarrClients.mockResolvedValue([{ connection: { id: 'sonarr-1' }, client: { getHistory } }]);
  return getHistory;
}

const run = () => runDownloadCleanerCycle({ dryRun: true, triggeredBy: 'dryRun' });

describe('download cleaner cycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configFindUnique.mockResolvedValue({ ...baseConfig }); mocks.ruleFindFirst.mockResolvedValue(null);
    mocks.ruleFindMany.mockResolvedValue([]); mocks.serviceFindMany.mockResolvedValue([]);
    mocks.getSonarrClients.mockResolvedValue([]); mocks.getRadarrClients.mockResolvedValue([]);
    mocks.historyCreate.mockResolvedValue({}); mocks.historyFindFirst.mockResolvedValue(null); mocks.strikeDeleteMany.mockResolvedValue({ count: 0 });
    setTorrents([]);
  });

  it('loads binding rules but does not call qBittorrent when disabled', async () => {
    mocks.configFindUnique.mockResolvedValue({ ...baseConfig, enabled: false });
    await expect(run()).resolves.toMatchObject({ decisions: [], warnings: ['Download Cleaner is disabled'] });
    expect(mocks.ruleFindMany).toHaveBeenCalled(); expect(mocks.getQBittorrentClient).not.toHaveBeenCalled();
  });

  it.each([torrent({ progress: 0.5 }), torrent({ state: 'downloading' })])('ignores non-seeding torrents', async (t) => {
    mocks.ruleFindMany.mockResolvedValue([rule()]); setTorrents([t]); expect((await run()).decisions).toHaveLength(0);
  });

  it('matches categories case-insensitively', async () => {
    mocks.ruleFindMany.mockResolvedValue([rule({ categories: ['sonarr'] })]); setTorrents([torrent({ category: 'Sonarr' })]);
    expect((await run()).decisions).toHaveLength(1);
    setTorrents([torrent({ category: 'movies' })]); expect((await run()).decisions).toHaveLength(0);
  });

  it('applies tagsAny and tagsAll filters', async () => {
    mocks.ruleFindMany.mockResolvedValue([rule({ categories: [], tagsAny: ['keep', 'x'] })]); setTorrents([torrent({ tags: 'x, y' })]);
    expect((await run()).decisions).toHaveLength(1);
    mocks.ruleFindMany.mockResolvedValue([rule({ categories: [], tagsAll: ['a', 'b'] })]); setTorrents([torrent({ tags: 'a' })]);
    expect((await run()).decisions).toHaveLength(0);
  });

  it('applies tracker filters', async () => {
    mocks.ruleFindMany.mockResolvedValue([rule({ categories: [], trackerPatterns: ['tracker.example'] })]);
    setTorrents([torrent()], 'https://tracker.example/announce'); expect((await run()).decisions).toHaveLength(1);
    setTorrents([torrent()], 'https://other.example/announce'); expect((await run()).decisions).toHaveLength(0);
  });

  it('fails closed on tracker lookup only when tracker matching is configured', async () => {
    mocks.ruleFindMany.mockResolvedValue([rule({ categories: [], trackerPatterns: ['tracker.example'] })]);
    setTorrentsWithTrackerFailure([torrent()]);
    await expect(run()).resolves.toMatchObject({ decisions: [], warnings: [expect.stringContaining('tracker')] });
    mocks.ruleFindMany.mockResolvedValue([rule({ categories: ['sonarr'], trackerPatterns: [] })]);
    setTorrentsWithTrackerFailure([torrent()]);
    const result = await run();
    expect(result.decisions).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it('applies privacy filters', async () => {
    mocks.ruleFindMany.mockResolvedValue([rule({ privacyType: 'public' })]); setTorrents([torrent({ private: true })]);
    expect((await run()).decisions).toHaveLength(0);
  });

  it('evaluates ratio, minimum time, and maximum time predicates', async () => {
    mocks.ruleFindMany.mockResolvedValue([rule({ maxRatio: 2, minSeedTimeHours: 0 })]);
    setTorrents([torrent({ ratio: 2.5 })]); const result = await run();
    expect(result.decisions[0]).toMatchObject({ removalKind: 'seeding', reason: expect.stringContaining('Seed rule') });
    setTorrents([torrent({ ratio: 1 })]); expect((await run()).decisions).toHaveLength(0);
    mocks.ruleFindMany.mockResolvedValue([rule({ maxRatio: 2, minSeedTimeHours: 10000 })]); setTorrents([torrent({ ratio: 2.5 })]);
    expect((await run()).decisions).toHaveLength(0);
    mocks.ruleFindMany.mockResolvedValue([rule({ maxRatio: 2, maxSeedTimeHours: 1 })]); setTorrents([torrent({ ratio: 0, completion_on: Date.now() / 1000 - 7200 })]);
    expect((await run()).decisions).toHaveLength(1);
  });

  it('uses qBittorrent seeding_time instead of wall-clock completion age', async () => {
    mocks.ruleFindMany.mockResolvedValue([rule({ maxRatio: -1, maxSeedTimeHours: 24 })]);
    setTorrents([torrent({ ratio: 0, completion_on: Date.now() / 1000 - 48 * 3600, seeding_time: 0 })]);
    expect((await run()).decisions).toHaveLength(0);
    setTorrents([torrent({ ratio: 0, completion_on: Date.now() / 1000 - 48 * 3600, seeding_time: 30 * 3600 })]);
    expect((await run()).decisions).toHaveLength(1);
  });

  it('uses the first pre-ordered matching rule', async () => {
    mocks.ruleFindMany.mockResolvedValue([rule({ id: 'first', priority: 0 }), rule({ id: 'second', priority: 1 })]); setTorrents([torrent()]);
    expect((await run()).decisions[0].rule.id).toBe('first');
  });

  it('requires a positive import confirmation', async () => {
    const addedOn = Date.now() / 1000 - 3600;
    mocks.ruleFindMany.mockResolvedValue([rule({ requireImportedConfirmation: true })]); setTorrents([torrent({ added_on: addedOn })]);
    setSonarrHistory({ records: [{ eventType: 'downloadFolderImported', date: new Date().toISOString() }] }); const result = await run();
    expect(result.decisions[0]).toMatchObject({ removalKind: 'imported', reason: expect.stringContaining('imported') });
    setSonarrHistory({ records: [] }); expect((await run()).decisions).toHaveLength(0);
  });

  it('ignores import events older than the current torrent grab', async () => {
    const addedOn = Date.now() / 1000 - 3600;
    mocks.ruleFindMany.mockResolvedValue([rule({ requireImportedConfirmation: true })]);
    setTorrents([torrent({ added_on: addedOn })]);
    setSonarrHistory({ records: [{ eventType: 'downloadFolderImported', date: new Date((addedOn - 3600) * 1000).toISOString() }] });
    expect((await run()).decisions).toHaveLength(0);
    setSonarrHistory({ records: [{ eventType: 'downloadFolderImported', date: new Date((addedOn + 60) * 1000).toISOString() }] });
    expect((await run()).decisions).toHaveLength(1);
  });

  it('deduplicates automatic dry-run preview history', async () => {
    mocks.ruleFindMany.mockResolvedValue([rule()]); setTorrents([torrent()]);
    await runDownloadCleanerCycle({ dryRun: true, triggeredBy: 'auto' });
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'dryRunPreview' }) }));
    vi.clearAllMocks();
    mocks.configFindUnique.mockResolvedValue({ ...baseConfig }); mocks.serviceFindMany.mockResolvedValue([]);
    mocks.ruleFindMany.mockResolvedValue([rule()]); mocks.getSonarrClients.mockResolvedValue([]); mocks.getRadarrClients.mockResolvedValue([]);
    mocks.historyFindFirst.mockResolvedValue({ id: 'x' }); setTorrents([torrent()]);
    await runDownloadCleanerCycle({ dryRun: true, triggeredBy: 'auto' });
    expect(mocks.historyCreate).not.toHaveBeenCalled();
  });

  it('records an unreachable import confirmation as skipped even in dry-run', async () => {
    mocks.ruleFindMany.mockResolvedValue([rule({ requireImportedConfirmation: true })]); setTorrents([torrent()]);
    setSonarrHistory(new Error('offline')); const result = await run();
    expect(result.decisions).toHaveLength(0);
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'skipped', reason: expect.stringContaining('unreachable') }) }));
  });

  it('skips ignored categories', async () => {
    mocks.configFindUnique.mockResolvedValue({ ...baseConfig, ignoredDownloads: ['sonarr'] }); mocks.ruleFindMany.mockResolvedValue([rule()]); setTorrents([torrent()]);
    expect((await run()).decisions).toHaveLength(0);
  });

  it('builds deterministic bindings and carries deleteSourceFiles', async () => {
    mocks.ruleFindMany.mockResolvedValue([rule({ deleteSourceFiles: false })]); setTorrents([torrent()]);
    const first = await run(); const second = await run();
    expect(first.binding.cleaner).toBe('download'); expect(first.binding.candidates).toHaveLength(first.decisions.length);
    expect(first.binding.candidates[0]).toMatchObject({ deleteSourceFiles: false });
    expect(second.binding).toMatchObject({ configFingerprint: first.binding.configFingerprint, candidatesFingerprint: first.binding.candidatesFingerprint });
  });

  it('returns no warnings for a normal run', async () => {
    expect((await run()).warnings).toEqual([]);
  });
});
