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
}));

import { PollingService } from '@/lib/polling-service';

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
