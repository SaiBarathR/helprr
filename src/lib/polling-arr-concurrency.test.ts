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
