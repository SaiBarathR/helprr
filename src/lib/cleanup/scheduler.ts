import { logger } from '@/lib/logger';
import { runQueueCleanerCycle, loadQueueCleanerConfig } from './queue-cleaner';
import { runDownloadCleanerCycle, loadDownloadCleanerConfig } from './download-cleaner';
import type {
  AutoRunMode,
  DownloadEvaluationResult,
  QueueEvaluationResult,
} from './types';

const LOG = 'cleanup-scheduler';

// Watchdog on a single cleanup cycle. Every upstream HTTP call carries its own
// 30s axios timeout, so a cycle always settles eventually; the watchdog only
// flags one that runs long. It must NOT abandon the cycle early — `inFlight`
// has to stay set until the cycle actually settles, or the next tick starts a
// second concurrent cycle that double-strikes/double-deletes the same torrents
// when the slow one finally returns.
const CYCLE_TIMEOUT_MS = 5 * 60_000;

async function runWithWatchdog<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const timer = setTimeout(() => {
    logger.error(`${label} cycle exceeded ${CYCLE_TIMEOUT_MS}ms watchdog — next cycle is blocked until it settles`, {}, { scope: LOG });
  }, CYCLE_TIMEOUT_MS);
  try {
    return await fn();
  } finally {
    clearTimeout(timer);
  }
}

interface JobState {
  timer: NodeJS.Timeout | null;
  intervalMinutes: number;
  inFlight: Promise<unknown> | null;
  autoRunMode: AutoRunMode;
  // Epoch ms of the last tick (or restart). Drives the dashboard countdown.
  // In-memory only; resets across server restarts.
  lastRunAt: number | null;
}

interface SchedulerState {
  queue: JobState;
  download: JobState;
}

// Survive Next.js dev hot-reload: stash state on globalThis so
// re-importing this module doesn't stack additional timers.
const GLOBAL_KEY = '__helprrCleanupScheduler';
const globalAny = globalThis as unknown as Record<string, unknown>;
function getState(): SchedulerState {
  let s = globalAny[GLOBAL_KEY] as SchedulerState | undefined;
  if (!s) {
    s = {
      queue: { timer: null, intervalMinutes: 0, inFlight: null, autoRunMode: 'disabled', lastRunAt: null },
      download: { timer: null, intervalMinutes: 0, inFlight: null, autoRunMode: 'disabled', lastRunAt: null },
    };
    globalAny[GLOBAL_KEY] = s;
  }
  return s;
}

function clear(job: JobState) {
  if (job.timer) {
    clearInterval(job.timer);
    job.timer = null;
  }
}

async function safeRunQueue(): Promise<QueueEvaluationResult | null> {
  const job = getState().queue;
  // dryRun mode runs the cycle without actually deleting; the cycle itself
  // writes dryRunPreview history rows so users can see what would happen.
  const dryRun = job.autoRunMode === 'dryRun';
  try {
    return await runWithWatchdog('Queue cleaner', () => runQueueCleanerCycle({ dryRun, triggeredBy: 'auto' }));
  } catch (err) {
    logger.error('Queue cleaner cycle threw', { err: String(err) }, { scope: LOG });
    return null;
  }
}

async function safeRunDownload(): Promise<DownloadEvaluationResult | null> {
  const job = getState().download;
  const dryRun = job.autoRunMode === 'dryRun';
  try {
    return await runWithWatchdog('Download cleaner', () => runDownloadCleanerCycle({ dryRun, triggeredBy: 'auto' }));
  } catch (err) {
    logger.error('Download cleaner cycle threw', { err: String(err) }, { scope: LOG });
    return null;
  }
}

export async function awaitInFlightQueue(): Promise<void> {
  const s = getState();
  if (s.queue.inFlight) {
    try {
      await s.queue.inFlight;
    } catch {
      /* swallowed */
    }
  }
}

export async function awaitInFlightDownload(): Promise<void> {
  const s = getState();
  if (s.download.inFlight) {
    try {
      await s.download.inFlight;
    } catch {
      /* swallowed */
    }
  }
}

async function runExclusive<T>(kind: 'queue' | 'download', fn: () => Promise<T>): Promise<T> {
  const job = getState()[kind];
  // Wait/recheck in a loop: two manual callers can arrive while a scheduled
  // cycle is settling. Only the first caller to observe the empty slot claims
  // it; later callers then wait on that new promise.
  while (job.inFlight) {
    try {
      await job.inFlight;
    } catch {
      /* the slot is still released in the owner's finally */
    }
  }

  const promise = fn();
  job.inFlight = promise;
  try {
    return await promise;
  } finally {
    if (job.inFlight === promise) job.inFlight = null;
  }
}

