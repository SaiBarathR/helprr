import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PollingCycleContext } from '@/lib/polling-cycle';

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  refreshScheduled: vi.fn(async () => {}),
  checkScheduled: vi.fn(async () => {}),
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  loadLibrary: vi.fn(),
  findConnections: vi.fn(async () => [] as unknown[]),
  findConnection: vi.fn(async () => null as unknown),
  findHistory: vi.fn(async () => null as unknown),
  updateSettings: vi.fn(async () => ({})),
  updateState: vi.fn(async () => ({})),
  readDisks: vi.fn(),
  findStates: vi.fn(async () => [] as unknown[]),
  upsertState: vi.fn<(args: unknown) => Promise<unknown>>(async () => ({})),
  probe: vi.fn(),
  checkUpdate: vi.fn(async () => true),
}));

vi.mock('@/lib/polling/update-available', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/polling/update-available')>()),
  checkUpdateAvailable: mocks.checkUpdate,
}));

// The saved alternative limits live in Redis; a map stands in for it.
const savedAlt = vi.hoisted(() => ({ store: new Map<string, unknown>(), failLoad: false }));
vi.mock('@/lib/bandwidth-scheduler/saved-alt', () => ({
  loadSavedAltLimits: vi.fn(async () => {
    if (savedAlt.failLoad) throw new Error('Redis unavailable');
    return new Map(savedAlt.store);
  }),
  saveAltLimits: vi.fn(async (id: string, value: unknown) => { savedAlt.store.set(id, value); }),
  forgetAltLimits: vi.fn(async (id: string) => { savedAlt.store.delete(id); }),
}));
vi.mock('@/lib/polling/poll-twitch', () => ({ pollTwitch: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/polling/poll-youtube', () => ({ pollYoutube: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/db', () => ({
  prisma: {
    serviceConnection: { findMany: mocks.findConnections, findFirst: mocks.findConnection },
    notificationHistory: { findFirst: mocks.findHistory },
    appSettings: { update: mocks.updateSettings },
    user: { findMany: vi.fn(async () => []) },
    pollingState: {
      findMany: mocks.findStates,
      upsert: mocks.upsertState,
      update: mocks.updateState,
      findUnique: vi.fn(async () => ({ lastQueueIds: [], lastHistoryDate: null, lastHistoryId: null, lastHistorySeenIds: [] })),
    },
  },
}));

vi.mock('@/lib/disk-space', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/disk-space')>()),
  getAggregatedDiskSpace: mocks.readDisks,
}));

vi.mock('@/lib/service-health', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/service-health')>()),
  probeServiceHealth: mocks.probe,
}));

vi.mock('@/lib/app-settings', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/app-settings')>();
  return { ...original, getOrCreateAppSettings: mocks.settings };
});

vi.mock('@/lib/scheduled-alerts/delivery', () => ({
  refreshScheduledAlertOccurrences: mocks.refreshScheduled,
  checkScheduledAlerts: mocks.checkScheduled,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: mocks.debug,
    error: mocks.error,
    info: mocks.info,
    warn: mocks.warn,
  },
  redact: (value: unknown) => value,
}));

// Cache warming reads libraries through the tagged-library loader, which keeps
// going past an instance that fails and reports it as incomplete.
vi.mock('@/lib/cache/tagged-library', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cache/tagged-library')>()),
  getCachedTaggedLibrary: mocks.loadLibrary,
}));

import { PollingService } from '@/lib/polling-service';
import { arrInstanceBackoff } from '@/lib/polling-cycle';
import { jobReports, noteJobFailure, noteJobSkipped, type JobReport } from '@/lib/polling-job-report';
import { ConfigurationError } from '@/lib/config-error';

type TestContext = PollingCycleContext<{ notificationGroupingEnabled: boolean }>;
type InternalPollingService = {
  activePollSources: Set<string>;
  poll: () => Promise<void>;
  runPollSource: (source: string, run: () => Promise<void>) => Promise<void>;
  [key: string]: unknown;
};

const SETTINGS_SOURCES = [
  'pollSonarr',
  'pollRadarr',
  'pollLidarr',
  'pollQBittorrent',
  'checkDiskSpace',
  'checkUpcoming',
  'checkActivityDigest',
  'checkDatabaseBackup',
  'applyBandwidthSchedule',
  'checkRetention',
  'checkAnimeAutoMap',
  'checkUpdateAvailable',
] as const;

const UNRELATED_SOURCES = [
  'pollJellyfin',
  'pollSeerr',
  'pollProwlarr',
  'pollManualDownloads',
  'pollServiceReachability',
  'checkArrUpdates',
  'sweepTasteProfiles',
] as const;

