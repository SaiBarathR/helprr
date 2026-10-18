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
import { noteJobFailure, noteJobSkipped } from '@/lib/polling-job-report';

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
  'applyBandwidthSchedule',
  'checkRetention',
  'checkAnimeAutoMap',
] as const;

const UNRELATED_SOURCES = [
  'pollJellyfin',
  'pollSeerr',
  'pollServiceReachability',
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
    vi.spyOn(services, 'getSonarrClients').mockResolvedValue([{ connection: { id: 's1', label: 'Sonarr' }, client: {} }] as never);
    // Sonarr has one configured instance, which failed: the loader still fulfills,
    // incomplete. Radarr and Lidarr have none, which is not a failure.
    mocks.loadLibrary.mockImplementation(async (opts: { getInstances: () => Promise<unknown[]> }) => {
      await opts.getInstances();
      return { items: [], cached: false, available: false, complete: false };
    });
    vi.spyOn(services, 'getRadarrClients').mockResolvedValue([] as never);
    vi.spyOn(services, 'getLidarrClients').mockResolvedValue([] as never);

    await internal.poll();

    const warm = service.getHealth().sources.find((entry) => entry.source === 'warmCaches');
    expect(warm).toEqual(expect.objectContaining({ lastSuccessAt: null, lastError: 'sonarr: an instance did not answer' }));
  });
});

describe('cache warming that joins a load already running', () => {
  it('still counts a configured instance that did not answer', async () => {
    const service = new PollingService();
    const internal = stubCycle(service);
    internal.warmCaches = (PollingService.prototype as unknown as { warmCaches: () => Promise<void> }).warmCaches.bind(service);
    const services = await import('@/lib/service-helpers');
    vi.spyOn(services, 'getSonarrClients').mockResolvedValue([{ connection: { id: 's1', label: 'Sonarr' }, client: {} }] as never);
    vi.spyOn(services, 'getRadarrClients').mockResolvedValue([] as never);
    vi.spyOn(services, 'getLidarrClients').mockResolvedValue([] as never);
    // Joined an in-flight load: the loader never asks this warm for instances.
    mocks.loadLibrary.mockResolvedValue({ items: [], cached: false, available: false, complete: false });

    await internal.poll();

    const warm = service.getHealth().sources.find((entry) => entry.source === 'warmCaches');
    expect(warm).toEqual(expect.objectContaining({ lastSuccessAt: null, lastError: 'sonarr: an instance did not answer' }));
  });
});
