import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QBittorrentTorrent, QueueItem } from '@/types';
import type { FailedImportConfig, StallRuleShape } from '@/lib/cleanup/types';

// The Queue Cleaner treats Lidarr exactly like Sonarr and Radarr: its queues
// link torrents, removals go through the instance that queued them, and every
// interactive and scheduled safety check covers it.

const mocks = vi.hoisted(() => ({
  configFindUnique: vi.fn(), stallFindMany: vi.fn(), slowFindMany: vi.fn(), strikeFindMany: vi.fn(),
  serviceFindMany: vi.fn(), historyCreate: vi.fn(), strikeDeleteMany: vi.fn(), auditCreate: vi.fn(),
  getQBittorrentClient: vi.fn(), getSonarrClients: vi.fn(), getRadarrClients: vi.fn(), getLidarrClients: vi.fn(),
  getSonarrClient: vi.fn(), getRadarrClient: vi.fn(), getLidarrClient: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: {
  queueCleanerConfig: { findUnique: mocks.configFindUnique },
  stallRule: { findMany: mocks.stallFindMany }, slowRule: { findMany: mocks.slowFindMany },
  cleanupStrike: { findMany: mocks.strikeFindMany, deleteMany: mocks.strikeDeleteMany },
  serviceConnection: { findMany: mocks.serviceFindMany }, cleanupHistory: { create: mocks.historyCreate },
  fileOperationAudit: { create: mocks.auditCreate },
} }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/notification-service', () => ({ notifyEvent: vi.fn() }));
vi.mock('@/lib/service-helpers', () => ({
  getQBittorrentClient: mocks.getQBittorrentClient,
  getSonarrClients: mocks.getSonarrClients, getRadarrClients: mocks.getRadarrClients, getLidarrClients: mocks.getLidarrClients,
  getSonarrClient: mocks.getSonarrClient, getRadarrClient: mocks.getRadarrClient, getLidarrClient: mocks.getLidarrClient,
}));

import { runQueueCleanerCycle } from '@/lib/cleanup/queue-cleaner';
import { StaleCleanupPreviewError } from '@/lib/cleanup/binding';

const owner = { id: 'user-1', username: 'owner' };
const scheduler = { id: null, username: 'system:cleanup-scheduler' };

const failedImportDefaults: FailedImportConfig = { maxStrikes: 0, ignorePrivate: false, deletePrivate: false, skipIfNotFoundInClient: true, patternMode: 'exclude', patterns: [], changeCategory: false };
const baseConfig = { enabled: true, intervalMinutes: 5, ignoredDownloads: [], processNoContentId: false, downloadingMetadataMaxStrikes: 0, failedImport: failedImportDefaults, reSearchAfterRemoval: true, autoRunMode: 'disabled' };

function torrent(overrides: Partial<QBittorrentTorrent> = {}): QBittorrentTorrent {
  return { hash: 'ABC123', name: 'Album torrent', size: 1024, progress: 0.5, dlspeed: 0, upspeed: 0, num_seeds: 0, num_leechs: 0, state: 'stalledDL', eta: 0, category: 'lidarr', tags: '', priority: 0, added_on: 0, completion_on: 0, save_path: '', amount_left: 0, completed: 0, downloaded: 1000, uploaded: 0, downloaded_session: 0, uploaded_session: 0, dl_limit: 0, up_limit: 0, magnet_uri: '', time_active: 0, seeding_time: 0, availability: 0, ratio: 0, seq_dl: false, f_l_piece_prio: false, force_start: false, auto_tmm: false, max_ratio: -1, max_seeding_time: -1, private: false, ...overrides };
}

const stall: StallRuleShape = { id: 'stall-a', name: 'Stalled rule', enabled: true, priority: 0, maxStrikes: 3, privacyType: 'both', minCompletionPercentage: 0, maxCompletionPercentage: 100, resetStrikesOnProgress: true, minimumProgressBytes: null, changeCategory: false, deletePrivate: false, reSearchOverride: null };

function strikeRecord(strikeType: string, ruleId: string | null, count: number) {
  return { id: `${strikeType}-${ruleId}`, hash: 'abc123', torrentName: 'Album torrent', strikeType, ruleId, count, lastDownloadedBytes: BigInt(1000), torrentAddedAt: null, lastSeenAt: new Date(), updatedAt: new Date() };
}

function albumQueue(overrides: Partial<QueueItem> = {}): QueueItem {
  return { id: 77, downloadId: 'ABC123', title: 'Artist - First Album', status: '', trackedDownloadStatus: 'ok', trackedDownloadState: 'downloading', statusMessages: [], errorMessage: '', timeleft: '', estimatedCompletionTime: '', size: 0, sizeleft: 0, protocol: 'torrent', downloadClient: 'qBittorrent', indexer: '', outputPath: '', downloadForced: false, artistId: 9, albumId: 31, album: { id: 31, title: 'First Album' } as QueueItem['album'], ...overrides };
}

const lidarrConnection = (id: string) => ({ id, label: id });

function listsLidarr(...instances: Array<{ id: string; items: QueueItem[] }>) {
  return instances.map(({ id, items }) => ({
    connection: lidarrConnection(id),
    client: { getQueue: vi.fn().mockResolvedValue({ records: items, totalRecords: items.length }) },
  }));
}

// qBittorrent lists the torrent until a removal deletes it from the client.
function qbitWithTorrent() {
  const state = { removed: false };
  mocks.getQBittorrentClient.mockResolvedValue({
    getTorrents: vi.fn(async () => (state.removed ? [] : [torrent()])),
    getTorrentTrackers: vi.fn().mockResolvedValue([]),
  });
  return state;
}

// The per-instance client the removal uses; its queue empties once deleted.
function lidarrInstanceClient(onDelete?: (id: number, options: { removeFromClient: boolean }) => void) {
  const removed = new Set<number>();
  const client = {
    deleteQueueItem: vi.fn(async (id: number, options: { removeFromClient: boolean }) => { removed.add(id); onDelete?.(id, options); }),
    getQueue: vi.fn(async () => ({ records: [albumQueue()].filter((item) => !removed.has(item.id)), totalRecords: removed.has(77) ? 0 : 1 })),
    searchAlbums: vi.fn().mockResolvedValue({ id: 1 }),
  };
  return client;
}

const preview = () => runQueueCleanerCycle({ dryRun: true, triggeredBy: 'dryRun', actor: owner });
const removalRows = () => mocks.historyCreate.mock.calls.map(([arg]) => arg.data).filter((row) => row.action !== 'strikeAdded');
const auditRows = () => mocks.auditCreate.mock.calls.map(([arg]) => arg.data);

describe('queue cleaner with Lidarr', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configFindUnique.mockResolvedValue({ ...baseConfig });
    mocks.stallFindMany.mockResolvedValue([stall]); mocks.slowFindMany.mockResolvedValue([]);
    mocks.strikeFindMany.mockResolvedValue([strikeRecord('stall', 'stall-a', 2)]);
    mocks.serviceFindMany.mockResolvedValue([]);
    mocks.getSonarrClients.mockResolvedValue([]); mocks.getRadarrClients.mockResolvedValue([]);
    mocks.getLidarrClients.mockResolvedValue(listsLidarr({ id: 'lidarr-2', items: [albumQueue()] }));
    mocks.historyCreate.mockResolvedValue({}); mocks.strikeDeleteMany.mockResolvedValue({ count: 0 });
    mocks.auditCreate.mockResolvedValue({});
  });

  it('links a stalled torrent to the Lidarr album that queued it and binds that link into the preview', async () => {
    qbitWithTorrent();
    const result = await preview();

    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].linked).toMatchObject({ source: 'lidarr', instanceId: 'lidarr-2', contentId: 31, title: 'First Album', queueItem: { id: 77, source: 'lidarr' } });
    expect(result.binding.candidates).toEqual([expect.objectContaining({
      cleaner: 'queue', hash: 'abc123', links: [{ source: 'lidarr', instanceId: 'lidarr-2', queueItemId: 77 }],
    })]);
    // An interactive preview changes nothing upstream.
    expect(mocks.getLidarrClient).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('removes through the Lidarr instance that queued it, re-searches the album, and records the outcome and audit', async () => {
    const qbit = qbitWithTorrent();
    const reviewed = await preview();
    // The executing cycle counts the third strike; the check before removal reads it back.
    mocks.strikeFindMany.mockResolvedValueOnce([strikeRecord('stall', 'stall-a', 2)]).mockResolvedValue([strikeRecord('stall', 'stall-a', 3)]);
    const lidarr = lidarrInstanceClient((_, options) => { if (options.removeFromClient) qbit.removed = true; });
    mocks.getLidarrClient.mockResolvedValue(lidarr);

    const result = await runQueueCleanerCycle({ dryRun: false, triggeredBy: 'manual', actor: owner, expectedBinding: reviewed.binding, previewId: 'preview-1' });

    expect(mocks.getLidarrClient).toHaveBeenCalledWith('lidarr-2');
    expect(mocks.getSonarrClient).not.toHaveBeenCalled();
    expect(mocks.getRadarrClient).not.toHaveBeenCalled();
    expect(lidarr.deleteQueueItem).toHaveBeenCalledWith(77, { removeFromClient: true, blocklist: true, changeCategory: false });
    expect(lidarr.searchAlbums).toHaveBeenCalledWith([31]);
    expect(result.outcomes).toEqual([expect.objectContaining({ status: 'succeeded', action: 'removedFromClient', filesDeleted: true, reSearched: true })]);
    expect(result.outcomes[0].targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: 'lidarr', instanceId: 'lidarr-2', queueItemId: 77, attempted: true, before: 'present', after: 'absent' }),
      expect.objectContaining({ target: 'qbittorrent', after: 'absent' }),
      expect.objectContaining({ target: 'reSearch', instanceId: 'lidarr-2', after: 'present' }),
    ]));
    expect(auditRows()).toEqual([expect.objectContaining({
      userId: 'user-1', username: 'owner', service: 'LIDARR', instanceId: 'lidarr-2', operation: 'REMOVE_QUEUE',
      mediaType: 'queue', mediaId: 77, filesDeleted: true, success: true, errorMessage: null,
      details: expect.objectContaining({ cleaner: 'queue', triggeredBy: 'manual', previewId: 'preview-1', queueItemId: 77, removeFromClient: true, blocklist: true, after: 'absent', clientAfter: 'absent' }),
    })]);
    expect(removalRows()).toEqual([expect.objectContaining({
      cleaner: 'queue', action: 'removedFromClient', outcomeStatus: 'succeeded', previewId: 'preview-1', triggeredBy: 'manual',
      linkedArrSource: 'lidarr', linkedArrTitle: 'First Album', linkedArrItemId: 77, reSearched: true,
      actorUserId: 'user-1', actorUsername: 'owner',
    })]);
  });

  it('skips the removal as stale when the Lidarr queue item is gone by the time it is revalidated', async () => {
    qbitWithTorrent();
    const reviewed = await preview();
    mocks.strikeFindMany.mockResolvedValueOnce([strikeRecord('stall', 'stall-a', 2)]).mockResolvedValue([strikeRecord('stall', 'stall-a', 3)]);
    // The executing cycle still sees the album queued; the re-check right before removal does not.
    mocks.getLidarrClients
      .mockResolvedValueOnce(listsLidarr({ id: 'lidarr-2', items: [albumQueue()] }))
      .mockResolvedValue(listsLidarr({ id: 'lidarr-2', items: [] }));
    const lidarr = lidarrInstanceClient();
    mocks.getLidarrClient.mockResolvedValue(lidarr);

    const result = await runQueueCleanerCycle({ dryRun: false, triggeredBy: 'manual', actor: owner, expectedBinding: reviewed.binding, previewId: 'preview-1' });

    expect(lidarr.deleteQueueItem).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
    expect(result.outcomes).toEqual([expect.objectContaining({ status: 'stale', action: 'skipped', message: 'Cleanup action or linked queue scope changed after preview' })]);
    expect(removalRows()).toEqual([expect.objectContaining({ outcomeStatus: 'stale', action: 'skipped', previewId: 'preview-1' })]);
  });

  it('fails the removal closed when a Lidarr queue cannot be read during revalidation', async () => {
    qbitWithTorrent();
    const reviewed = await preview();
    mocks.strikeFindMany.mockResolvedValueOnce([strikeRecord('stall', 'stall-a', 2)]).mockResolvedValue([strikeRecord('stall', 'stall-a', 3)]);
    mocks.getLidarrClients
      .mockResolvedValueOnce(listsLidarr({ id: 'lidarr-2', items: [albumQueue()] }))
      .mockResolvedValue([{ connection: lidarrConnection('lidarr-2'), client: { getQueue: vi.fn().mockRejectedValue(new Error('offline')) } }]);
    const lidarr = lidarrInstanceClient();
    mocks.getLidarrClient.mockResolvedValue(lidarr);

    const result = await runQueueCleanerCycle({ dryRun: false, triggeredBy: 'manual', actor: owner, expectedBinding: reviewed.binding, previewId: 'preview-1' });

    expect(lidarr.deleteQueueItem).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
    expect(result.outcomes).toEqual([expect.objectContaining({ status: 'failed', action: 'failed', message: 'Could not revalidate all configured Arr queues' })]);
  });

  it('refuses a preview once a Lidarr connection changes', async () => {
    qbitWithTorrent();
    // Answer only the connection types the scope fingerprint asks for.
    let connections = [{ id: 'lidarr-2', type: 'LIDARR', isDefault: true, updatedAt: new Date(1000) }];
    mocks.serviceFindMany.mockImplementation(async (args: { where: { type: { in: string[] } } }) =>
      connections.filter((connection) => args.where.type.in.includes(connection.type)));
    const reviewed = await preview();
    connections = [{ ...connections[0], updatedAt: new Date(2000) }];
    mocks.getLidarrClient.mockResolvedValue(lidarrInstanceClient());

    await expect(runQueueCleanerCycle({ dryRun: false, triggeredBy: 'manual', actor: owner, expectedBinding: reviewed.binding, previewId: 'preview-1' }))
      .rejects.toBeInstanceOf(StaleCleanupPreviewError);
    expect(mocks.getLidarrClient).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
    expect(mocks.historyCreate).not.toHaveBeenCalled();
  });

  it('aborts the whole cycle fail-safe when a Lidarr queue cannot be read', async () => {
    qbitWithTorrent();
    mocks.getLidarrClients.mockResolvedValue([{ connection: lidarrConnection('lidarr-2'), client: { getQueue: vi.fn().mockRejectedValue(new Error('offline')) } }]);
    await expect(preview()).resolves.toMatchObject({ decisions: [], pendingStrikes: [], warnings: [expect.stringContaining('Lidarr')] });
  });

  it('removes on the scheduled path as the cleanup scheduler without a preview token', async () => {
    const qbit = qbitWithTorrent();
    const lidarr = lidarrInstanceClient((_, options) => { if (options.removeFromClient) qbit.removed = true; });
    mocks.getLidarrClient.mockResolvedValue(lidarr);
    mocks.strikeFindMany.mockResolvedValueOnce([strikeRecord('stall', 'stall-a', 2)]).mockResolvedValue([strikeRecord('stall', 'stall-a', 3)]);

    const result = await runQueueCleanerCycle({ dryRun: false, triggeredBy: 'auto', actor: scheduler });

    expect(lidarr.deleteQueueItem).toHaveBeenCalledWith(77, { removeFromClient: true, blocklist: true, changeCategory: false });
    expect(result.outcomes).toEqual([expect.objectContaining({ status: 'succeeded' })]);
    expect(auditRows()).toEqual([expect.objectContaining({
      userId: null, username: 'system:cleanup-scheduler', service: 'LIDARR', instanceId: 'lidarr-2', success: true,
      details: expect.objectContaining({ triggeredBy: 'auto', previewId: null }),
    })]);
    expect(removalRows()).toEqual([expect.objectContaining({ triggeredBy: 'auto', linkedArrSource: 'lidarr', actorUserId: null, actorUsername: 'system:cleanup-scheduler' })]);
  });

  it('removes the hash from every Lidarr instance that queued it, each audited under its own instance', async () => {
    const qbit = qbitWithTorrent();
    mocks.getLidarrClients.mockResolvedValue(listsLidarr(
      { id: 'lidarr-2', items: [albumQueue()] },
      { id: 'lidarr-3', items: [albumQueue()] },
    ));
    const clients = {
      'lidarr-2': lidarrInstanceClient((_, options) => { if (options.removeFromClient) qbit.removed = true; }),
      'lidarr-3': lidarrInstanceClient(),
    };
    mocks.getLidarrClient.mockImplementation(async (instanceId: 'lidarr-2' | 'lidarr-3') => clients[instanceId]);
    mocks.strikeFindMany.mockResolvedValueOnce([strikeRecord('stall', 'stall-a', 2)]).mockResolvedValue([strikeRecord('stall', 'stall-a', 3)]);

    const result = await runQueueCleanerCycle({ dryRun: false, triggeredBy: 'auto', actor: scheduler });

    // Only the first call takes the torrent and its data with it.
    expect(clients['lidarr-2'].deleteQueueItem).toHaveBeenCalledWith(77, { removeFromClient: true, blocklist: true, changeCategory: false });
    expect(clients['lidarr-3'].deleteQueueItem).toHaveBeenCalledWith(77, { removeFromClient: false, blocklist: true, changeCategory: false });
    expect(auditRows().map((row) => [row.service, row.instanceId, row.success])).toEqual([['LIDARR', 'lidarr-2', true], ['LIDARR', 'lidarr-3', true]]);
    expect(result.outcomes).toEqual([expect.objectContaining({ status: 'succeeded' })]);
  });

  it.each([
    ['importFailed', 'warning'],
    ['downloadFailed', 'warning'],
    ['downloadFailedPending', 'warning'],
    ['importBlocked', 'warning'],
  ])('strikes a failed Lidarr import in its %s state', async (trackedDownloadState, trackedDownloadStatus) => {
    qbitWithTorrent();
    mocks.stallFindMany.mockResolvedValue([]);
    mocks.configFindUnique.mockResolvedValue({ ...baseConfig, failedImport: { ...failedImportDefaults, maxStrikes: 3 } });
    mocks.strikeFindMany.mockResolvedValue([strikeRecord('failedImport', null, 2)]);
    mocks.getLidarrClients.mockResolvedValue(listsLidarr({ id: 'lidarr-2', items: [albumQueue({ trackedDownloadState, trackedDownloadStatus })] }));
    expect((await preview()).decisions).toEqual([expect.objectContaining({ strikeType: 'failedImport', strikeCount: 3, linked: expect.objectContaining({ source: 'lidarr', instanceId: 'lidarr-2' }) })]);
  });

  it('skips a failed Lidarr import with no album unless configured to process it', async () => {
    qbitWithTorrent();
    mocks.stallFindMany.mockResolvedValue([]);
    mocks.strikeFindMany.mockResolvedValue([strikeRecord('failedImport', null, 2)]);
    mocks.getLidarrClients.mockResolvedValue(listsLidarr({ id: 'lidarr-2', items: [albumQueue({ trackedDownloadState: 'importFailed', trackedDownloadStatus: 'warning', albumId: undefined, album: undefined })] }));
    mocks.configFindUnique.mockResolvedValue({ ...baseConfig, failedImport: { ...failedImportDefaults, maxStrikes: 3 } });
    expect(await preview()).toMatchObject({ decisions: [], pendingStrikes: [] });

    mocks.configFindUnique.mockResolvedValue({ ...baseConfig, processNoContentId: true, failedImport: { ...failedImportDefaults, maxStrikes: 3 } });
    expect((await preview()).decisions).toEqual([expect.objectContaining({ strikeType: 'failedImport', linked: expect.objectContaining({ source: 'lidarr', contentId: null }) })]);
  });

  it('re-searches every album a multi-album torrent queued and succeeds when Lidarr already dropped the second item', async () => {
    const qbit = qbitWithTorrent();
    const second = albumQueue({ id: 78, albumId: 32, album: { id: 32, title: 'Second Album' } as QueueItem['album'] });
    mocks.getLidarrClients.mockResolvedValue(listsLidarr({ id: 'lidarr-2', items: [albumQueue(), second] }));
    // Removing the first item takes the whole download, so the second is
    // already gone from the queue and its own delete is refused.
    let downloadRemoved = false;
    const lidarr = {
      deleteQueueItem: vi.fn(async (id: number, options: { removeFromClient: boolean }) => {
        if (downloadRemoved) throw new Error('Lidarr API error: 404 Not Found');
        downloadRemoved = true;
        if (options.removeFromClient) qbit.removed = true;
      }),
      getQueue: vi.fn(async () => (downloadRemoved ? { records: [], totalRecords: 0 } : { records: [albumQueue(), second], totalRecords: 2 })),
      searchAlbums: vi.fn().mockResolvedValue({ id: 1 }),
    };
    mocks.getLidarrClient.mockResolvedValue(lidarr);
    mocks.strikeFindMany.mockResolvedValueOnce([strikeRecord('stall', 'stall-a', 2)]).mockResolvedValue([strikeRecord('stall', 'stall-a', 3)]);

    const result = await runQueueCleanerCycle({ dryRun: false, triggeredBy: 'auto', actor: scheduler });

    expect(lidarr.deleteQueueItem.mock.calls.map(([id, options]) => [id, options.removeFromClient])).toEqual([[77, true], [78, false]]);
    expect(lidarr.searchAlbums).toHaveBeenCalledWith([31, 32]);
    expect(result.outcomes).toEqual([expect.objectContaining({ status: 'succeeded', action: 'removedFromClient', reSearched: true })]);
    expect(auditRows().map((row) => [row.mediaId, row.success])).toEqual([[77, true], [78, true]]);
  });
});
