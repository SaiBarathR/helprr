import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPollingCycleContext, InstanceBackoff } from '@/lib/polling-cycle';

describe('polling cycle context', () => {
  it('shares one settings result across concurrent consumers', async () => {
    const loadSettings = vi.fn(async () => ({ grouping: true }));
    const context = createPollingCycleContext(loadSettings);

    const results = await Promise.all([
      context.getSettings(),
      context.getSettings(),
      context.getSettings(),
    ]);

    expect(results).toEqual([
      { grouping: true },
      { grouping: true },
      { grouping: true },
    ]);
    expect(loadSettings).toHaveBeenCalledOnce();
    expect(context.getMetrics().settingsReadCount).toBe(1);
  });

  it('shares a rejected settings result without aborting unrelated work', async () => {
    const context = createPollingCycleContext(async () => {
      throw new Error('settings unavailable');
    });
    const unrelated = vi.fn(async () => 'ok');

    const results = await Promise.allSettled([
      context.getSettings(),
      context.getSettings(),
      context.runSource('unrelated', unrelated),
    ]);

    expect(results.map((result) => result.status)).toEqual([
      'rejected',
      'rejected',
      'fulfilled',
    ]);
    expect(unrelated).toHaveBeenCalledOnce();
    expect(context.getMetrics().settingsReadCount).toBe(1);
  });

  it('caps shared instance concurrency at two and isolates failures', async () => {
    const context = createPollingCycleContext(async () => ({}), {
      instanceConcurrency: 2,
    });
    let active = 0;
    let observedMax = 0;

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, index) =>
        context.runInstance(index % 2 === 0 ? 'sonarr' : 'radarr', async () => {
          active += 1;
          observedMax = Math.max(observedMax, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          if (index === 2) throw new Error('one instance failed');
          return index;
        }),
      ),
    );

    expect(observedMax).toBe(2);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(5);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(context.getMetrics()).toMatchObject({
      maxInstanceConcurrency: 2,
      instanceFailures: 1,
    });
  });

  it('transfers a released permit without allowing a new task to barge', async () => {
    const context = createPollingCycleContext(async () => ({}), {
      instanceConcurrency: 1,
    });
    let active = 0;
    let observedMax = 0;
    let releaseFirst = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const task = (gate?: Promise<void>) => async () => {
      active += 1;
      observedMax = Math.max(observedMax, active);
      await gate;
      active -= 1;
    };

    const first = context.runInstance('sonarr', task(firstGate));
    await vi.waitFor(() => expect(active).toBe(1));
    const queued = context.runInstance('sonarr', task());
    releaseFirst();
    const barger = new Promise<void>((resolve, reject) => {
      queueMicrotask(() => {
        context.runInstance('radarr', task()).then(resolve, reject);
      });
    });

    await Promise.all([first, queued, barger]);

    expect(observedMax).toBe(1);
    expect(context.getMetrics().maxInstanceConcurrency).toBe(1);
  });

  it('starts registered Arr sources fairly once their task batches are ready', async () => {
    const context = createPollingCycleContext(async () => ({}), {
      instanceConcurrency: 2,
    });
    const starts: string[] = [];
    const releases = new Map<string, () => void>();
    let draining = false;
    const run = (source: string, id: number) => context.runInstance(source, async () => {
      const key = `${source}-${id}`;
      starts.push(key);
      if (draining) return;
      await new Promise<void>((resolve) => releases.set(key, resolve));
    });

    for (const source of ['sonarr', 'radarr', 'lidarr']) {
      context.registerInstanceSource(source);
    }
    const tasks = [
      run('sonarr', 1),
      run('sonarr', 2),
      run('radarr', 1),
      run('radarr', 2),
      run('lidarr', 1),
      run('lidarr', 2),
    ];
    for (const source of ['sonarr', 'radarr', 'lidarr']) {
      context.markInstanceSourceReady(source);
    }

    await vi.waitFor(() => expect(starts).toHaveLength(2));
    expect(starts).toEqual(['sonarr-1', 'radarr-1']);
    releases.get('sonarr-1')?.();
    await vi.waitFor(() => expect(starts).toHaveLength(3));
    expect(starts[2]).toBe('lidarr-1');

    draining = true;
    for (const release of releases.values()) release();
    await Promise.all(tasks);

    expect(starts).toHaveLength(6);
    expect(context.getMetrics().maxInstanceConcurrency).toBe(2);
  });

  it('does not block a ready family behind stalled source setup', async () => {
    const context = createPollingCycleContext(async () => ({}), {
      instanceConcurrency: 2,
    });
    const run = vi.fn(async () => {});

    context.registerInstanceSource('sonarr');
    context.registerInstanceSource('radarr');
    const task = context.runInstance('sonarr', run);
    context.markInstanceSourceReady('sonarr');

    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    await task;
  });

  it('records source durations using the supplied monotonic clock', async () => {
    const ticks = [10, 14.26];
    const context = createPollingCycleContext(async () => ({}), {
      cycleId: 'cycle-1',
      startedAtMs: 123,
      clock: () => ticks.shift() ?? 14.26,
    });

    await context.runSource('pollSonarr', async () => {});

    expect(context.id).toBe('cycle-1');
    expect(context.startedAtMs).toBe(123);
    expect(context.getMetrics().sourceDurationsMs).toEqual({ pollSonarr: 4.3 });
  });
});

