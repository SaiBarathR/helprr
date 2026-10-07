import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPollingCycleContext } from '@/lib/polling-cycle';

const mocks = vi.hoisted(() => ({
  getSonarrClients: vi.fn(),
  getRadarrClients: vi.fn(),
  getLidarrClients: vi.fn(),
  findState: vi.fn(),
  createState: vi.fn(),
  updateState: vi.fn(),
  writeBadge: vi.fn(async () => {}),
  notify: vi.fn(async () => 1),
  invalidateLibrary: vi.fn(async () => {}),
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/lib/service-helpers', () => ({
  getSonarrClients: mocks.getSonarrClients,
  getRadarrClients: mocks.getRadarrClients,
  getLidarrClients: mocks.getLidarrClients,
  getQBittorrentClient: vi.fn(),
  getJellyfinClient: vi.fn(),
  getSeerrClient: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    pollingState: {
      findUnique: mocks.findState,
      create: mocks.createState,
      update: mocks.updateState,
    },
  },
}));

vi.mock('@/lib/cache/badge-counts', () => ({
  writeBadgeSlice: mocks.writeBadge,
}));

vi.mock('@/lib/cache/tagged-library', () => ({
  getCachedTaggedLibrary: vi.fn(),
  invalidateTaggedLibrary: mocks.invalidateLibrary,
}));

vi.mock('@/lib/notification-service', () => ({
  initVapid: vi.fn(),
  notifyEvent: mocks.notify,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: mocks.debug,
    error: mocks.error,
    info: mocks.info,
    warn: mocks.warn,
  },
}));

import { PollingService } from '@/lib/polling-service';

type InternalPollingService = {
  pollSonarr: (context: ReturnType<typeof cycleContext>) => Promise<void>;
  pollRadarr: (context: ReturnType<typeof cycleContext>) => Promise<void>;
  pollLidarr: (context: ReturnType<typeof cycleContext>) => Promise<void>;
};

function cycleContext() {
  return createPollingCycleContext(
    async () => ({ notificationGroupingEnabled: false }),
    { instanceConcurrency: 2 },
  );
}

function connection(id: string) {
  return { id, label: id, isDefault: true };
}

function queue(totalRecords: number, records: unknown[] = []) {
  return {
    page: 1,
    pageSize: 200,
    sortKey: 'timeleft',
    sortDirection: 'ascending',
    totalRecords,
    records,
  };
}

function history() {
  return {
    page: 1,
    pageSize: 50,
    sortKey: 'date',
    sortDirection: 'descending',
    totalRecords: 0,
    records: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findState.mockImplementation(async ({ where }: { where: { serviceConnectionId: string } }) => ({
    serviceConnectionId: where.serviceConnectionId,
    lastQueueIds: [],
    lastHistoryDate: null,
    lastHistoryId: null,
    lastHistorySeenIds: [],
    lastHealthHash: null,
  }));
  mocks.updateState.mockResolvedValue({});
});

