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
  runInstance: <T>(source: string, task: () => Promise<T>, instance?: BackoffInstance) => Promise<T>;
  runSource: <T>(source: string, task: () => Promise<T>) => Promise<T>;
  getMetrics: () => PollingCycleMetrics;
}

/** Which connection an instance poll is for; `version` changes when it is edited. */
export interface BackoffInstance {
  id: string;
  version: number;
}

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 5 * 60_000;

/**
 * Per-instance skip after repeated failures, kept across cycles. A down
 * upstream (worst case: packets dropped, so every call waits out the client
 * timeout) would otherwise hold a shared limiter slot every cycle and delay
 * the healthy instances. One failure is treated as a blip; from the second in
 * a row the instance is skipped for 30 s, doubling to 5 min. The wait counts
 * from the start of the cycle that failed, so it lines up with cycle ticks. A
 * success, or an edit to the connection, starts over.
 */
export class InstanceBackoff {
  private entries = new Map<string, { version: number; failures: number; retryAt: number; lastError: string }>();

  constructor(private clock: () => number = Date.now) {}

  /** Milliseconds until this instance may be polled again; 0 = poll now. */
  remainingMs(instance: BackoffInstance): number {
    const entry = this.current(instance);
    return entry ? Math.max(0, entry.retryAt - this.clock()) : 0;
  }

  failures(instance: BackoffInstance): number {
    return this.current(instance)?.failures ?? 0;
  }

  /** Why a skipped instance is skipped, keeping the error that caused it. */
  skipMessage(instance: BackoffInstance): string {
    const entry = this.current(instance);
    const waitS = Math.ceil(this.remainingMs(instance) / 1000);
    return `Skipped after ${entry?.failures ?? 0} failed polls in a row (last error: ${entry?.lastError}); next try in ${waitS}s`;
  }

  private current(instance: BackoffInstance) {
    const entry = this.entries.get(instance.id);
    return entry && entry.version === instance.version ? entry : undefined;
  }

  recordSuccess(instance: BackoffInstance): void {
    this.entries.delete(instance.id);
  }

  recordFailure(instance: BackoffInstance, error: unknown, cycleStartedAtMs: number): void {
    const failures = this.failures(instance) + 1;
    const delayMs = failures < 2 ? 0 : Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 2));
    this.entries.set(instance.id, {
      version: instance.version,
      failures,
      retryAt: cycleStartedAtMs + delayMs,
      lastError: error instanceof Error ? error.message : String(error),
    });
  }
}

interface PollingCycleOptions {
  instanceConcurrency?: number;
  /** Shared across cycles; without it instances are never skipped. */
  backoff?: InstanceBackoff;
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
  const startedAtMs = options.startedAtMs ?? Date.now();
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
    startedAtMs,
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
    runInstance: async (source, task, instance) => {
      const backoff = options.backoff;
      const waitMs = instance && backoff ? backoff.remainingMs(instance) : 0;
      if (instance && backoff && waitMs > 0) {
        // Skipped without taking a slot; still a failure for the job report.
        metrics.instanceFailures += 1;
        throw new Error(backoff.skipMessage(instance));
      }
      await acquire(source);
      try {
        const result = await task();
        if (instance && backoff) backoff.recordSuccess(instance);
        return result;
      } catch (error) {
        metrics.instanceFailures += 1;
        if (instance && backoff) backoff.recordFailure(instance, error, startedAtMs);
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