describe('instance backoff', () => {
  const down = { id: 'sonarr-down', version: 1 };
  const fail = async () => { throw new Error('connect ETIMEDOUT'); };
  let now = 0;
  beforeEach(() => { now = 0; });

  // One cycle starting now: a fresh context sharing the tracker, as the polling service does.
  const cycle = (backoff: InstanceBackoff) => createPollingCycleContext(async () => ({}), {
    instanceConcurrency: 1,
    backoff,
    startedAtMs: now,
  });

  it('treats one failure as a blip, then skips the instance for 30 s doubling to 5 min', async () => {
    const backoff = new InstanceBackoff(() => now);
    const task = vi.fn(fail);

    await expect(cycle(backoff).runInstance('sonarr', task, down)).rejects.toThrow('ETIMEDOUT');
    expect(backoff.remainingMs(down)).toBe(0);

    const waits: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      await expect(cycle(backoff).runInstance('sonarr', task, down)).rejects.toThrow('ETIMEDOUT');
      waits.push(backoff.remainingMs(down));
      now += backoff.remainingMs(down);
    }
    expect(waits).toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
    expect(task).toHaveBeenCalledTimes(7);
  });

  it('counts the wait from the start of the failing cycle, so the next tick is not missed', async () => {
    const backoff = new InstanceBackoff(() => now);
    for (let i = 0; i < 2; i += 1) {
      const context = cycle(backoff);
      // The call only fails when the client times out, well into the cycle.
      await context.runInstance('sonarr', async () => { now += 29_000; return fail(); }, down).catch(() => {});
      now = context.startedAtMs + 30_000;
    }
    expect(backoff.remainingMs(down)).toBe(0);
    const task = vi.fn(async () => 'ok');
    await expect(cycle(backoff).runInstance('sonarr', task, down)).resolves.toBe('ok');
  });

  it('skips a backed-off instance at once, without waiting for or taking a slot', async () => {
    const backoff = new InstanceBackoff(() => now);
    for (let i = 0; i < 2; i += 1) {
      await cycle(backoff).runInstance('sonarr', fail, down).catch(() => {});
    }
    now += 10_000;

    const context = cycle(backoff);
    let releaseSlot = () => {};
    const holder = context.runInstance('radarr', () => new Promise<void>((resolve) => { releaseSlot = resolve; }));
    await vi.waitFor(() => expect(context.getMetrics().maxInstanceConcurrency).toBe(1));
    const blocked = vi.fn(fail);

    // The only slot is still held: a skip that queued for it would never settle here.
    await expect(context.runInstance('sonarr', blocked, down)).rejects.toThrow(
      'Skipped after 2 failed polls in a row (last error: connect ETIMEDOUT); next try in 20s',
    );
    expect(blocked).not.toHaveBeenCalled();
    expect(context.getMetrics().instanceFailures).toBe(1);
    releaseSlot();
    await holder;
  });

  it('starts over after a success or an edit to the connection', async () => {
    const backoff = new InstanceBackoff(() => now);
    for (let i = 0; i < 3; i += 1) {
      await cycle(backoff).runInstance('sonarr', fail, down).catch(() => {});
      now += backoff.remainingMs(down);
    }
    expect(backoff.failures(down)).toBe(3);

    // Edited (say, a fixed URL): polled straight away.
    const edited = { ...down, version: 2 };
    expect(backoff.remainingMs(edited)).toBe(0);
    expect(backoff.failures(edited)).toBe(0);
    await cycle(backoff).runInstance('sonarr', async () => 'ok', edited);

    // After a success the next failure is a blip again.
    await cycle(backoff).runInstance('sonarr', fail, edited).catch(() => {});
    expect(backoff.failures(edited)).toBe(1);
    expect(backoff.remainingMs(edited)).toBe(0);
  });

  it('never skips without a tracker or an instance', async () => {
    const backoff = new InstanceBackoff(() => now);
    for (let i = 0; i < 3; i += 1) {
      await createPollingCycleContext(async () => ({})).runInstance('sonarr', fail, down).catch(() => {});
      await cycle(backoff).runInstance('sonarr', fail).catch(() => {});
    }
    expect(backoff.failures(down)).toBe(0);
  });
});
