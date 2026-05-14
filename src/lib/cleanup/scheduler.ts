import { logger } from '@/lib/logger';
import { runQueueCleanerCycle, loadQueueCleanerConfig } from './queue-cleaner';
import { runDownloadCleanerCycle, loadDownloadCleanerConfig } from './download-cleaner';
import type { QueueEvaluationResult, DownloadEvaluationResult } from './types';

const LOG = 'cleanup-scheduler';

interface JobState {
  timer: NodeJS.Timeout | null;
  intervalMinutes: number;
  inFlight: Promise<QueueEvaluationResult | DownloadEvaluationResult | null> | null;
}

const state: { queue: JobState; download: JobState } = {
  queue: { timer: null, intervalMinutes: 0, inFlight: null },
  download: { timer: null, intervalMinutes: 0, inFlight: null },
};

function clear(job: JobState) {
  if (job.timer) {
    clearInterval(job.timer);
    job.timer = null;
  }
}

async function safeRunQueue(): Promise<QueueEvaluationResult | null> {
  try {
    return await runQueueCleanerCycle({ dryRun: false, triggeredBy: 'auto' });
  } catch (err) {
    logger.error('Queue cleaner cycle threw', { err: String(err) }, { scope: LOG });
    return null;
  }
}

async function safeRunDownload(): Promise<DownloadEvaluationResult | null> {
  try {
    return await runDownloadCleanerCycle({ dryRun: false, triggeredBy: 'auto' });
  } catch (err) {
    logger.error('Download cleaner cycle threw', { err: String(err) }, { scope: LOG });
    return null;
  }
}

export async function awaitInFlightQueue(): Promise<void> {
  if (state.queue.inFlight) {
    try {
      await state.queue.inFlight;
    } catch {
      /* swallowed */
    }
  }
}

export async function awaitInFlightDownload(): Promise<void> {
  if (state.download.inFlight) {
    try {
      await state.download.inFlight;
    } catch {
      /* swallowed */
    }
  }
}

function tickQueue(): void {
  if (state.queue.inFlight) return; // skip overlapping
  state.queue.inFlight = safeRunQueue() as Promise<QueueEvaluationResult | DownloadEvaluationResult | null>;
  state.queue.inFlight.finally(() => {
    state.queue.inFlight = null;
  });
}

function tickDownload(): void {
  if (state.download.inFlight) return;
  state.download.inFlight = safeRunDownload() as Promise<QueueEvaluationResult | DownloadEvaluationResult | null>;
  state.download.inFlight.finally(() => {
    state.download.inFlight = null;
  });
}

export async function restartQueueCleaner(): Promise<void> {
  const cfg = await loadQueueCleanerConfig();
  clear(state.queue);
  state.queue.intervalMinutes = cfg.intervalMinutes;
  if (!cfg.enabled) {
    logger.info('Queue cleaner disabled; timer cleared', undefined, { scope: LOG });
    return;
  }
  const ms = Math.max(1, cfg.intervalMinutes) * 60_000;
  state.queue.timer = setInterval(tickQueue, ms);
  logger.info('Queue cleaner timer started', { intervalMinutes: cfg.intervalMinutes }, { scope: LOG });
}

export async function restartDownloadCleaner(): Promise<void> {
  const cfg = await loadDownloadCleanerConfig();
  clear(state.download);
  state.download.intervalMinutes = cfg.intervalMinutes;
  if (!cfg.enabled) {
    logger.info('Download cleaner disabled; timer cleared', undefined, { scope: LOG });
    return;
  }
  const ms = Math.max(1, cfg.intervalMinutes) * 60_000;
  state.download.timer = setInterval(tickDownload, ms);
  logger.info('Download cleaner timer started', { intervalMinutes: cfg.intervalMinutes }, { scope: LOG });
}

export async function startCleanupJobs(): Promise<void> {
  await Promise.allSettled([restartQueueCleaner(), restartDownloadCleaner()]);
}
