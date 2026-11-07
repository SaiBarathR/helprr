import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capability } from '@/lib/capabilities';
import { ConfigurationError } from '@/lib/config-error';

const mocks = vi.hoisted(() => ({
  getQBittorrentClient: vi.fn(),
  getJellyfinClient: vi.fn(),
  getRadarrClients: vi.fn(),
  getSonarrClients: vi.fn(),
  getLidarrClients: vi.fn(),
  getQueueCached: vi.fn(),
  fetchEvents: vi.fn(),
  getCachedJson: vi.fn(),
  setCachedJson: vi.fn(),
  notificationCount: vi.fn(),
}));

vi.mock('@/lib/service-helpers', () => ({
  getQBittorrentClient: mocks.getQBittorrentClient,
  getJellyfinClient: mocks.getJellyfinClient,
  getRadarrClients: mocks.getRadarrClients,
  getSonarrClients: mocks.getSonarrClients,
  getLidarrClients: mocks.getLidarrClients,
}));
vi.mock('@/lib/activity-queue', () => ({ getQueueCached: mocks.getQueueCached }));
vi.mock('@/lib/calendar-events', () => ({ fetchServiceCalendarEvents: mocks.fetchEvents }));
vi.mock('@/lib/cache/json-cache', () => ({ getCachedJson: mocks.getCachedJson, setCachedJson: mocks.setCachedJson }));
vi.mock('@/lib/db', () => ({ prisma: { notificationHistory: { count: mocks.notificationCount } } }));

import { buildStatusQueue, buildStatusSummary, toStatusQueueItem } from '@/lib/status-api';
import type { User } from '@prisma/client';
import type { QueueItem } from '@/types';

const NOW = new Date('2026-11-07T10:00:00Z');
const USER = { id: 'u1', role: 'member' } as User;
const ALL: Capability[] = [
  'activity.view', 'torrents.view', 'movies.view', 'series.view', 'music.view',
  'calendar.view', 'jellyfin.sessions', 'notifications.view',
];

function disk(path: string, free: number, total: number, label = '') {
  return { path, label, freeSpace: free, totalSpace: total };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCachedJson.mockResolvedValue(null);
  mocks.getQBittorrentClient.mockResolvedValue({
    getTorrents: async () => [{ state: 'downloading' }, { state: 'stalledDL' }, { state: 'uploading' }],
    getTransferInfo: async () => ({ dl_info_speed: 1000, up_info_speed: 50 }),
  });
  mocks.getJellyfinClient.mockResolvedValue({ getActiveSessions: async () => [{}, {}] });
  mocks.getRadarrClients.mockResolvedValue([{ client: { getDiskSpace: async () => [disk('/movies', 100, 1000, 'uuid-a')] } }]);
  mocks.getSonarrClients.mockResolvedValue([{ client: { getDiskSpace: async () => [disk('/tv', 200, 2000, 'uuid-b')] } }]);
  mocks.getLidarrClients.mockResolvedValue([]);
  mocks.getQueueCached.mockResolvedValue({ records: [], totalRecords: 7 });
  mocks.fetchEvents.mockResolvedValue({
    cacheable: true,
    events: [
      { type: 'episode', title: 'Past', subtitle: 'S01E01', date: '2026-11-07T09:00:00Z' },
      { type: 'episode', title: 'A', subtitle: 'S01E02', date: '2026-11-08T00:00:00Z', images: [], instanceId: 'x' },
      { type: 'movie', title: 'B', subtitle: '2026', date: '2026-11-09T00:00:00Z' },
      { type: 'album', title: 'C', subtitle: 'LP', date: '2026-11-10T00:00:00Z' },
      { type: 'movie', title: 'D', subtitle: '2026', date: '2026-11-11T00:00:00Z' },
    ],
  });
  mocks.notificationCount.mockResolvedValue(4);
});

