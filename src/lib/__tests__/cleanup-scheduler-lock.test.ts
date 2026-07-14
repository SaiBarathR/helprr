import { describe, expect, it, vi } from 'vitest';

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

import { runQueueCleanerExclusive } from '@/lib/cleanup/scheduler';

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
