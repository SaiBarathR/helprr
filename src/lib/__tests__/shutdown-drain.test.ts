import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state = { queueCycle: Promise.resolve() as Promise<unknown>, order: [] as string[] };
  // Records each step of the drain, in order.
  const log = (step: string) => () => { state.order.push(step); };
  return Object.assign(state, { log });
});
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(mocks.log('warn timed out')) },
  flushPendingWrites: vi.fn(async () => { mocks.order.push('flush logs'); }),
}));
vi.mock('@/lib/db', () => ({ prisma: { $disconnect: vi.fn(async () => { mocks.order.push('disconnect db'); }) } }));
vi.mock('@/lib/redis', () => ({ disconnectRedisClient: vi.fn(async () => { mocks.order.push('disconnect redis'); }) }));
vi.mock('@/lib/polling-service', () => ({
  pollingService: { stop: vi.fn(mocks.log('stop polling')), awaitInFlightPoll: vi.fn(async () => {}) },
}));
vi.mock('@/lib/cleanup/scheduler', () => ({
  stopCleanupJobs: vi.fn(mocks.log('stop cleanup jobs')),
  awaitInFlightQueue: vi.fn(() => mocks.queueCycle),
  awaitInFlightDownload: vi.fn(async () => {}),
}));
vi.mock('@/lib/jellyfin-playback/session-reaper', () => ({ stopPlaybackSessionReaper: vi.fn() }));
vi.mock('@/lib/cache/image-cache', () => ({
  beginImageCacheShutdown: vi.fn(),
  awaitImageCacheBackgroundWork: vi.fn(async () => {}),
}));

import { registerShutdownHandlers } from '@/lib/shutdown';

const flags = globalThis as typeof globalThis & { shutdownHandlersRegistered?: boolean; shutdownInProgress?: boolean };
let onSignal: (signal: NodeJS.Signals) => void;
let exit: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  mocks.order = [];
  delete flags.shutdownHandlersRegistered;
  delete flags.shutdownInProgress;
  const on = vi.spyOn(process, 'on').mockImplementation(((event: string, handler: (signal: NodeJS.Signals) => void) => {
    if (event === 'SIGTERM') onSignal = handler;
    return process;
  }) as typeof process.on);
  exit = vi.spyOn(process, 'exit').mockImplementation((() => { mocks.order.push('exit'); }) as typeof process.exit);
  registerShutdownHandlers();
  expect(on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('shutdown on a container restart', () => {
  it('stops new work, waits for the cleanup cycle in flight, then exits', async () => {
    let finishCycle!: () => void;
    mocks.queueCycle = new Promise<void>((resolve) => { finishCycle = resolve; });

    onSignal('SIGTERM');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(exit).not.toHaveBeenCalled();
    expect(mocks.order).toEqual(['stop polling', 'stop cleanup jobs']);

    finishCycle();
    await vi.advanceTimersByTimeAsync(0);
    expect(exit).toHaveBeenCalledWith(0);
    expect(mocks.order).toEqual(['stop polling', 'stop cleanup jobs', 'disconnect db', 'disconnect redis', 'flush logs', 'exit']);
  });

  it('exits after 30 seconds even if the cycle never finishes', async () => {
    mocks.queueCycle = new Promise(() => {});

    onSignal('SIGTERM');
    await vi.advanceTimersByTimeAsync(29_999);
    expect(exit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(mocks.order).toContain('warn timed out');
    expect(mocks.order.indexOf('warn timed out')).toBeLessThan(mocks.order.indexOf('disconnect db'));
  });

  it('exits at once on a second signal', async () => {
    mocks.queueCycle = new Promise(() => {});

    onSignal('SIGTERM');
    onSignal('SIGTERM');
    expect(exit).toHaveBeenCalledWith(130);
  });
});
