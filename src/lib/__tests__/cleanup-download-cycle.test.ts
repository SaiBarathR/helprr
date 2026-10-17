import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QBittorrentTorrent } from '@/types';
import type { SeedingRuleShape } from '@/lib/cleanup/types';

const mocks = vi.hoisted(() => ({
  configFindUnique: vi.fn(), ruleFindFirst: vi.fn(), ruleFindMany: vi.fn(), ruleCreate: vi.fn(),
  ruleUpdate: vi.fn(), ruleDelete: vi.fn(), ruleDeleteMany: vi.fn(), serviceFindMany: vi.fn(),
  historyCreate: vi.fn(), historyFindFirst: vi.fn(), strikeDeleteMany: vi.fn(), getQBittorrentClient: vi.fn(),
  getSonarrClients: vi.fn(), getRadarrClients: vi.fn(), auditCreate: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: {
  downloadCleanerConfig: { findUnique: mocks.configFindUnique },
  seedingRule: { findFirst: mocks.ruleFindFirst, findMany: mocks.ruleFindMany, create: mocks.ruleCreate, update: mocks.ruleUpdate, delete: mocks.ruleDelete, deleteMany: mocks.ruleDeleteMany },
  serviceConnection: { findMany: mocks.serviceFindMany }, cleanupHistory: { create: mocks.historyCreate, findFirst: mocks.historyFindFirst },
  cleanupStrike: { deleteMany: mocks.strikeDeleteMany }, fileOperationAudit: { create: mocks.auditCreate },
} }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/notification-service', () => ({ notifyEvent: vi.fn() }));
vi.mock('@/lib/service-helpers', () => ({
  getQBittorrentClient: mocks.getQBittorrentClient, getSonarrClients: mocks.getSonarrClients,
  getRadarrClients: mocks.getRadarrClients,
}));

import { runDownloadCleanerCycle } from '@/lib/cleanup/download-cleaner';
import { StaleCleanupPreviewError } from '@/lib/cleanup/binding';

const owner = { id: 'user-1', username: 'owner' };
const scheduler = { id: null, username: 'system:cleanup-scheduler' };

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

type HistoryRow = { eventType: string; date?: string; episodeId?: number };

function setSonarrHistory(result: { records: HistoryRow[] } | Error, queue: Array<{ downloadId: string; trackedDownloadState: string }> = []) {
  const getHistory = result instanceof Error ? vi.fn().mockRejectedValue(result) : vi.fn().mockResolvedValue(result);
  const getQueue = vi.fn().mockResolvedValue({ records: queue, totalRecords: queue.length });
  mocks.getSonarrClients.mockResolvedValue([{ connection: { id: 'sonarr-1' }, client: { getHistory, getQueue } }]);
  return { getHistory, getQueue };
}

// Sonarr's real history for the season pack removed on 2026-10-05: ten
// episodes grabbed, only the first one imported.
const PACK_ADDED_ON = Date.parse('2026-10-05T14:00:57Z') / 1000;
const PACK_EPISODES = Array.from({ length: 10 }, (_, i) => 11267 + i);
const packGrabs: HistoryRow[] = PACK_EPISODES.map((episodeId) => ({ eventType: 'grabbed', date: '2026-10-05T14:00:57Z', episodeId }));
const packImport = (episodeId: number): HistoryRow => ({ eventType: 'downloadFolderImported', date: '2026-10-05T14:08:02Z', episodeId });
const importedRule = () => rule({ id: 'system', name: 'Auto-remove imported (system)', privacyType: 'public', maxRatio: 0, requireImportedConfirmation: true, isSystem: true });
const packTorrent = () => torrent({ hash: '206a85e74fc5563c703d8d65b2e6df6d1fbc3ecb', ratio: 0.04, added_on: PACK_ADDED_ON });

// A qBittorrent double for real (non-dry-run) cycles: torrents stay listed
// until deleteTorrent removes them, so revalidation and the post-delete check
// see what a live client would.
function setRemovableTorrents(...torrents: QBittorrentTorrent[]) {
  const deleted = new Set<string>();
  const deleteTorrent = vi.fn(async (hash: string) => { deleted.add(hash); });
  mocks.getQBittorrentClient.mockResolvedValue({
    getTorrents: vi.fn(async (_filter?: string, _category?: string, _sort?: string, _reverse?: boolean, hash?: string) =>
      torrents.filter((t) => !deleted.has(t.hash) && (!hash || t.hash === hash))),
    getTorrentTrackers: vi.fn().mockResolvedValue([]),
    deleteTorrent,
  });
  return deleteTorrent;
}

const run = () => runDownloadCleanerCycle({ dryRun: true, triggeredBy: 'dryRun', actor: owner });

describe('download cleaner cycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configFindUnique.mockResolvedValue({ ...baseConfig }); mocks.ruleFindFirst.mockResolvedValue(null);
    mocks.ruleFindMany.mockResolvedValue([]); mocks.serviceFindMany.mockResolvedValue([]);
    mocks.getSonarrClients.mockResolvedValue([]); mocks.getRadarrClients.mockResolvedValue([]);
    mocks.historyCreate.mockResolvedValue({}); mocks.historyFindFirst.mockResolvedValue(null); mocks.strikeDeleteMany.mockResolvedValue({ count: 0 });
    mocks.auditCreate.mockResolvedValue({});
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
    const grab = { eventType: 'grabbed', date: new Date(addedOn * 1000).toISOString() };
    setSonarrHistory({ records: [{ eventType: 'downloadFolderImported', date: new Date().toISOString() }, grab] }); const result = await run();
    expect(result.decisions[0]).toMatchObject({ removalKind: 'imported', reason: expect.stringContaining('imported') });
    setSonarrHistory({ records: [grab] }); expect((await run()).decisions).toHaveLength(0);
    setSonarrHistory({ records: [] }); expect((await run()).decisions).toHaveLength(0);
  });

  it('asks the arrs only about torrents that already meet the rule threshold', async () => {
    mocks.ruleFindMany.mockResolvedValue([rule({ requireImportedConfirmation: true, maxRatio: 2 })]); setTorrents([torrent({ ratio: 1 })]);
    const { getHistory, getQueue } = setSonarrHistory(new Error('offline'));
    await expect(run()).resolves.toMatchObject({ decisions: [], warnings: [] });
    expect(getQueue).not.toHaveBeenCalled(); expect(getHistory).not.toHaveBeenCalled(); expect(mocks.historyCreate).not.toHaveBeenCalled();
  });

  it('ignores import events older than the current torrent grab', async () => {
    const addedOn = Date.now() / 1000 - 3600;
    mocks.ruleFindMany.mockResolvedValue([rule({ requireImportedConfirmation: true })]);
    setTorrents([torrent({ added_on: addedOn })]);
    // The grab is from an earlier life of this hash, as after a manual re-add.
    const earlierGrab = { eventType: 'grabbed', date: new Date((addedOn - 7200) * 1000).toISOString() };
    setSonarrHistory({ records: [{ eventType: 'downloadFolderImported', date: new Date((addedOn - 3600) * 1000).toISOString() }, earlierGrab] });
    expect((await run()).decisions).toHaveLength(0);
    setSonarrHistory({ records: [{ eventType: 'downloadFolderImported', date: new Date((addedOn + 60) * 1000).toISOString() }, earlierGrab] });
    expect((await run()).decisions).toHaveLength(1);
  });

  it('keeps a season pack whose episodes are not all imported', async () => {
    mocks.ruleFindMany.mockResolvedValue([importedRule()]);
    const deleteTorrent = setRemovableTorrents(packTorrent());
    setSonarrHistory({ records: [packImport(11267), ...packGrabs] });
    const result = await runDownloadCleanerCycle({ dryRun: false, triggeredBy: 'auto', actor: scheduler });
    expect(result.decisions).toHaveLength(0);
    expect(deleteTorrent).not.toHaveBeenCalled();
    expect(mocks.historyCreate).not.toHaveBeenCalled();
  });

  it('keeps an imported download no arr grabbed', async () => {
    mocks.ruleFindMany.mockResolvedValue([importedRule()]);
    const deleteTorrent = setRemovableTorrents(packTorrent());
    setSonarrHistory({ records: [packImport(11267)] });
    const result = await runDownloadCleanerCycle({ dryRun: false, triggeredBy: 'auto', actor: scheduler });
    expect(result.decisions).toHaveLength(0);
    expect(deleteTorrent).not.toHaveBeenCalled();
  });

  it('removes a season pack once every grabbed episode is imported', async () => {
    mocks.ruleFindMany.mockResolvedValue([importedRule()]);
    const deleteTorrent = setRemovableTorrents(packTorrent());
    setSonarrHistory({ records: [...PACK_EPISODES.map(packImport), ...packGrabs] });
    const result = await runDownloadCleanerCycle({ dryRun: false, triggeredBy: 'auto', actor: scheduler });
    expect(result).toMatchObject({ succeeded: 1, failed: 0 });
    expect(deleteTorrent).toHaveBeenCalledWith('206a85e74fc5563c703d8d65b2e6df6d1fbc3ecb', true);
    expect(mocks.auditCreate).toHaveBeenCalledOnce();
    expect(mocks.auditCreate.mock.calls[0][0].data).toMatchObject({
      userId: null, username: 'system:cleanup-scheduler', requestId: null, operation: 'DELETE_TORRENT', success: true,
      details: { triggeredBy: 'auto', previewId: null, hash: '206a85e74fc5563c703d8d65b2e6df6d1fbc3ecb' },
    });
    expect(mocks.historyCreate.mock.calls[0][0].data).toMatchObject({ triggeredBy: 'auto', actorUserId: null, actorUsername: 'system:cleanup-scheduler' });
  });

  it('reads each arr queue once for the evaluation pass and afresh before every removal', async () => {
    mocks.ruleFindMany.mockResolvedValue([importedRule()]);
    const deleteTorrent = setRemovableTorrents(packTorrent(), torrent({ hash: 'second', ratio: 0.5, added_on: PACK_ADDED_ON }), torrent({ hash: 'third', ratio: 0.5, added_on: PACK_ADDED_ON }));
    const { getQueue } = setSonarrHistory({ records: [...PACK_EPISODES.map(packImport), ...packGrabs] });
    const result = await runDownloadCleanerCycle({ dryRun: false, triggeredBy: 'auto', actor: scheduler });
    expect(result).toMatchObject({ succeeded: 3, failed: 0 });
    expect(deleteTorrent).toHaveBeenCalledTimes(3);
    expect(getQueue).toHaveBeenCalledTimes(1 + 3);
  });

  it('does not let an earlier removal\'s queue read vouch for a later one', async () => {
    mocks.ruleFindMany.mockResolvedValue([importedRule()]);
    const deleteTorrent = setRemovableTorrents(torrent({ hash: 'first', ratio: 0.5, added_on: PACK_ADDED_ON }), torrent({ hash: 'second', ratio: 0.5, added_on: PACK_ADDED_ON }));
    const { getQueue } = setSonarrHistory({ records: [...PACK_EPISODES.map(packImport), ...packGrabs] });
    // Evaluation and the first revalidation see an empty queue; by the second
    // revalidation the arr is working on both downloads again.
    const empty = { records: [], totalRecords: 0 };
    getQueue.mockResolvedValueOnce(empty).mockResolvedValueOnce(empty).mockResolvedValue({
      records: ['FIRST', 'SECOND'].map((downloadId) => ({ downloadId, trackedDownloadState: 'importBlocked' })), totalRecords: 2,
    });
    const result = await runDownloadCleanerCycle({ dryRun: false, triggeredBy: 'auto', actor: scheduler });
    expect(result).toMatchObject({ succeeded: 1, failed: 1 });
    expect(result.outcomes.map((o) => o.status).sort()).toEqual(['stale', 'succeeded']);
    expect(deleteTorrent).toHaveBeenCalledTimes(1);
  });

  it('keeps a download an arr queue still lists, whatever its history says', async () => {
    mocks.ruleFindMany.mockResolvedValue([importedRule()]);
    const deleteTorrent = setRemovableTorrents(packTorrent());
    const { getHistory } = setSonarrHistory(
      { records: [...PACK_EPISODES.map(packImport), ...packGrabs] },
      [{ downloadId: '206A85E74FC5563C703D8D65B2E6DF6D1FBC3ECB', trackedDownloadState: 'importBlocked' }],
    );
    const result = await runDownloadCleanerCycle({ dryRun: false, triggeredBy: 'auto', actor: scheduler });
    expect(result.decisions).toHaveLength(0);
    expect(deleteTorrent).not.toHaveBeenCalled();
    expect(getHistory).not.toHaveBeenCalled();
  });

  it('re-reads arr state before removing and skips a download that became unfinished', async () => {
    mocks.ruleFindMany.mockResolvedValue([importedRule()]);
    const deleteTorrent = setRemovableTorrents(packTorrent());
    const { getQueue } = setSonarrHistory({ records: [...PACK_EPISODES.map(packImport), ...packGrabs] });
    getQueue.mockResolvedValueOnce({ records: [], totalRecords: 0 }).mockResolvedValue({
      records: [{ downloadId: '206A85E74FC5563C703D8D65B2E6DF6D1FBC3ECB', trackedDownloadState: 'importPending' }], totalRecords: 1,
    });
    const result = await runDownloadCleanerCycle({ dryRun: false, triggeredBy: 'auto', actor: scheduler });
    expect(result.decisions).toHaveLength(1);
    expect(result.outcomes[0]).toMatchObject({ status: 'stale', action: 'skipped' });
    expect(deleteTorrent).not.toHaveBeenCalled();
    expect(getQueue).toHaveBeenCalledTimes(2);
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('audits a manual removal as the user who ran it, with the exact hash', async () => {
    mocks.ruleFindMany.mockResolvedValue([rule()]);
    const deleteTorrent = setRemovableTorrents(torrent());
    const preview = await run();
    expect(mocks.auditCreate).not.toHaveBeenCalled();

    const result = await runDownloadCleanerCycle({ dryRun: false, triggeredBy: 'manual', actor: owner, expectedBinding: preview.binding, previewId: 'preview-1' });

    expect(result).toMatchObject({ succeeded: 1, failed: 0 });
    expect(deleteTorrent).toHaveBeenCalledWith('ABC123', true);
    expect(mocks.auditCreate).toHaveBeenCalledOnce();
    const audit = mocks.auditCreate.mock.calls[0][0].data;
    expect(audit).toMatchObject({
      userId: 'user-1', username: 'owner', service: 'QBITTORRENT', instanceId: null, operation: 'DELETE_TORRENT',
      mediaType: 'torrent', mediaId: null, mediaTitle: 'Example', fileCount: 1, filesDeleted: true, success: true, errorMessage: null,
      details: {
        cleaner: 'download', triggeredBy: 'manual', previewId: 'preview-1', hash: 'abc123', rule: { id: 'rule-a', name: 'Seed rule' },
        deleteFiles: true, before: 'present', after: 'absent', callError: null,
      },
    });
    expect(audit.startedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(audit)).not.toMatch(/token/i);
    expect(mocks.historyCreate.mock.calls[0][0].data).toMatchObject({ previewId: 'preview-1', actorUserId: 'user-1', actorUsername: 'owner' });
  });

  it('deletes and audits nothing when the preview no longer matches', async () => {
    mocks.ruleFindMany.mockResolvedValue([rule()]);
    const deleteTorrent = setRemovableTorrents(torrent());
    const preview = await run();
    mocks.ruleFindMany.mockResolvedValue([rule({ maxRatio: 3 })]);

    await expect(runDownloadCleanerCycle({ dryRun: false, triggeredBy: 'manual', actor: owner, expectedBinding: preview.binding, previewId: 'preview-1' }))
      .rejects.toBeInstanceOf(StaleCleanupPreviewError);
    expect(deleteTorrent).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
    expect(mocks.historyCreate).not.toHaveBeenCalled();
  });

  it('deduplicates automatic dry-run preview history', async () => {
    mocks.ruleFindMany.mockResolvedValue([rule()]); setTorrents([torrent()]);
    await runDownloadCleanerCycle({ dryRun: true, triggeredBy: 'auto', actor: scheduler });
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'dryRunPreview', actorUserId: null, actorUsername: 'system:cleanup-scheduler' }) }));
    expect(mocks.auditCreate).not.toHaveBeenCalled();
    vi.clearAllMocks();
    mocks.configFindUnique.mockResolvedValue({ ...baseConfig }); mocks.serviceFindMany.mockResolvedValue([]);
    mocks.ruleFindMany.mockResolvedValue([rule()]); mocks.getSonarrClients.mockResolvedValue([]); mocks.getRadarrClients.mockResolvedValue([]);
    mocks.historyFindFirst.mockResolvedValue({ id: 'x' }); setTorrents([torrent()]);
    await runDownloadCleanerCycle({ dryRun: true, triggeredBy: 'auto', actor: scheduler });
    expect(mocks.historyCreate).not.toHaveBeenCalled();
  });

  it('records an unreachable import confirmation as skipped even in dry-run', async () => {
    mocks.ruleFindMany.mockResolvedValue([rule({ requireImportedConfirmation: true })]); setTorrents([torrent()]);
    setSonarrHistory(new Error('offline')); const result = await run();
    expect(result.decisions).toHaveLength(0);
    expect(mocks.historyCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'skipped', reason: expect.stringContaining('unreachable'), actorUserId: 'user-1', actorUsername: 'owner' }) }));
    expect(mocks.auditCreate).not.toHaveBeenCalled();
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
