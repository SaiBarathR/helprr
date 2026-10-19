// Low-space alerts per thresholded disk, reminded at most every few hours while it stays low.
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getAggregatedDiskSpace, diskId, parseDiskThresholds, parseDiskAlertState, diskAlertStateEqual, type DiskAlertState } from '@/lib/disk-space';
import { logger } from '@/lib/logger';
import { noteJobFailure } from '@/lib/polling-job-report';
import { errorMessage, notifyAndLog, type CycleContext } from './shared';

// While a disk stays below its threshold, re-remind at most this often. Reset on
// recovery, so a later drop alerts immediately rather than waiting out the window.
const DISK_ALERT_REMINDER_MS = 6 * 60 * 60 * 1000; // 6 hours

// Per-disk low-space alerts. Thresholds are global/admin config
// (AppSettings.diskThresholds); the below/above edge + last-reminder time per
// disk live in AppSettings.diskAlertState (aggregated, cross-connection — so
// PollingState, which is keyed per connection, is the wrong store). notifyEvent
// does NOT suppress repeats, so this state is what prevents a push every cycle.
export async function checkDiskSpace(context: CycleContext): Promise<void> {
  const settings = await context.getSettings();
  const thresholds = parseDiskThresholds(settings.diskThresholds).filter((t) => t.enabled);
  if (thresholds.length === 0) return; // feature unused → zero cost

  let disks;
  try {
    disks = await getAggregatedDiskSpace();
  } catch (error) {
    noteJobFailure(error);
    logger.debug('Disk-space check skipped: could not read disk space', {
      error: errorMessage(error),
    }, { scope: 'polling' });
    return;
  }
  if (disks.length === 0) return;

  const diskById = new Map(disks.map((d) => [diskId(d), d]));
  const prevState = parseDiskAlertState(settings.diskAlertState);
  const nextState: DiskAlertState = {};
  const nowMs = context.startedAtMs;
  const nowIso = new Date(context.startedAtMs).toISOString();

  for (const threshold of thresholds) {
    const disk = diskById.get(threshold.diskId);
    if (!disk) continue; // thresholded disk not present this cycle — prune its state

    const freeGb = disk.freeSpace / 1024 ** 3;
    const belowNow = freeGb < threshold.minFreeGb;
    const prev = prevState[threshold.diskId] ?? { below: false, lastAlertAt: null };

    if (!belowNow) {
      // Recovered (or never below): reset so the next drop alerts immediately.
      nextState[threshold.diskId] = { below: false, lastAlertAt: null };
      continue;
    }

    const lastMs = prev.lastAlertAt ? Date.parse(prev.lastAlertAt) : NaN;
    const cooldownElapsed = !Number.isFinite(lastMs) || nowMs - lastMs >= DISK_ALERT_REMINDER_MS;
    const shouldFire = !prev.below || cooldownElapsed;

    if (shouldFire) {
      const totalGb = disk.totalSpace / 1024 ** 3;
      const pct = disk.totalSpace > 0 ? Math.round((disk.freeSpace / disk.totalSpace) * 100) : 0;
      const name = disk.label || disk.path;
      await notifyAndLog({
        eventType: 'diskLowSpace',
        title: `Low disk space: ${name}`,
        body: `${freeGb.toFixed(0)} GB free of ${totalGb.toFixed(0)} GB (${pct}%)`,
        url: '/settings/storage',
        metadata: {
          id: threshold.diskId,
          path: disk.path,
          label: disk.label,
          freeSpace: disk.freeSpace,
          totalSpace: disk.totalSpace,
          redirect: '/settings/storage',
        },
      }, { service: 'disk', reason: 'low-space', diskId: threshold.diskId });
      nextState[threshold.diskId] = { below: true, lastAlertAt: nowIso };
    } else {
      // Still below but within the reminder window — hold the existing timer.
      nextState[threshold.diskId] = { below: true, lastAlertAt: prev.lastAlertAt };
    }
  }

  // Only write when something actually changed (an alert fired, a recovery, or
  // a stale key got pruned) — avoid a DB write every cycle when nothing moved.
  if (!diskAlertStateEqual(prevState, nextState)) {
    await prisma.appSettings.update({
      where: { id: 'singleton' },
      data: { diskAlertState: nextState as unknown as Prisma.InputJsonValue },
    });
  }
}
