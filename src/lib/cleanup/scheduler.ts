import { logger } from '@/lib/logger';
import { runQueueCleanerCycle, loadQueueCleanerConfig } from './queue-cleaner';
import { runDownloadCleanerCycle, loadDownloadCleanerConfig } from './download-cleaner';
import type {
  AutoRunMode,
  DownloadEvaluationResult,
  QueueEvaluationResult,
} from './types';

const LOG = 'cleanup-scheduler';

interface JobState {
  timer: NodeJS.Timeout | null;
  intervalMinutes: number;
  inFlight: Promise<QueueEvaluationResult | DownloadEvaluationResult | null> | null;
  autoRunMode: AutoRunMode;
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
      queue: { timer: null, intervalMinutes: 0, inFlight: null, autoRunMode: 'disabled' },
      download: { timer: null, intervalMinutes: 0, inFlight: null, autoRunMode: 'disabled' },
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
    return await runQueueCleanerCycle({ dryRun, triggeredBy: 'auto' });
  } catch (err) {
    logger.error('Queue cleaner cycle threw', { err: String(err) }, { scope: LOG });
    return null;
  }
}

async function safeRunDownload(): Promise<DownloadEvaluationResult | null> {
  const job = getState().download;
  const dryRun = job.autoRunMode === 'dryRun';
  try {
    return await runDownloadCleanerCycle({ dryRun, triggeredBy: 'auto' });
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

function tickQueue(): void {
  const s = getState();
  if (s.queue.inFlight) return; // skip overlapping
  if (s.queue.autoRunMode === 'disabled') return; // safety: should not be scheduled, but double-check
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
  if (!cfg.enabled || cfg.autoRunMode === 'disabled') {
    logger.info('Queue cleaner auto-run disabled; timer cleared', {
      enabled: cfg.enabled,
      autoRunMode: cfg.autoRunMode,
    }, { scope: LOG });
    return;
  }
  const ms = Math.max(1, cfg.intervalMinutes) * 60_000;
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
  if (!cfg.enabled || cfg.autoRunMode === 'disabled') {
    logger.info('Download cleaner auto-run disabled; timer cleared', {
      enabled: cfg.enabled,
      autoRunMode: cfg.autoRunMode,
    }, { scope: LOG });
    return;
  }
  const ms = Math.max(1, cfg.intervalMinutes) * 60_000;
  s.download.timer = setInterval(tickDownload, ms);
  logger.info('Download cleaner timer started', {
    intervalMinutes: cfg.intervalMinutes,
    autoRunMode: cfg.autoRunMode,
  }, { scope: LOG });
}

export async function startCleanupJobs(): Promise<void> {
  await Promise.allSettled([restartQueueCleaner(), restartDownloadCleaner()]);
}