describe('buildStatusSummary', () => {
  it('has every section for every scope', async () => {
    const summary = await buildStatusSummary(USER, new Set(ALL), NOW);
    expect(summary).toEqual({
      version: 1,
      generatedAt: NOW.toISOString(),
      downloads: { downloading: 2, downloadSpeed: 1000, uploadSpeed: 50 },
      queue: { total: 7 },
      storage: {
        freeBytes: 300,
        totalBytes: 3000,
        disks: [
          { path: '/movies', label: 'uuid-a', freeBytes: 100, totalBytes: 1000 },
          { path: '/tv', label: 'uuid-b', freeBytes: 200, totalBytes: 2000 },
        ],
      },
      // The next three from now: the past one is left out, and only what a summary needs.
      upcoming: [
        { type: 'episode', title: 'A', subtitle: 'S01E02', date: '2026-11-08T00:00:00Z' },
        { type: 'movie', title: 'B', subtitle: '2026', date: '2026-11-09T00:00:00Z' },
        { type: 'album', title: 'C', subtitle: 'LP', date: '2026-11-10T00:00:00Z' },
      ],
      streams: { active: 2 },
      alerts: { unread: 4 },
    });
  });

  it('leaves out every section the scopes do not allow, and reads nothing for it', async () => {
    const summary = await buildStatusSummary(USER, new Set<Capability>(['activity.view']), NOW);
    expect(summary).toEqual({ version: 1, generatedAt: NOW.toISOString(), queue: { total: 7 } });
    expect(mocks.getQBittorrentClient).not.toHaveBeenCalled();
    expect(mocks.getJellyfinClient).not.toHaveBeenCalled();
    expect(mocks.fetchEvents).not.toHaveBeenCalled();
    expect(mocks.notificationCount).not.toHaveBeenCalled();
    expect(mocks.getRadarrClients).not.toHaveBeenCalled();
  });

  it('shows only the disks of the apps the scopes allow', async () => {
    const summary = await buildStatusSummary(USER, new Set<Capability>(['series.view']), NOW);
    expect(summary.storage?.disks.map((d) => d.path)).toEqual(['/tv']);
    expect(mocks.getRadarrClients).not.toHaveBeenCalled();
  });

  it('counts unread alerts in the owner’s own scope', async () => {
    await buildStatusSummary(USER, new Set<Capability>(['notifications.view']), NOW);
    expect(mocks.notificationCount).toHaveBeenCalledWith({ where: expect.objectContaining({ read: false }) });
  });

  it('is null for a section whose service is not set up, and caches it', async () => {
    mocks.getQBittorrentClient.mockRejectedValue(new ConfigurationError('qBittorrent is not configured.'));
    mocks.getRadarrClients.mockResolvedValue([]);
    mocks.getSonarrClients.mockResolvedValue([]);
    const summary = await buildStatusSummary(USER, new Set<Capability>(['torrents.view', 'movies.view', 'series.view']), NOW);
    expect(summary.downloads).toBeNull();
    expect(summary.storage).toBeNull();
    expect(mocks.setCachedJson).toHaveBeenCalledWith('status-api', 'summary|movies.view,series.view,torrents.view', expect.any(Object), 10);
  });

  it('is null for a section that did not answer, and is not cached then', async () => {
    mocks.getJellyfinClient.mockResolvedValue({ getActiveSessions: async () => { throw new Error('down'); } });
    const summary = await buildStatusSummary(USER, new Set<Capability>(['jellyfin.sessions', 'activity.view']), NOW);
    expect(summary.streams).toBeNull();
    expect(summary.queue).toEqual({ total: 7 });
    expect(mocks.setCachedJson).not.toHaveBeenCalled();
  });

  it('is null for the queue when an instance did not answer, rather than a short count', async () => {
    mocks.getQueueCached.mockResolvedValue({ records: [], totalRecords: 3, partial: true });
    const summary = await buildStatusSummary(USER, new Set<Capability>(['activity.view']), NOW);
    expect(summary.queue).toBeNull();
    expect(mocks.setCachedJson).not.toHaveBeenCalled();
  });

  it('keeps the disks that answered when one instance does not', async () => {
    mocks.getRadarrClients.mockResolvedValue([{ client: { getDiskSpace: async () => { throw new Error('down'); } } }]);
    const summary = await buildStatusSummary(USER, new Set<Capability>(['movies.view', 'series.view']), NOW);
    expect(summary.storage?.disks.map((d) => d.path)).toEqual(['/tv']);
    expect(mocks.setCachedJson).not.toHaveBeenCalled();
  });

  it('serves the shared sections from the cache, keyed by scopes, with alerts always live', async () => {
    mocks.getCachedJson.mockResolvedValue({ queue: { total: 99 } });
    const summary = await buildStatusSummary(USER, new Set<Capability>(['notifications.view', 'activity.view']), NOW);
    expect(mocks.getCachedJson).toHaveBeenCalledWith('status-api', 'summary|activity.view');
    expect(summary).toEqual({ version: 1, generatedAt: NOW.toISOString(), queue: { total: 99 }, alerts: { unread: 4 } });
    expect(mocks.getQueueCached).not.toHaveBeenCalled();
  });
});

