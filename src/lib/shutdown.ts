import { logger, flushPendingWrites } from '@/lib/logger';
import { prisma } from '@/lib/db';
import { disconnectRedisClient } from '@/lib/redis';
import { pollingService } from '@/lib/polling-service';
import { stopCleanupJobs, awaitInFlightQueue, awaitInFlightDownload } from '@/lib/cleanup/scheduler';

// Bounded drain: an in-flight cleanup cycle must settle before exit (killing it
// mid-delete leaves qBittorrent/Arr state inconsistent — see
// executeQueueCleanerRemoval), but Docker SIGKILLs at stop_grace_period, so the
// drain must stay comfortably under it (compose sets 45s).
const DRAIN_TIMEOUT_MS = 30_000;

const globalForShutdown = globalThis as typeof globalThis & {
  shutdownHandlersRegistered?: boolean;
  shutdownInProgress?: boolean;
};

async function drain(signal: string): Promise<void> {
  logger.info(`${signal} received — draining background work before exit`, {}, { scope: 'shutdown' });

  // Stop new work first: no new polling/cleanup cycles start after this.
  pollingService.stop();
  stopCleanupJobs();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    Promise.allSettled([
      awaitInFlightQueue(),
      awaitInFlightDownload(),
      pollingService.awaitInFlightPoll(),
    ]).then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), DRAIN_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timer);

  if (timedOut) {
    logger.warn('Shutdown drain timed out; exiting with work in flight', { timeoutMs: DRAIN_TIMEOUT_MS }, { scope: 'shutdown' });
  } else {
    logger.info('Background work drained; exiting', {}, { scope: 'shutdown' });
  }

  await prisma.$disconnect().catch(() => {});
  await disconnectRedisClient().catch(() => {});
  // Last, so the drain log lines above make it to disk.
  await flushPendingWrites().catch(() => {});
}

// The production entrypoint execs node as PID 1 and sets
// NEXT_MANUAL_SIG_HANDLE=true, so this coordinator owns SIGTERM/SIGINT instead
// of Next.js exiting immediately. Registered once from instrumentation.ts;
// the globalThis flag keeps dev hot-reload from stacking handlers.
export function registerShutdownHandlers(): void {
  if (globalForShutdown.shutdownHandlersRegistered) return;
  globalForShutdown.shutdownHandlersRegistered = true;

  const onSignal = (signal: NodeJS.Signals) => {
    // Second signal = operator insisting — exit immediately.
    if (globalForShutdown.shutdownInProgress) process.exit(130);
    globalForShutdown.shutdownInProgress = true;

    void drain(signal)
      .catch((err) => {
        console.error('[Helprr] Shutdown drain failed:', err);
      })
      .finally(() => process.exit(0));
  };

  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}