/** Register manual preview/execution in the same slot used by the scheduler. */
export function runQueueCleanerExclusive<T>(fn: () => Promise<T>): Promise<T> {
  return runExclusive('queue', fn);
}

/** Register manual preview/execution in the same slot used by the scheduler. */
export function runDownloadCleanerExclusive<T>(fn: () => Promise<T>): Promise<T> {
  return runExclusive('download', fn);
}

function tickQueue(): void {
  const s = getState();
  if (s.queue.inFlight) return; // skip overlapping
  if (s.queue.autoRunMode === 'disabled') return; // safety: should not be scheduled, but double-check
  s.queue.lastRunAt = Date.now();
  const p = safeRunQueue() as Promise<QueueEvaluationResult | DownloadEvaluationResult | null>;
  s.queue.inFlight = p;
  p.finally(() => {
    s.queue.inFlight = null;
  });
}

function tickDownload(): void {
  const s = getState();
  if (s.download.inFlight) return;
  if (s.download.autoRunMode === 'disabled') return;
  s.download.lastRunAt = Date.now();
  const p = safeRunDownload() as Promise<QueueEvaluationResult | DownloadEvaluationResult | null>;
  s.download.inFlight = p;
  p.finally(() => {
    s.download.inFlight = null;
  });
}

export async function restartQueueCleaner(): Promise<void> {
  const s = getState();
  const cfg = await loadQueueCleanerConfig();
  clear(s.queue);
  s.queue.intervalMinutes = cfg.intervalMinutes;
  s.queue.autoRunMode = cfg.autoRunMode;
  s.queue.lastRunAt = null;
  if (!cfg.enabled || cfg.autoRunMode === 'disabled') {
    logger.info('Queue cleaner auto-run disabled; timer cleared', {
      enabled: cfg.enabled,
      autoRunMode: cfg.autoRunMode,
    }, { scope: LOG });
    return;
  }
  const ms = Math.max(1, cfg.intervalMinutes) * 60_000;
  // Anchor the countdown at the moment the timer is installed so the dashboard
  // can show "next run in N min" honestly until the first tick fires.
  s.queue.lastRunAt = Date.now();
  s.queue.timer = setInterval(tickQueue, ms);
  logger.info('Queue cleaner timer started', {
    intervalMinutes: cfg.intervalMinutes,
    autoRunMode: cfg.autoRunMode,
  }, { scope: LOG });
}

export async function restartDownloadCleaner(): Promise<void> {
  const s = getState();
  const cfg = await loadDownloadCleanerConfig();
  clear(s.download);
  s.download.intervalMinutes = cfg.intervalMinutes;
  s.download.autoRunMode = cfg.autoRunMode;
  s.download.lastRunAt = null;
  if (!cfg.enabled || cfg.autoRunMode === 'disabled') {
    logger.info('Download cleaner auto-run disabled; timer cleared', {
      enabled: cfg.enabled,
      autoRunMode: cfg.autoRunMode,
    }, { scope: LOG });
    return;
  }
  const ms = Math.max(1, cfg.intervalMinutes) * 60_000;
  s.download.lastRunAt = Date.now();
  s.download.timer = setInterval(tickDownload, ms);
  logger.info('Download cleaner timer started', {
    intervalMinutes: cfg.intervalMinutes,
    autoRunMode: cfg.autoRunMode,
  }, { scope: LOG });
}

export async function startCleanupJobs(): Promise<void> {
  await Promise.allSettled([restartQueueCleaner(), restartDownloadCleaner()]);
}

/** Clear both timers so no new cycles start (shutdown). In-flight cycles keep
 *  running — drain them with awaitInFlightQueue/awaitInFlightDownload. */
export function stopCleanupJobs(): void {
  const s = getState();
  clear(s.queue);
  clear(s.download);
}

export interface CleanerSchedulerStatus {
  autoRunMode: AutoRunMode;
  intervalMinutes: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
  running: boolean;
}

export interface SchedulerStatusSnapshot {
  queue: CleanerSchedulerStatus;
  download: CleanerSchedulerStatus;
}

function snapshotJob(j: JobState): CleanerSchedulerStatus {
  const nextRunAt =
    j.timer && j.lastRunAt != null && j.intervalMinutes > 0
      ? j.lastRunAt + j.intervalMinutes * 60_000
      : null;
  return {
    autoRunMode: j.autoRunMode,
    intervalMinutes: j.intervalMinutes,
    lastRunAt: j.lastRunAt,
    nextRunAt,
    running: j.inFlight != null,
  };
}

export function getSchedulerStatus(): SchedulerStatusSnapshot {
  const s = getState();
  return {
    queue: snapshotJob(s.queue),
    download: snapshotJob(s.download),
  };
}
