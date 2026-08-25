import { describe, expect, it, vi } from 'vitest';
import type { ImageAccountingRedis } from '@/lib/cache/image-cache-accounting';
import {
  acquireScheduledImageProcessingLease,
  getImageProcessingSnapshot,
  releaseScheduledImageProcessingLease,
} from '@/lib/cache/image-processing-scheduler';

describe('image processing scheduler', () => {
  it('preserves per-user FIFO order while rotating capacity fairly between users', async () => {
    const running = await Promise.all([
      ...['a', 'b', 'c'].flatMap((user) => (
        Array.from({ length: 5 }, () => acquireScheduledImageProcessingLease(null, user))
      )),
      acquireScheduledImageProcessingLease(null, 'd'),
    ]);
    expect(running.every((result) => result.ok)).toBe(true);
    expect(getImageProcessingSnapshot()).toMatchObject({ currentRunning: 16 });

    const order: string[] = [];
    const aFirst = acquireScheduledImageProcessingLease(null, 'a')
      .then((result) => {
        order.push('a-first');
        return result;
      });
    const aSecond = acquireScheduledImageProcessingLease(null, 'a')
      .then((result) => {
        order.push('a-second');
        return result;
      });
    const eFirst = acquireScheduledImageProcessingLease(null, 'e')
      .then((result) => {
        order.push('e-first');
        return result;
      });

    const aRunning = running.find((result) => result.ok && result.lease.userKey === 'a');
    const bRunning = running.find((result) => result.ok && result.lease.userKey === 'b');
    if (!aRunning?.ok || !bRunning?.ok) throw new Error('Expected running leases');
    await releaseScheduledImageProcessingLease(null, aRunning.lease);
    const acquiredA = await aFirst;
    expect(acquiredA.ok).toBe(true);

    await releaseScheduledImageProcessingLease(null, bRunning.lease);
    const acquiredE = await eFirst;
    expect(acquiredE.ok).toBe(true);
    expect(order).toEqual(['a-first', 'e-first']);

    if (acquiredA.ok) await releaseScheduledImageProcessingLease(null, acquiredA.lease);
    const acquiredASecond = await aSecond;
    expect(acquiredASecond.ok).toBe(true);
    expect(order).toEqual(['a-first', 'e-first', 'a-second']);

    if (acquiredE.ok) await releaseScheduledImageProcessingLease(null, acquiredE.lease);
    if (acquiredASecond.ok) {
      await releaseScheduledImageProcessingLease(null, acquiredASecond.lease);
    }
    for (const result of running) {
      if (result.ok) await releaseScheduledImageProcessingLease(null, result.lease);
    }
    expect(getImageProcessingSnapshot()).toMatchObject({ queueDepth: 0, currentRunning: 0 });
  });

  it('releases a Redis lease when cancellation arrives during acquisition', async () => {
    let resolveAcquire!: (value: number) => void;
    const acquireGate = new Promise<number>((resolve) => {
      resolveAcquire = resolve;
    });
    const evalMock = vi.fn(async (script: string) => {
      if (script.includes('image-cache-acquire-processing-lease-v1')) return acquireGate;
      if (script.includes('image-cache-release-processing-lease-v1')) return 1;
      throw new Error('Unexpected script');
    });
    const redis = {
      get: vi.fn(),
      set: vi.fn(),
      hGetAll: vi.fn(),
      eval: evalMock,
    } as unknown as ImageAccountingRedis;
    const controller = new AbortController();
    const pending = acquireScheduledImageProcessingLease(redis, 'cancelled-user', {
      signal: controller.signal,
    });

    controller.abort();
    resolveAcquire(1);

    await expect(pending).resolves.toMatchObject({ ok: false, reason: 'aborted' });
    expect(evalMock.mock.calls.some(([script]) => (
      String(script).includes('image-cache-release-processing-lease-v1')
    ))).toBe(true);
    expect(getImageProcessingSnapshot()).toMatchObject({ queueDepth: 0, currentRunning: 0 });
  });
});
