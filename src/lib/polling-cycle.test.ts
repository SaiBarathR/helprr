import { describe, expect, it, vi } from 'vitest';
import { createPollingCycleContext } from '@/lib/polling-cycle';

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