describe('Arr polling concurrency', () => {
  it('shares the global limit, isolates failures, and deterministically sums badges', async () => {
    let active = 0;
    let maxActive = 0;
    const client = (totalRecords: number, failHistory = false) => ({
      getTags: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        return [];
      },
      getQueue: async () => queue(totalRecords),
      getHistory: async () => {
        if (failHistory) {
          active -= 1;
          throw new Error('history unavailable');
        }
        return history();
      },
      getHealth: async () => {
        active -= 1;
        return [];
      },
    });

    mocks.getSonarrClients.mockResolvedValue([
      { connection: connection('sonarr-1'), client: client(1) },
      { connection: connection('sonarr-2'), client: client(2) },
    ]);
    mocks.getRadarrClients.mockResolvedValue([
      { connection: connection('radarr-1'), client: client(3, true) },
      { connection: connection('radarr-2'), client: client(4) },
    ]);
    mocks.getLidarrClients.mockResolvedValue([
      { connection: connection('lidarr-1'), client: client(5) },
      { connection: connection('lidarr-2'), client: client(6) },
    ]);

    const context = cycleContext();
    const service = new PollingService() as unknown as InternalPollingService;
    await Promise.all([
      service.pollSonarr(context),
      service.pollRadarr(context),
      service.pollLidarr(context),
    ]);

    expect(maxActive).toBe(2);
    expect(context.getMetrics()).toMatchObject({
      maxInstanceConcurrency: 2,
      instanceFailures: 1,
    });
    expect(mocks.writeBadge).toHaveBeenCalledWith(
      'activity',
      'sonarr',
      { total: 3, attention: 0 },
    );
    expect(mocks.writeBadge).toHaveBeenCalledWith(
      'activity',
      'radarr',
      { total: 7, attention: 0 },
    );
    expect(mocks.writeBadge).toHaveBeenCalledWith(
      'activity',
      'lidarr',
      { total: 11, attention: 0 },
    );
    expect(mocks.updateState).toHaveBeenCalledTimes(5);
  });

  it('asks Sonarr and Radarr, but not Lidarr, for downloads they could not match', async () => {
    const instance = () => {
      const getQueue = vi.fn(async () => queue(0));
      return { getQueue, client: { getTags: async () => [], getQueue, getHistory: async () => history(), getHealth: async () => [] } };
    };
    const sonarr = instance(); const radarr = instance(); const lidarr = instance();
    mocks.getSonarrClients.mockResolvedValue([{ connection: connection('sonarr-1'), client: sonarr.client }]);
    mocks.getRadarrClients.mockResolvedValue([{ connection: connection('radarr-1'), client: radarr.client }]);
    mocks.getLidarrClients.mockResolvedValue([{ connection: connection('lidarr-1'), client: lidarr.client }]);

    const context = cycleContext();
    const service = new PollingService() as unknown as InternalPollingService;
    await Promise.all([service.pollSonarr(context), service.pollRadarr(context), service.pollLidarr(context)]);

    expect(sonarr.getQueue).toHaveBeenCalledWith(1, 200, true);
    expect(radarr.getQueue).toHaveBeenCalledWith(1, 200, true);
    // Lidarr's unmatched downloads are not listed in Activity either.
    expect(lidarr.getQueue).toHaveBeenCalledWith(1, 200, false);
  });

  it('counts an unmatched download in the badge and announces that it needs a manual import', async () => {
    // What Sonarr returns for a torrent added by hand into its category that it
    // could not match: no series, no episode, blocked on import.
    const unmatched = {
      id: 7, title: '[grp] Some Show 2nd Season (BD 1080p)', downloadId: 'D',
      seriesId: null, episodeId: null, seasonNumber: null, series: null, episode: null,
      quality: { quality: { name: 'Unknown' } },
      trackedDownloadState: 'importBlocked', trackedDownloadStatus: 'warning',
      statusMessages: [{ title: '[grp] Some Show 2nd Season (BD 1080p)', messages: ['Series title mismatch; automatic import is not possible.'] }],
    };
    const matched = { id: 1, title: 'Show.S01E01', seriesId: 9, trackedDownloadState: 'downloading', trackedDownloadStatus: 'ok' };
    // The matched download was already known; the unmatched one is new this cycle.
    mocks.findState.mockResolvedValue({
      serviceConnectionId: 'sonarr-1', lastQueueIds: [{ id: 1, state: 'downloading', status: 'ok' }],
      lastHistoryDate: null, lastHistoryId: null, lastHistorySeenIds: [], lastHealthHash: null,
    });
    mocks.getSonarrClients.mockResolvedValue([{
      connection: connection('sonarr-1'),
      client: { getTags: async () => [], getQueue: async () => queue(2, [matched, unmatched]), getHistory: async () => history(), getHealth: async () => [] },
    }]);

    const service = new PollingService() as unknown as InternalPollingService;
    await service.pollSonarr(cycleContext());

    expect(mocks.writeBadge).toHaveBeenCalledWith('activity', 'sonarr', { total: 2, attention: 1 });
    expect(mocks.notify).toHaveBeenCalledOnce();
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'importFailed',
      title: expect.stringContaining('Manual Import Required'),
      body: '[grp] Some Show 2nd Season (BD 1080p) — Series title mismatch; automatic import is not possible.',
      url: '/activity?tab=failed&source=sonarr',
      metadata: expect.objectContaining({ source: 'sonarr', instanceId: 'sonarr-1', id: 7, seriesId: null, state: 'importBlocked' }),
    }));
  });

  it('flushes notifications before advancing the instance state', async () => {
    const queueItem = {
      id: 1,
      title: 'New episode',
      trackedDownloadState: 'downloading',
      trackedDownloadStatus: 'ok',
    };
    const client = {
      getTags: async () => [],
      getQueue: async () => queue(1, [queueItem]),
      getHistory: async () => history(),
      getHealth: async () => [],
    };
    mocks.getSonarrClients.mockResolvedValue([
      { connection: connection('sonarr-1'), client },
    ]);

    const service = new PollingService() as unknown as InternalPollingService;
    await service.pollSonarr(cycleContext());

    expect(mocks.notify).toHaveBeenCalledOnce();
    expect(mocks.updateState).toHaveBeenCalledOnce();
    expect(mocks.notify.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateState.mock.invocationCallOrder[0],
    );
  });
});
