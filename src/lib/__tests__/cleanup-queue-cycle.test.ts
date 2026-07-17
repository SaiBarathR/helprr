import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QBittorrentTorrent, QueueItem } from '@/types';
import type { FailedImportConfig, SlowRuleShape, StallRuleShape } from '@/lib/cleanup/types';

const mocks = vi.hoisted(() => ({
  configFindUnique: vi.fn(), stallFindMany: vi.fn(), slowFindMany: vi.fn(), strikeFindMany: vi.fn(),
  serviceFindMany: vi.fn(), historyCreate: vi.fn(), strikeDeleteMany: vi.fn(),
  getQBittorrentClient: vi.fn(), getSonarrClients: vi.fn(), getRadarrClients: vi.fn(),
  getSonarrClient: vi.fn(), getRadarrClient: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: {
  queueCleanerConfig: { findUnique: mocks.configFindUnique },
  stallRule: { findMany: mocks.stallFindMany }, slowRule: { findMany: mocks.slowFindMany },
  cleanupStrike: { findMany: mocks.strikeFindMany, deleteMany: mocks.strikeDeleteMany },
  serviceConnection: { findMany: mocks.serviceFindMany }, cleanupHistory: { create: mocks.historyCreate },
} }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/notification-service', () => ({ notifyEvent: vi.fn() }));
vi.mock('@/lib/service-helpers', () => ({
  getQBittorrentClient: mocks.getQBittorrentClient, getSonarrClients: mocks.getSonarrClients,
  getRadarrClients: mocks.getRadarrClients, getSonarrClient: mocks.getSonarrClient,
  getRadarrClient: mocks.getRadarrClient,
}));

import { runQueueCleanerCycle } from '@/lib/cleanup/queue-cleaner';

const failedImportDefaults: FailedImportConfig = { maxStrikes: 0, ignorePrivate: false, deletePrivate: false, skipIfNotFoundInClient: true, patternMode: 'exclude', patterns: [], changeCategory: false };
const baseConfig = { enabled: true, intervalMinutes: 5, ignoredDownloads: [], processNoContentId: false, downloadingMetadataMaxStrikes: 0, failedImport: failedImportDefaults, reSearchAfterRemoval: true, autoRunMode: 'disabled' };

function torrent(overrides: Partial<QBittorrentTorrent> = {}): QBittorrentTorrent {
  return { hash: 'ABC123', name: 'Example', size: 1024, progress: 0.5, dlspeed: 0, upspeed: 0, num_seeds: 0, num_leechs: 0, state: 'stalledDL', eta: 0, category: '', tags: '', priority: 0, added_on: 0, completion_on: 0, save_path: '', amount_left: 0, completed: 0, downloaded: 1000, uploaded: 0, downloaded_session: 0, uploaded_session: 0, dl_limit: 0, up_limit: 0, magnet_uri: '', time_active: 0, seeding_time: 0, availability: 0, ratio: 0, seq_dl: false, f_l_piece_prio: false, force_start: false, auto_tmm: false, max_ratio: -1, max_seeding_time: -1, private: false, ...overrides };
}

function stall(overrides: Partial<StallRuleShape> = {}): StallRuleShape {
  return { id: 'stall-a', name: 'Stalled rule', enabled: true, priority: 0, maxStrikes: 3, privacyType: 'both', minCompletionPercentage: 0, maxCompletionPercentage: 100, resetStrikesOnProgress: true, minimumProgressBytes: null, changeCategory: false, deletePrivate: false, reSearchOverride: null, ...overrides };
}

function slow(overrides: Partial<SlowRuleShape> = {}): SlowRuleShape {
  return { id: 'slow-a', name: 'Slow rule', enabled: true, priority: 0, maxStrikes: 3, privacyType: 'both', minCompletionPercentage: 0, maxCompletionPercentage: 100, minSpeedKbps: 100, maxTimeHours: null, ignoreAboveSizeBytes: null, resetStrikesOnProgress: true, changeCategory: false, deletePrivate: false, reSearchOverride: null, ...overrides };
}

function strikeRecord(strikeType: string, ruleId: string | null, count = 2, lastDownloadedBytes: bigint | null = BigInt(1000)) {
  return { id: `${strikeType}-${ruleId}`, hash: 'abc123', torrentName: 'Example', strikeType, ruleId, count, lastDownloadedBytes, lastSeenAt: new Date(), updatedAt: new Date() };
}

function queue(overrides: Partial<QueueItem> = {}): QueueItem {
  return { id: 1, downloadId: 'ABC123', title: 'Show', status: '', trackedDownloadStatus: 'warning', trackedDownloadState: 'importBlocked', statusMessages: [], errorMessage: '', timeleft: '', estimatedCompletionTime: '', size: 0, sizeleft: 0, protocol: '', downloadClient: '', indexer: '', outputPath: '', downloadForced: false, seriesId: 5, ...overrides };
}

function setTorrents(torrents: QBittorrentTorrent[]) {
  mocks.getQBittorrentClient.mockResolvedValue({ getTorrents: vi.fn().mockResolvedValue(torrents), getTorrentTrackers: vi.fn().mockResolvedValue([]) });
}

function setTorrentsWithTrackerFailure(torrents: QBittorrentTorrent[]) {
  mocks.getQBittorrentClient.mockResolvedValue({ getTorrents: vi.fn().mockResolvedValue(torrents), getTorrentTrackers: vi.fn().mockRejectedValue(new Error('tracker offline')) });
}

function setSonarrQueue(items: QueueItem[] | Error) {
  const getQueue = items instanceof Error ? vi.fn().mockRejectedValue(items) : vi.fn().mockResolvedValue({ records: items, totalRecords: items.length });
  mocks.getSonarrClients.mockResolvedValue([{ connection: { id: 'sonarr-1', label: 'Sonarr' }, client: { getQueue } }]);
}

const run = () => runQueueCleanerCycle({ dryRun: true, triggeredBy: 'dryRun' });

describe('queue cleaner cycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configFindUnique.mockResolvedValue({ ...baseConfig });
    mocks.stallFindMany.mockResolvedValue([]); mocks.slowFindMany.mockResolvedValue([]);
    mocks.strikeFindMany.mockResolvedValue([]); mocks.serviceFindMany.mockResolvedValue([]);
    mocks.getSonarrClients.mockResolvedValue([]); mocks.getRadarrClients.mockResolvedValue([]);
    mocks.historyCreate.mockResolvedValue({}); mocks.strikeDeleteMany.mockResolvedValue({ count: 0 });
    setTorrents([]);
  });

  it('short-circuits disabled and unavailable qBittorrent cycles', async () => {
    mocks.configFindUnique.mockResolvedValue({ ...baseConfig, enabled: false });
    expect(await run()).toMatchObject({ decisions: [], warnings: ['Queue Cleaner is disabled'] });
    expect(mocks.getQBittorrentClient).not.toHaveBeenCalled();
    mocks.configFindUnique.mockResolvedValue({ ...baseConfig });
    mocks.getQBittorrentClient.mockRejectedValue(new Error('offline'));
    await expect(run()).resolves.toMatchObject({ decisions: [], pendingStrikes: [] });
  });

  it('aborts fail-safe when an Arr queue fetch fails', async () => {
    setTorrents([torrent()]); mocks.stallFindMany.mockResolvedValue([stall()]);
    setSonarrQueue(new Error('offline'));
    await expect(run()).resolves.toMatchObject({ decisions: [], pendingStrikes: [], warnings: [expect.stringContaining('Sonarr/Radarr')] });
  });

  it('increments a stall strike and decides at the threshold', async () => {
    setTorrents([torrent()]); mocks.stallFindMany.mockResolvedValue([stall()]);
    let result = await run();
    expect(result.pendingStrikes).toEqual([expect.objectContaining({ count: 1, ruleId: 'stall-a' })]);
    expect(result.decisions).toHaveLength(0);
    mocks.strikeFindMany.mockResolvedValue([strikeRecord('stall', 'stall-a')]);
    result = await run();
    expect(result.decisions[0]).toMatchObject({ strikeCount: 3, reason: expect.stringContaining('Stalled rule'), options: { reSearch: true, changeCategory: false, deletePrivate: false } });
  });

  it('respects stall privacy and completion ranges', async () => {
    mocks.stallFindMany.mockResolvedValue([stall({ privacyType: 'public' })]); setTorrents([torrent({ private: true })]);
    expect((await run()).pendingStrikes).toHaveLength(0);
    mocks.stallFindMany.mockResolvedValue([stall({ minCompletionPercentage: 1, maxCompletionPercentage: 40 })]); setTorrents([torrent({ progress: 0.5 })]);
    expect((await run()).pendingStrikes).toHaveLength(0);
  });

  it('clears progressed stall strikes unless the byte minimum is unmet', async () => {
    mocks.strikeFindMany.mockResolvedValue([strikeRecord('stall', 'stall-a', 2, BigInt(1000))]);
    mocks.stallFindMany.mockResolvedValue([stall()]); setTorrents([torrent({ downloaded: 2000 })]);
    await expect(run()).resolves.toMatchObject({ decisions: [], pendingStrikes: [] });
    mocks.stallFindMany.mockResolvedValue([stall({ minimumProgressBytes: 5000 })]);
    expect((await run()).decisions).toEqual([expect.objectContaining({ strikeType: 'stall', strikeCount: 3 })]);
  });

  it('strikes only slow downloading states below speed and below the size ceiling', async () => {
    mocks.slowFindMany.mockResolvedValue([slow()]); setTorrents([torrent({ state: 'downloading', dlspeed: 50 * 1024 })]);
    expect((await run()).pendingStrikes).toHaveLength(1);
    setTorrents([torrent({ state: 'downloading', dlspeed: 200 * 1024 })]); expect((await run()).pendingStrikes).toHaveLength(0);
    setTorrents([torrent({ state: 'uploading', progress: 1, dlspeed: 0 })]); expect((await run()).pendingStrikes).toHaveLength(0);
    mocks.slowFindMany.mockResolvedValue([slow({ ignoreAboveSizeBytes: 1024 ** 3 })]); setTorrents([torrent({ state: 'downloading', dlspeed: 0, size: 2 * 1024 ** 3 })]);
    expect((await run()).pendingStrikes).toHaveLength(0);
  });

  it('gates max-time slow rules to active download states', async () => {
    mocks.slowFindMany.mockResolvedValue([slow({ minSpeedKbps: null, maxTimeHours: 1 })]);
    setTorrents([torrent({ state: 'uploading', progress: 1, time_active: 7200 })]);
    await expect(run()).resolves.toMatchObject({ pendingStrikes: [], decisions: [] });
    setTorrents([torrent({ state: 'downloading', progress: 0.5, time_active: 7200 })]);
    expect((await run()).pendingStrikes).toEqual([expect.objectContaining({ strikeType: 'slow' })]);
  });

  it('uses the first matching rule and deduplicates stall before slow', async () => {
    mocks.stallFindMany.mockResolvedValue([stall({ id: 'a', priority: 0 }), stall({ id: 'b', priority: 1 })]);
    mocks.strikeFindMany.mockResolvedValue([strikeRecord('stall', 'a', 1)]); setTorrents([torrent()]);
    expect((await run()).pendingStrikes).toEqual([expect.objectContaining({ ruleId: 'a' })]);
    mocks.stallFindMany.mockResolvedValue([stall()]); mocks.slowFindMany.mockResolvedValue([slow()]);
    mocks.strikeFindMany.mockResolvedValue([strikeRecord('stall', 'stall-a'), strikeRecord('slow', 'slow-a')]);
    const result = await run();
    expect(result.decisions).toHaveLength(1); expect(result.decisions[0].strikeType).toBe('stall');
  });

  it('handles metadata strikes and ignored downloads', async () => {
    mocks.configFindUnique.mockResolvedValue({ ...baseConfig, downloadingMetadataMaxStrikes: 3 });
    mocks.strikeFindMany.mockResolvedValue([strikeRecord('downloadingMetadata', null)]); setTorrents([torrent({ state: 'metaDL' })]);
    expect((await run()).decisions[0]).toMatchObject({ strikeType: 'downloadingMetadata', options: { changeCategory: false, deletePrivate: false, reSearch: true } });
    mocks.configFindUnique.mockResolvedValue({ ...baseConfig, ignoredDownloads: ['my-tag'] }); mocks.stallFindMany.mockResolvedValue([stall()]);
    setTorrents([torrent({ tags: 'my-tag, other' })]); await expect(run()).resolves.toMatchObject({ decisions: [], pendingStrikes: [] });
  });

  it('treats forced metadata downloads like regular metadata downloads', async () => {
    mocks.configFindUnique.mockResolvedValue({ ...baseConfig, downloadingMetadataMaxStrikes: 3 });
    mocks.strikeFindMany.mockResolvedValue([strikeRecord('downloadingMetadata', null)]);
    setTorrents([torrent({ state: 'forcedMetaDL' })]);
    expect((await run()).decisions[0]).toMatchObject({ strikeType: 'downloadingMetadata' });
  });

  it('fails closed on tracker lookup only when ignore matching is configured', async () => {
    mocks.stallFindMany.mockResolvedValue([stall()]);
    mocks.configFindUnique.mockResolvedValue({ ...baseConfig, ignoredDownloads: ['private.example'] });
    setTorrentsWithTrackerFailure([torrent()]);
    await expect(run()).resolves.toMatchObject({ pendingStrikes: [], decisions: [], warnings: [expect.stringContaining('tracker')] });
    mocks.configFindUnique.mockResolvedValue({ ...baseConfig, ignoredDownloads: [] });
    setTorrentsWithTrackerFailure([torrent()]);
    const result = await run();
    expect(result.pendingStrikes).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it('fails closed when a public stall rule sees unknown privacy', async () => {
    mocks.stallFindMany.mockResolvedValue([stall({ privacyType: 'public' })]);
    const withoutPrivate = { ...torrent() } as Record<string, unknown>;
    delete withoutPrivate.private;
    setTorrents([withoutPrivate as unknown as QBittorrentTorrent]);
    await expect(run()).resolves.toMatchObject({ pendingStrikes: [], decisions: [] });
  });

  it('strikes failed imports and honors issue and pattern filters', async () => {
    mocks.configFindUnique.mockResolvedValue({ ...baseConfig, failedImport: { ...failedImportDefaults, maxStrikes: 3 } });
    mocks.strikeFindMany.mockResolvedValue([strikeRecord('failedImport', null)]); setTorrents([torrent()]); setSonarrQueue([queue()]);
    expect((await run()).decisions[0]).toMatchObject({ strikeType: 'failedImport' });
    setSonarrQueue([queue({ trackedDownloadState: 'downloading', trackedDownloadStatus: 'ok' })]); expect((await run()).pendingStrikes).toHaveLength(0);
    mocks.configFindUnique.mockResolvedValue({ ...baseConfig, failedImport: { ...failedImportDefaults, maxStrikes: 3, patternMode: 'include', patterns: ['title mismatch'] } });
    setSonarrQueue([queue({ errorMessage: 'Some other error' })]); expect((await run()).pendingStrikes).toHaveLength(0);
    setSonarrQueue([queue({ errorMessage: 'Found title mismatch for episode' })]); expect((await run()).decisions[0].strikeType).toBe('failedImport');
  });

  it('applies failed-import skip conditions', async () => {
    mocks.configFindUnique.mockResolvedValue({ ...baseConfig, failedImport: { ...failedImportDefaults, maxStrikes: 3 } });
    setTorrents([torrent()]); setSonarrQueue([queue({ downloadId: 'OTHER' })]);
    // SPEC-MISMATCH: the spec expected skippedFailedImport to increment when the queue hash is not in qBittorrent, but uncorrelated queue items are never evaluated.
    await expect(run()).resolves.toMatchObject({ skippedFailedImport: 0, pendingStrikes: [] });
    mocks.configFindUnique.mockResolvedValue({ ...baseConfig, failedImport: { ...failedImportDefaults, maxStrikes: 3, ignorePrivate: true } });
    setTorrents([torrent({ private: true })]); setSonarrQueue([queue()]); await expect(run()).resolves.toMatchObject({ skippedFailedImport: 1, pendingStrikes: [] });
    const withoutPrivate = { ...torrent() } as Record<string, unknown>;
    delete withoutPrivate.private;
    setTorrents([withoutPrivate as unknown as QBittorrentTorrent]); setSonarrQueue([queue()]); await expect(run()).resolves.toMatchObject({ skippedFailedImport: 1, pendingStrikes: [] });
    mocks.configFindUnique.mockResolvedValue({ ...baseConfig, failedImport: { ...failedImportDefaults, maxStrikes: 3 } });
    setTorrents([torrent()]); setSonarrQueue([queue({ seriesId: undefined })]); await expect(run()).resolves.toMatchObject({ skippedFailedImport: 0, pendingStrikes: [] });
  });

  it('builds deterministic queue bindings from decisions', async () => {
    mocks.stallFindMany.mockResolvedValue([stall()]); mocks.strikeFindMany.mockResolvedValue([strikeRecord('stall', 'stall-a')]); setTorrents([torrent()]);
    const first = await run(); const second = await run();
    expect(first.binding.cleaner).toBe('queue'); expect(first.binding.candidates).toHaveLength(first.decisions.length);
    expect(second.binding).toMatchObject({ configFingerprint: first.binding.configFingerprint, candidatesFingerprint: first.binding.candidatesFingerprint });
  });

  it('returns no warnings for a normal run', async () => {
    expect((await run()).warnings).toEqual([]);
  });
});
