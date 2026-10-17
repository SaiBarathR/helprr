import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('@/lib/cleanup/queue-cleaner', () => ({
  loadQueueCleanerConfig: vi.fn(),
  runQueueCleanerCycle: vi.fn(),
}));
vi.mock('@/lib/cleanup/download-cleaner', () => ({
  loadDownloadCleanerConfig: vi.fn(),
  runDownloadCleanerCycle: vi.fn(),
}));

import {
  runQueueCleanerExclusive,
  startCleanupJobs,
  stopCleanupJobs,
} from '@/lib/cleanup/scheduler';
import { loadQueueCleanerConfig, runQueueCleanerCycle } from '@/lib/cleanup/queue-cleaner';
import { loadDownloadCleanerConfig, runDownloadCleanerCycle } from '@/lib/cleanup/download-cleaner';
import { withApiLogging } from '@/lib/api-logger';
import { currentRequestContext } from '@/lib/request-context';

describe('cleanup scheduler lock', () => {
  it('serializes manual callers through the scheduler execution slot', async () => {
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = runQueueCleanerExclusive(async () => {
      order.push('first-start');
      await gate;
      order.push('first-end');
      return 'first';
    });
    await Promise.resolve();

    const second = runQueueCleanerExclusive(async () => {
      order.push('second-start');
      return 'second';
    });
    await Promise.resolve();

    expect(order).toEqual(['first-start']);
    releaseFirst?.();
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
    expect(order).toEqual(['first-start', 'first-end', 'second-start']);
  });
});

describe('scheduled cleanup cycles', () => {
  afterEach(() => {
    stopCleanupJobs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('run as the cleanup scheduler, outside the request that started them', async () => {
    vi.useFakeTimers();
    const config = { enabled: true, intervalMinutes: 1, autoRunMode: 'enabled' };
    vi.mocked(loadQueueCleanerConfig).mockResolvedValue(config as never);
    vi.mocked(loadDownloadCleanerConfig).mockResolvedValue(config as never);
    const result = { decisions: [], succeeded: 0, failed: 0, warnings: [] };
    vi.mocked(runQueueCleanerCycle).mockResolvedValue(result as never);
    vi.mocked(runDownloadCleanerCycle).mockResolvedValue(result as never);
    // A real timer runs its callback in the async context it was created in.
    // Fake timers do not carry context, so record it at creation instead.
    const fakeSetInterval = globalThis.setInterval;
    const timerContexts: unknown[] = [];
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((callback: () => void, ms: number) => {
      timerContexts.push(currentRequestContext());
      return fakeSetInterval(callback, ms);
    }) as typeof setInterval);

    // A config save restarts the timers from inside its own API request.
    const save = withApiLogging(async () => {
      await startCleanupJobs();
      return new Response(null, { status: 204 });
    });
    await save();
    await vi.advanceTimersByTimeAsync(60_000);

    const scheduled = {
      dryRun: false,
      triggeredBy: 'auto',
      actor: { id: null, username: 'system:cleanup-scheduler' },
    };
    expect(runQueueCleanerCycle).toHaveBeenCalledWith(scheduled);
    expect(runDownloadCleanerCycle).toHaveBeenCalledWith(scheduled);
    expect(timerContexts).toEqual([undefined, undefined]);
  });
});