function stubCycle(service: PollingService) {
  const internal = service as unknown as InternalPollingService;
  for (const source of SETTINGS_SOURCES) {
    internal[source] = vi.fn(async (context: unknown) => {
      await (context as TestContext).getSettings();
    });
  }
  for (const source of UNRELATED_SOURCES) {
    internal[source] = vi.fn(async () => {});
  }
  internal.shouldSnapshotDiskUsage = vi.fn(async (context: unknown) => {
    await (context as TestContext).getSettings();
    return true;
  });
  internal.snapshotDiskUsage = vi.fn(async (context: unknown) => {
    await (context as TestContext).getSettings();
  });
  internal.warmCaches = vi.fn(async () => {});
  return internal;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.mockResolvedValue({ notificationGroupingEnabled: true });
  // The skip state is shared by every PollingService; start each test clean.
  arrInstanceBackoff.clear('s1');
});

describe('polling service cycle orchestration', () => {
  it('shares one settings read across all settings-dependent sources', async () => {
    const internal = stubCycle(new PollingService());

    await internal.poll();

    expect(mocks.settings).toHaveBeenCalledOnce();
    expect(internal.snapshotDiskUsage).toHaveBeenCalledOnce();
    expect(internal.warmCaches).toHaveBeenCalledOnce();
    expect(mocks.debug).toHaveBeenCalledWith(
      'Polling cycle completed',
      expect.objectContaining({
        settingsReadCount: 1,
        sourceDurationsMs: expect.objectContaining({
          pollSonarr: expect.any(Number),
          warmCaches: expect.any(Number),
        }),
      }),
      { scope: 'polling' },
    );
  });

  it('never checks for a release while the update check is off', async () => {
    const internal = new PollingService() as unknown as InternalPollingService;
    const check = (internal.checkUpdateAvailable as (context: unknown) => Promise<void>).bind(internal);

    await check({ startedAtMs: 1_000, getSettings: async () => ({ updateCheckEnabled: false }) });
    expect(mocks.checkUpdate).not.toHaveBeenCalled();

    // Turned back on: the next cycle checks.
    await check({ startedAtMs: 2_000, getSettings: async () => ({ updateCheckEnabled: true }) });
    expect(mocks.checkUpdate).toHaveBeenCalledOnce();
  });

  it('keeps unrelated sources and cache warming alive when settings fail', async () => {
    mocks.settings.mockRejectedValue(new Error('settings unavailable'));
    const internal = stubCycle(new PollingService());

    await internal.poll();

    expect(internal.pollJellyfin).toHaveBeenCalledOnce();
    expect(internal.pollSeerr).toHaveBeenCalledOnce();
    expect(internal.warmCaches).toHaveBeenCalledOnce();
    expect(mocks.settings).toHaveBeenCalledOnce();
    expect(mocks.error).toHaveBeenCalledWith(
      'Polling source failures',
      expect.objectContaining({ failures: expect.any(Array) }),
      { scope: 'polling' },
    );
  });

  it('starts cache warming only after source polls settle', async () => {
    const internal = stubCycle(new PollingService());
    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    internal.pollJellyfin = vi.fn(async () => blocked);

    const cycle = internal.poll();
    await vi.waitFor(() => expect(internal.pollJellyfin).toHaveBeenCalledOnce());
    expect(internal.warmCaches).not.toHaveBeenCalled();

    release();
    await cycle;

    expect(internal.warmCaches).toHaveBeenCalledOnce();
  });

  it('allows Arr queue time but still expires stalled family work', async () => {
    vi.useFakeTimers();
    try {
      const internal = new PollingService() as unknown as InternalPollingService;
      let release = () => {};
      let settled = false;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const source = internal.runPollSource('pollSonarr', async () => blocked)
        .finally(() => {
          settled = true;
        });
      const outcome = source.catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(120_000);

      expect(settled).toBe(false);
      expect(mocks.warn).not.toHaveBeenCalledWith(
        'Polling source timed out',
        expect.anything(),
        { scope: 'polling' },
      );

      await vi.advanceTimersByTimeAsync(60_000);
      expect(await outcome).toMatchObject({
        message: 'Polling source timed out after 180000ms',
      });
      expect(settled).toBe(true);

      release();
      await Promise.resolve();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not warm caches over Arr work that is still active after a timeout', async () => {
    const internal = stubCycle(new PollingService());
    internal.activePollSources.add('pollSonarr');

    await internal.poll();

    expect(internal.warmCaches).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith(
      'Cache warming skipped: Arr polling still active',
      { sources: ['pollSonarr'] },
      { scope: 'polling' },
    );
  });
});

describe('polling health from the cycle', () => {
  const sourceHealth = (service: PollingService, source: string) => service.getHealth().sources.find((entry) => entry.source === source);

  it('records a job that logs a failure and carries on as failed', async () => {
    const service = new PollingService();
    const internal = stubCycle(service);
    internal.pollJellyfin = vi.fn(async () => { noteJobFailure(new Error('Jellyfin answered 401')); });

    await internal.poll();

    expect(sourceHealth(service, 'pollJellyfin')).toEqual(expect.objectContaining({ lastSuccessAt: null, lastError: 'Jellyfin answered 401' }));
    expect(service.getHealth().lastCycle?.failed).toBe(1);
  });

  it('keeps a throttled job\'s last outcome while it has nothing due', async () => {
    const service = new PollingService();
    const internal = stubCycle(service);
    internal.sweepTasteProfiles = vi.fn(async () => { throw new Error('database unavailable'); });
    await internal.poll();
    internal.sweepTasteProfiles = vi.fn(async () => { noteJobSkipped(); });
    await internal.poll();

    expect(sourceHealth(service, 'sweepTasteProfiles')).toEqual(expect.objectContaining({ lastSuccessAt: null, lastError: 'database unavailable' }));
  });

  it('does not stamp a success for a warm still running from an earlier cycle', async () => {
    const service = new PollingService();
    const internal = stubCycle(service);
    internal.warmCaches = vi.fn(async () => { throw new Error('warm timed out'); });
    await internal.poll();
    internal.warmCaches = vi.fn(async () => {});
    internal.activePollSources.add('warmCaches');
    await internal.poll();

    expect(internal.warmCaches).not.toHaveBeenCalled();
    expect(sourceHealth(service, 'warmCaches')).toEqual(expect.objectContaining({ lastSuccessAt: null, lastError: 'warm timed out' }));
  });

  it('records cache warming with the other jobs', async () => {
    const service = new PollingService();
    const internal = stubCycle(service);
    internal.warmCaches = vi.fn(async () => { throw new Error('warm timed out'); });

    await internal.poll();

    expect(sourceHealth(service, 'warmCaches')).toEqual(expect.objectContaining({ lastError: 'warm timed out' }));
    expect(service.getHealth().lastCycle?.failed).toBe(1);
  });
});

describe('cache warming health', () => {
  it('counts a warm that read a configured instance that did not answer as failed', async () => {
    const service = new PollingService();
    const internal = stubCycle(service);
    internal.warmCaches = (PollingService.prototype as unknown as { warmCaches: () => Promise<void> }).warmCaches.bind(service);
    const services = await import('@/lib/service-helpers');
    vi.spyOn(services, 'getSonarrClients').mockResolvedValue([{ connection: { id: 's1', label: 'Sonarr', updatedAt: new Date(0) }, client: {} }] as never);
    // Sonarr has one configured instance, which failed: the loader still fulfills,
    // incomplete. Radarr and Lidarr have none, which is not a failure.
    mocks.loadLibrary.mockImplementation(async (opts: { getInstances: () => Promise<unknown[]> }) => {
      await opts.getInstances();
      return { items: [], cached: false, available: false, complete: false, failedInstanceIds: ['s1'] };
    });
    vi.spyOn(services, 'getRadarrClients').mockResolvedValue([] as never);
    vi.spyOn(services, 'getLidarrClients').mockResolvedValue([] as never);

    await internal.poll();

    const warm = service.getHealth().sources.find((entry) => entry.source === 'warmCaches');
    expect(warm).toEqual(expect.objectContaining({ lastSuccessAt: null, lastError: 'sonarr: an instance did not answer' }));
  });
});

describe('an Arr instance that keeps failing', () => {
  it('is skipped by later cycles, cache warming included, and still shows as failing', async () => {
    const service = new PollingService();
    const internal = stubCycle(service);
    const proto = PollingService.prototype as unknown as Record<string, (...args: unknown[]) => Promise<void>>;
    internal.pollSonarr = proto.pollSonarr.bind(service);
    internal.warmCaches = proto.warmCaches.bind(service);
    const getQueue = vi.fn(async () => { throw new Error('connect ETIMEDOUT'); });
    const getSeries = vi.fn(async () => { throw new Error('connect ETIMEDOUT'); });
    const services = await import('@/lib/service-helpers');
    vi.spyOn(services, 'getSonarrClients').mockResolvedValue([{
      connection: { id: 's1', label: 'Sonarr', updatedAt: new Date(0) },
      client: { getTags: async () => [], getQueue, getSeries },
    }] as never);
    vi.spyOn(services, 'getRadarrClients').mockResolvedValue([] as never);
    vi.spyOn(services, 'getLidarrClients').mockResolvedValue([] as never);
    mocks.loadLibrary.mockImplementation(async (opts: { getInstances: () => Promise<Array<{ client: unknown }>>; fetchOne: (client: unknown) => Promise<unknown> }) => {
      const instances = await opts.getInstances();
      await Promise.allSettled(instances.map((instance) => opts.fetchOne(instance.client)));
      return { items: [], cached: false, available: false, complete: false, failedInstanceIds: ['s1'] };
    });

    for (let i = 0; i < 3; i += 1) await internal.poll();

    // Two failed polls, then skipped; the warm stops once the polls skip it.
    expect(getQueue).toHaveBeenCalledTimes(2);
    expect(getSeries).toHaveBeenCalledOnce();
    const health = (source: string) => service.getHealth().sources.find((entry) => entry.source === source);
    expect(health('pollSonarr')?.lastError).toMatch(
      /^Skipped after 2 failed polls in a row \(last error: connect ETIMEDOUT\); next try in \d+s$/,
    );
    expect(health('warmCaches')?.lastError).toBe('sonarr: Sonarr is skipped after repeated failures');
  });
});

describe('cache warming that joins a load already running', () => {
  it('still counts a configured instance that did not answer', async () => {
    const service = new PollingService();
    const internal = stubCycle(service);
    internal.warmCaches = (PollingService.prototype as unknown as { warmCaches: () => Promise<void> }).warmCaches.bind(service);
    const services = await import('@/lib/service-helpers');
    vi.spyOn(services, 'getSonarrClients').mockResolvedValue([{ connection: { id: 's1', label: 'Sonarr', updatedAt: new Date(0) }, client: {} }] as never);
    vi.spyOn(services, 'getRadarrClients').mockResolvedValue([] as never);
    vi.spyOn(services, 'getLidarrClients').mockResolvedValue([] as never);
    // Joined an in-flight load: the loader never asks this warm for instances.
    mocks.loadLibrary.mockResolvedValue({ items: [], cached: false, available: false, complete: false, failedInstanceIds: ['s1'] });

    await internal.poll();

    const warm = service.getHealth().sources.find((entry) => entry.source === 'warmCaches');
    expect(warm).toEqual(expect.objectContaining({ lastSuccessAt: null, lastError: 'sonarr: an instance did not answer' }));
  });
});

describe('jobs that cannot load what they work on', () => {
  const sourceHealth = (service: PollingService, source: string) => service.getHealth().sources.find((entry) => entry.source === source);
  const real = (internal: InternalPollingService, service: PollingService, source: string) => {
    internal[source] = (PollingService.prototype as unknown as Record<string, (...args: unknown[]) => Promise<void>>)[source].bind(service);
  };

  it('counts an Arr poll whose instances could not be read as failed', async () => {
    const service = new PollingService();
    const internal = stubCycle(service);
    real(internal, service, 'pollSonarr');
    const services = await import('@/lib/service-helpers');
    vi.spyOn(services, 'getSonarrClients').mockRejectedValue(new Error('database unavailable'));

    await internal.poll();

    expect(sourceHealth(service, 'pollSonarr')).toEqual(expect.objectContaining({ lastSuccessAt: null, lastError: 'database unavailable' }));
    expect(service.getHealth().lastCycle?.failed).toBe(1);
  });

  it('counts a qBittorrent lookup that failed, but not one that is simply not set up', async () => {
    const service = new PollingService();
    const internal = stubCycle(service);
    real(internal, service, 'pollQBittorrent');
    const services = await import('@/lib/service-helpers');
    const lookup = vi.spyOn(services, 'getQBittorrentClients');

    // None set up is an empty list, not a failure.
    lookup.mockResolvedValue([]);
    await internal.poll();
    expect(sourceHealth(service, 'pollQBittorrent')).toEqual(expect.objectContaining({ lastSuccessAt: expect.any(String), lastError: null }));

    lookup.mockRejectedValue(new Error('database unavailable'));
    await internal.poll();
    expect(sourceHealth(service, 'pollQBittorrent')).toEqual(expect.objectContaining({ lastError: 'database unavailable' }));
    expect(service.getHealth().lastCycle?.failed).toBe(1);
  });

  it('counts a bandwidth release it could not carry out as failed', async () => {
    const service = new PollingService();
    const internal = stubCycle(service);
    internal.appliedBandwidth = new Map([['q1', {
      ruleId: 'r1', downloadKbps: 100, uploadKbps: 50, limits: 'global', wroteGlobal: true, savedAlt: null,
    }]]);
    internal.applyBandwidthSchedule = vi.fn(async () => {
      await (internal.releaseAppliedBandwidth as (context: string) => Promise<void>).call(service, 'test');
    });
    const services = await import('@/lib/service-helpers');
    vi.spyOn(services, 'getQBittorrentClients').mockRejectedValue(new Error('database unavailable'));

    await internal.poll();

    expect(sourceHealth(service, 'applyBandwidthSchedule')).toEqual(expect.objectContaining({ lastError: 'database unavailable' }));
    expect((internal.appliedBandwidth as Map<string, unknown>).size).toBe(1);
  });

  it('counts a Jellyfin connection without its user as failed, but not Jellyfin that is not set up', async () => {
    const service = new PollingService();
    const internal = stubCycle(service);
    real(internal, service, 'pollJellyfin');
    const services = await import('@/lib/service-helpers');
    vi.spyOn(services, 'getJellyfinClient').mockRejectedValue(new ConfigurationError('Jellyfin user context is missing.'));

    mocks.findConnection.mockResolvedValue(null);
    await internal.poll();
    expect(sourceHealth(service, 'pollJellyfin')).toEqual(expect.objectContaining({ lastSuccessAt: expect.any(String), lastError: null }));

    mocks.findConnection.mockResolvedValue({ id: 'jf1', type: 'JELLYFIN', label: 'Jellyfin' });
    await internal.poll();
    expect(sourceHealth(service, 'pollJellyfin')).toEqual(expect.objectContaining({ lastError: 'Jellyfin user context is missing.' }));
    expect(service.getHealth().lastCycle?.failed).toBe(1);
  });

  it('keeps a failed activity digest failed while its window has already been used', async () => {
    mocks.settings.mockResolvedValue({ notificationGroupingEnabled: true, activityDigestMode: 'daily', activityDigestHour: 0, timeZone: 'UTC' });
    const service = new PollingService();
    const internal = stubCycle(service);
    internal.checkActivityDigest = vi.fn(async () => { throw new Error('push failed'); });
    await internal.poll();
    real(internal, service, 'checkActivityDigest');
    mocks.findHistory.mockResolvedValue({ id: 'h1' });

    await internal.poll();

    expect(mocks.findHistory).toHaveBeenCalledOnce();
    expect(sourceHealth(service, 'checkActivityDigest')).toEqual(expect.objectContaining({ lastSuccessAt: null, lastError: 'push failed' }));
  });

  it('counts an anime auto-map that could not record its run date as failed', async () => {
    const service = new PollingService();
    const services = await import('@/lib/service-helpers');
    vi.spyOn(services, 'getSonarrClients').mockResolvedValue([] as never);
    mocks.updateSettings.mockRejectedValueOnce(new Error('write failed'));
    const report: JobReport = { failure: null, skipped: false };

    const result = await jobReports.run(report, () => service.startAnimeAutoMapRun('scheduled', { animeAutoMapEnabled: true } as never));

    expect(result).toEqual(expect.objectContaining({ reason: 'nothing-to-map' }));
    expect(report.failure).toBe('write failed');
  });

  it('counts a Seerr poll whose pending count could not be read as failed', async () => {
    const service = new PollingService();
    const internal = stubCycle(service);
    real(internal, service, 'pollSeerr');
    const services = await import('@/lib/service-helpers');
    vi.spyOn(services, 'getSeerrClient').mockResolvedValue({
      listRequests: async () => ({ results: [] }),
      getRequestCount: async () => { throw new Error('count unavailable'); },
    } as never);
    mocks.findConnection.mockResolvedValue({ id: 'se1', type: 'SEERR', label: 'Seerr' });

    await internal.poll();

    expect(mocks.updateState).toHaveBeenCalledOnce();
    expect(sourceHealth(service, 'pollSeerr')).toEqual(expect.objectContaining({ lastSuccessAt: null, lastError: 'count unavailable' }));
  });

  it('counts a disk-space check that could not read the disks as failed', async () => {
    mocks.settings.mockResolvedValue({
      notificationGroupingEnabled: true,
      diskThresholds: [{ diskId: 'd1', label: 'Media', path: '/media', minFreeGb: 10, enabled: true }],
    });
    const service = new PollingService();
    const internal = stubCycle(service);
    real(internal, service, 'checkDiskSpace');
    mocks.readDisks.mockRejectedValue(new Error('disks unavailable'));

    await internal.poll();

    expect(sourceHealth(service, 'checkDiskSpace')).toEqual(expect.objectContaining({ lastSuccessAt: null, lastError: 'disks unavailable' }));
  });

  it('counts a reachability check whose result could not be saved as failed, and still checks the rest', async () => {
    const service = new PollingService();
    const internal = stubCycle(service);
    real(internal, service, 'pollServiceReachability');
    mocks.findConnections.mockResolvedValue([
      { id: 'c1', type: 'SONARR', label: 'Sonarr' },
      { id: 'c2', type: 'RADARR', label: 'Radarr' },
    ]);
    mocks.probe.mockResolvedValue({ ok: true });
    mocks.upsertState.mockImplementation(async (args: unknown) => {
      if ((args as { where: { serviceConnectionId: string } }).where.serviceConnectionId === 'c1') throw new Error('write failed');
      return {};
    });

    await internal.poll();

    expect(mocks.upsertState).toHaveBeenCalledTimes(2);
    expect(sourceHealth(service, 'pollServiceReachability')).toEqual(expect.objectContaining({ lastSuccessAt: null, lastError: 'write failed' }));
    expect(service.getHealth().lastCycle?.failed).toBe(1);
  });
});

describe('bandwidth schedule', () => {
  // A qBittorrent that behaves like 5.1.4: transfer/setDownloadLimit writes the
  // limits of the active mode, app/setPreferences writes the named keys.
  function fakeQbit(initialMode: 0 | 1) {
    const prefs = { dl_limit: 1_048_576, up_limit: 524_288, alt_dl_limit: 51_200, alt_up_limit: 20_480 };
    const state = { mode: initialMode as 0 | 1 };
    const transfer = (regular: 'dl_limit' | 'up_limit', alt: 'alt_dl_limit' | 'alt_up_limit') => vi.fn(async (limit: number) => {
      prefs[state.mode === 1 ? alt : regular] = limit;
    });
    return {
      prefs,
      state,
      setGlobalDownloadLimit: transfer('dl_limit', 'alt_dl_limit'),
      setGlobalUploadLimit: transfer('up_limit', 'alt_up_limit'),
      getSpeedLimitsMode: vi.fn(async () => state.mode),
      getSpeedLimits: vi.fn(async () => ({ ...prefs })),
      setSpeedLimits: vi.fn(async (limits: Partial<typeof prefs>) => {
        Object.assign(prefs, limits);
      }),
    };
  }
  beforeEach(() => {
    savedAlt.store.clear();
    savedAlt.failLoad = false;
  });
  // Every day, all day (start equals end).
  const rule = {
    id: 'r1', name: 'Night', enabled: true, daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    startHour: 0, startMinute: 0, endHour: 0, endMinute: 0, downloadLimitKbps: 300, uploadLimitKbps: 100,
  };
  const context = (rules: unknown[]) => ({
    startedAtMs: Date.UTC(2026, 10, 24, 12),
    getSettings: async () => ({ qbtBandwidthSchedule: { rules }, timeZone: 'UTC' }),
  });

  it.each([0, 1] as const)('sets and then releases only the regular limits (alternative mode %s)', async (mode) => {
    const qbit = fakeQbit(mode);
    const services = await import('@/lib/service-helpers');
    vi.spyOn(services, 'getQBittorrentClients').mockResolvedValue([{ connection: { id: 'q1' }, client: qbit }] as never);
    const internal = new PollingService() as unknown as InternalPollingService;
    const apply = (internal.applyBandwidthSchedule as (context: unknown) => Promise<void>).bind(internal);

    await apply(context([rule]));
    expect(qbit.prefs).toEqual({ dl_limit: 300 * 1024, up_limit: 100 * 1024, alt_dl_limit: 51_200, alt_up_limit: 20_480 });

    // The rule is gone: back to unlimited, the alternative limits untouched.
    await apply(context([]));
    expect(qbit.prefs).toEqual({ dl_limit: 0, up_limit: 0, alt_dl_limit: 51_200, alt_up_limit: 20_480 });
    expect((internal.appliedBandwidth as Map<string, unknown>).size).toBe(0);
    expect(qbit.setGlobalDownloadLimit).not.toHaveBeenCalled();
    expect(qbit.setGlobalUploadLimit).not.toHaveBeenCalled();
    // A "global limits" rule (one saved before the choice, too) never asks for the mode.
    expect(qbit.getSpeedLimitsMode).not.toHaveBeenCalled();
  });

  const whicheverRule = { ...rule, target: 'active' };
  const USER_PREFS = { dl_limit: 1_048_576, up_limit: 524_288, alt_dl_limit: 51_200, alt_up_limit: 20_480 };
  async function serviceWith(...clients: Array<ReturnType<typeof fakeQbit>>) {
    const services = await import('@/lib/service-helpers');
    vi.spyOn(services, 'getQBittorrentClients').mockResolvedValue(
      clients.map((client, i) => ({ connection: { id: `q${i + 1}` }, client })) as never,
    );
    const internal = new PollingService() as unknown as InternalPollingService;
    return {
      internal,
      apply: (internal.applyBandwidthSchedule as (context: unknown) => Promise<void>).bind(internal),
    };
  }

  it('sets the alternative limits while alternative mode is on, and puts the user\'s own back after', async () => {
    const qbit = fakeQbit(1);
    const { internal, apply } = await serviceWith(qbit);

    await apply(context([whicheverRule]));
    expect(qbit.prefs).toEqual({ ...USER_PREFS, alt_dl_limit: 300 * 1024, alt_up_limit: 100 * 1024 });
    expect(savedAlt.store.get('q1')).toEqual({ savedAlt: { alt_dl_limit: 51_200, alt_up_limit: 20_480 }, wroteGlobal: false });

    // Steady: nothing is written again.
    await apply(context([whicheverRule]));
    expect(qbit.setSpeedLimits).toHaveBeenCalledTimes(1);

    await apply(context([]));
    expect(qbit.prefs).toEqual(USER_PREFS);
    expect(savedAlt.store.size).toBe(0);
    expect((internal.appliedBandwidth as Map<string, unknown>).size).toBe(0);
  });

  it('sets the regular limits while alternative mode is off, as a global rule does', async () => {
    const qbit = fakeQbit(0);
    const { apply } = await serviceWith(qbit);

    await apply(context([whicheverRule]));
    expect(qbit.prefs).toEqual({ ...USER_PREFS, dl_limit: 300 * 1024, up_limit: 100 * 1024 });
    expect(savedAlt.store.size).toBe(0);

    await apply(context([]));
    expect(qbit.prefs).toEqual({ ...USER_PREFS, dl_limit: 0, up_limit: 0 });
  });

  it('follows the mode when it is switched during the rule', async () => {
    const qbit = fakeQbit(0);
    const { apply } = await serviceWith(qbit);

    await apply(context([whicheverRule]));
    qbit.state.mode = 1;
    await apply(context([whicheverRule]));
    expect(qbit.prefs).toEqual({ dl_limit: 300 * 1024, up_limit: 100 * 1024, alt_dl_limit: 300 * 1024, alt_up_limit: 100 * 1024 });

    // Back to the regular mode: the alternative limits are the user's again.
    qbit.state.mode = 0;
    await apply(context([whicheverRule]));
    expect(qbit.prefs).toEqual({ ...USER_PREFS, dl_limit: 300 * 1024, up_limit: 100 * 1024 });
    expect(savedAlt.store.size).toBe(0);

    await apply(context([]));
    expect(qbit.prefs).toEqual({ ...USER_PREFS, dl_limit: 0, up_limit: 0 });
  });

  it('puts the alternative limits back when the next rule sets the global ones', async () => {
    const qbit = fakeQbit(1);
    const { apply } = await serviceWith(qbit);

    await apply(context([whicheverRule]));
    await apply(context([{ ...rule, id: 'r2', downloadLimitKbps: 50 }]));
    expect(qbit.prefs).toEqual({ ...USER_PREFS, dl_limit: 50 * 1024, up_limit: 100 * 1024 });
    expect(savedAlt.store.size).toBe(0);
  });

  it('keeps the user\'s alternative limits across a restart', async () => {
    const qbit = fakeQbit(1);
    const before = await serviceWith(qbit);
    await before.apply(context([whicheverRule]));

    // A new process: it must not take the rule's values for the user's.
    const after = await serviceWith(qbit);
    await after.apply(context([{ ...whicheverRule, downloadLimitKbps: 200 }]));
    expect(savedAlt.store.get('q1')).toEqual({ savedAlt: { alt_dl_limit: 51_200, alt_up_limit: 20_480 }, wroteGlobal: false });
    expect(qbit.prefs.alt_dl_limit).toBe(200 * 1024);

    await after.apply(context([]));
    expect(qbit.prefs).toEqual(USER_PREFS);
    expect(savedAlt.store.size).toBe(0);
  });

  it('restores after a restart when the rule ended while it was down', async () => {
    const qbit = fakeQbit(1);
    const before = await serviceWith(qbit);
    await before.apply(context([whicheverRule]));

    const after = await serviceWith(qbit);
    await after.apply(context([]));
    expect(qbit.prefs).toEqual(USER_PREFS);
  });

  it('writes nothing until it has read the saved alternative limits', async () => {
    const qbit = fakeQbit(1);
    const { apply } = await serviceWith(qbit);
    savedAlt.failLoad = true;
    await apply(context([whicheverRule]));
    expect(qbit.setSpeedLimits).not.toHaveBeenCalled();
    expect(qbit.getSpeedLimitsMode).not.toHaveBeenCalled();

    savedAlt.failLoad = false;
    await apply(context([whicheverRule]));
    expect(qbit.prefs.alt_dl_limit).toBe(300 * 1024);
  });

  it('keeps the saved copy when qBittorrent took a write whose answer was lost', async () => {
    const qbit = fakeQbit(1);
    const { apply } = await serviceWith(qbit);
    qbit.setSpeedLimits.mockImplementationOnce(async (limits) => {
      Object.assign(qbit.prefs, limits);
      throw new Error('timeout of 30000ms exceeded');
    });

    await apply(context([whicheverRule]));
    await apply(context([whicheverRule]));
    expect(savedAlt.store.get('q1')).toEqual({ savedAlt: { alt_dl_limit: 51_200, alt_up_limit: 20_480 }, wroteGlobal: false });

    await apply(context([]));
    expect(qbit.prefs).toEqual(USER_PREFS);
  });

  it('takes alternative limits the user sets while a rule holds them as theirs', async () => {
    const qbit = fakeQbit(1);
    const { apply } = await serviceWith(qbit);
    await apply(context([whicheverRule]));

    // Changed in qBittorrent (or on Torrents) during the rule.
    qbit.prefs.alt_dl_limit = 80 * 1024;
    qbit.prefs.alt_up_limit = 40 * 1024;
    await apply(context([whicheverRule]));
    // The rule applies again, and the new values are the ones kept.
    expect(qbit.prefs.alt_dl_limit).toBe(300 * 1024);
    expect(savedAlt.store.get('q1')).toEqual({ savedAlt: { alt_dl_limit: 80 * 1024, alt_up_limit: 40 * 1024 }, wroteGlobal: false });

    await apply(context([]));
    expect(qbit.prefs).toEqual({ ...USER_PREFS, alt_dl_limit: 80 * 1024, alt_up_limit: 40 * 1024 });
  });

  it('leaves the alternative limits alone when it cannot save a copy first', async () => {
    const qbit = fakeQbit(1);
    const { apply } = await serviceWith(qbit);
    const store = await import('@/lib/bandwidth-scheduler/saved-alt');
    vi.mocked(store.saveAltLimits).mockRejectedValueOnce(new Error('Redis unavailable'));

    await apply(context([whicheverRule]));
    expect(qbit.prefs).toEqual(USER_PREFS);

    await apply(context([whicheverRule]));
    expect(qbit.prefs.alt_dl_limit).toBe(300 * 1024);
  });

  it('limits every qBittorrent, retries only the one that refused, and releases each', async () => {
    const first = fakeQbit(0);
    const second = fakeQbit(0);
    second.setSpeedLimits.mockRejectedValueOnce(new Error('qBittorrent did not answer'));
    const services = await import('@/lib/service-helpers');
    vi.spyOn(services, 'getQBittorrentClients').mockResolvedValue([
      { connection: { id: 'q1' }, client: first },
      { connection: { id: 'q2' }, client: second },
    ] as never);
    const internal = new PollingService() as unknown as InternalPollingService;
    const apply = (internal.applyBandwidthSchedule as (context: unknown) => Promise<void>).bind(internal);

    await apply(context([rule]));
    expect(first.prefs.dl_limit).toBe(300 * 1024);
    expect(second.prefs.dl_limit).toBe(1_048_576);
    expect([...(internal.appliedBandwidth as Map<string, unknown>).keys()]).toEqual(['q1']);

    // Next cycle: only the one that refused is sent the limit again.
    await apply(context([rule]));
    expect(first.setSpeedLimits).toHaveBeenCalledTimes(1);
    expect(second.prefs.dl_limit).toBe(300 * 1024);

    await apply(context([]));
    expect(first.prefs.dl_limit).toBe(0);
    expect(second.prefs.dl_limit).toBe(0);
    expect((internal.appliedBandwidth as Map<string, unknown>).size).toBe(0);
  });
});
