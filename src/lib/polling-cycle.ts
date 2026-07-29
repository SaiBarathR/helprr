export interface PollingCycleMetrics {
  settingsReadCount: number;
  maxInstanceConcurrency: number;
  instanceFailures: number;
  sourceDurationsMs: Record<string, number>;
}

export interface PollingCycleContext<TSettings> {
  id: string;
  startedAtMs: number;
  getSettings: () => Promise<TSettings>;
  registerInstanceSource: (source: string) => void;
  markInstanceSourceReady: (source: string) => void;
  runInstance: <T>(source: string, task: () => Promise<T>) => Promise<T>;
  runSource: <T>(source: string, task: () => Promise<T>) => Promise<T>;
  getMetrics: () => PollingCycleMetrics;
}

interface PollingCycleOptions {
  instanceConcurrency?: number;
  cycleId?: string;
  startedAtMs?: number;
  clock?: () => number;
}

export function createPollingCycleContext<TSettings>(
  loadSettings: () => Promise<TSettings>,
  options: PollingCycleOptions = {},
): PollingCycleContext<TSettings> {
  const instanceConcurrency = Math.max(1, options.instanceConcurrency ?? 2);
  const clock = options.clock ?? (() => performance.now());
  const metrics: PollingCycleMetrics = {
    settingsReadCount: 0,
    maxInstanceConcurrency: 0,
    instanceFailures: 0,
    sourceDurationsMs: {},
  };
  let settingsPromise: Promise<TSettings> | undefined;
  let activeInstances = 0;
  let nextSourceIndex = 0;
  let readinessBarrierReleased = false;
  let readinessTimer: ReturnType<typeof setTimeout> | undefined;
  const instanceSources = new Map<string, {
    ready: boolean;
    waiters: Array<() => void>;
  }>();

  const pump = () => {
    if (!readinessBarrierReleased) {
      if ([...instanceSources.values()].every((source) => source.ready)) {
        readinessBarrierReleased = true;
        if (readinessTimer) clearTimeout(readinessTimer);
      } else {
        readinessTimer ??= setTimeout(() => {
          readinessBarrierReleased = true;
          readinessTimer = undefined;
          pump();
        }, 0);
        return;
      }
    }

    const sources = [...instanceSources.values()];
    while (activeInstances < instanceConcurrency) {
      let selectedIndex = -1;
      for (let offset = 0; offset < sources.length; offset += 1) {
        const index = (nextSourceIndex + offset) % sources.length;
        if (sources[index].ready && sources[index].waiters.length > 0) {
          selectedIndex = index;
          break;
        }
      }
      if (selectedIndex === -1) return;

      const resolve = sources[selectedIndex].waiters.shift();
      nextSourceIndex = (selectedIndex + 1) % sources.length;
      activeInstances += 1;
      metrics.maxInstanceConcurrency = Math.max(
        metrics.maxInstanceConcurrency,
        activeInstances,
      );
      resolve?.();
    }
  };

  const acquire = (source: string) => {
    let sourceState = instanceSources.get(source);
    if (!sourceState) {
      sourceState = { ready: true, waiters: [] };
      instanceSources.set(source, sourceState);
    }
    return new Promise<void>((resolve) => {
      sourceState.waiters.push(resolve);
      pump();
    });
  };

  const release = () => {
    activeInstances -= 1;
    pump();
  };

  return {
    id: options.cycleId ?? crypto.randomUUID(),
    startedAtMs: options.startedAtMs ?? Date.now(),
    getSettings: () => {
      if (!settingsPromise) {
        metrics.settingsReadCount += 1;
        settingsPromise = Promise.resolve().then(loadSettings);
      }
      return settingsPromise;
    },
    registerInstanceSource: (source) => {
      if (!instanceSources.has(source)) {
        instanceSources.set(source, { ready: false, waiters: [] });
      }
    },
    markInstanceSourceReady: (source) => {
      const sourceState = instanceSources.get(source);
      if (sourceState) {
        sourceState.ready = true;
      } else {
        instanceSources.set(source, { ready: true, waiters: [] });
      }
      pump();
    },
    runInstance: async (source, task) => {
      await acquire(source);
      try {
        return await task();
      } catch (error) {
        metrics.instanceFailures += 1;
        throw error;
      } finally {
        release();
      }
    },
    runSource: async (source, task) => {
      const startedAt = clock();
      try {
        return await task();
      } finally {
        metrics.sourceDurationsMs[source] = Math.round((clock() - startedAt) * 10) / 10;
      }
    },
    getMetrics: () => ({
      ...metrics,
      sourceDurationsMs: { ...metrics.sourceDurationsMs },
    }),
  };
}