describe('buildStatusQueue', () => {
  const sonarrItem = {
    id: 1, source: 'sonarr', instanceLabel: 'HD', title: 'Show.S01E02.1080p', status: 'downloading',
    trackedDownloadState: 'downloading', size: 1000, sizeleft: 250, timeleft: '00:10:00',
    estimatedCompletionTime: '2026-11-07T10:10:00Z', series: { title: 'Show' }, episode: { seasonNumber: 1, episodeNumber: 2 },
    downloadId: 'secret-hash', outputPath: '/downloads/x', indexer: 'Private',
  } as unknown as QueueItem;

  it('is small, stable and read-only: no paths, hashes or ids', async () => {
    mocks.getQueueCached.mockResolvedValue({ records: [sonarrItem], totalRecords: 1 });
    const queue = await buildStatusQueue(NOW);
    expect(queue).toEqual({
      version: 1,
      generatedAt: NOW.toISOString(),
      total: 1,
      partial: false,
      items: [{
        source: 'sonarr', instance: 'HD', title: 'Show', episode: 'S01E02', status: 'downloading', progress: 75,
        sizeBytes: 1000, sizeLeftBytes: 250, timeLeft: '00:10:00', estimatedCompletion: '2026-11-07T10:10:00Z',
      }],
    });
    expect(JSON.stringify(queue)).not.toMatch(/secret-hash|downloads|Private/);
  });

  it('falls back to the release title, and is 0% with no size', () => {
    const item = toStatusQueueItem({ title: 'Unknown.Release', status: 'queued', trackedDownloadState: '', size: 0, sizeleft: 0 } as unknown as QueueItem);
    expect(item).toMatchObject({ source: null, title: 'Unknown.Release', episode: null, status: 'queued', progress: 0, timeLeft: null });
  });

  it('says when an instance did not answer', async () => {
    mocks.getQueueCached.mockResolvedValue({ records: [sonarrItem], totalRecords: 1, partial: true });
    expect((await buildStatusQueue(NOW)).partial).toBe(true);
  });

  it('lists the soonest to finish first across instances, those with no estimate last', async () => {
    const at = (title: string, source: string, eta: string) => ({ ...sonarrItem, title, source, series: undefined, estimatedCompletionTime: eta }) as unknown as QueueItem;
    mocks.getQueueCached.mockResolvedValue({
      records: [at('S-late', 'sonarr', '2026-11-07T12:00:00Z'), at('S-none', 'sonarr', ''), at('R-soon', 'radarr', '2026-11-07T10:05:00Z')],
      totalRecords: 3,
    });
    expect((await buildStatusQueue(NOW)).items.map((i) => i.title)).toEqual(['R-soon', 'S-late', 'S-none']);
  });

  it('caps the items but reports the whole total', async () => {
    mocks.getQueueCached.mockResolvedValue({ records: Array.from({ length: 150 }, () => sonarrItem), totalRecords: 150 });
    const queue = await buildStatusQueue(NOW);
    expect(queue.total).toBe(150);
    expect(queue.items).toHaveLength(100);
  });
});
