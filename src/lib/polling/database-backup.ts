// Scheduled in-app database backups, and the admin push when backups stop.
import { prisma } from '@/lib/db';
import { getLocalDateKey, toZonedDate } from '@/lib/timezone';
import { isBackupRunning, startDatabaseBackup } from '@/lib/database-backup';
import { logger } from '@/lib/logger';
import { noteJobSkipped } from '@/lib/polling-job-report';
import { notifyAndLog, type CycleContext } from './shared';

const DAY_MS = 24 * 60 * 60 * 1000;
/** While the last backup stays too old, remind admins at most this often. */
const OVERDUE_REMINDER_MS = DAY_MS;

interface ScheduleSettings {
  databaseBackupSchedule: string;
  databaseBackupHour: number;
  databaseBackupDayOfWeek: number;
  databaseBackupScheduledAt: Date | null;
}

/**
 * Due on the first poll at or after the configured local hour (so downtime over
 * that hour still backs up later the same day), on the configured day for
 * weekly, once per local day: a run that fails is not retried until the next
 * window.
 */
export function isScheduledBackupDue(settings: ScheduleSettings, now: Date, timeZone: string): boolean {
  const schedule = settings.databaseBackupSchedule;
  if (schedule !== 'daily' && schedule !== 'weekly') return false;
  const zoned = toZonedDate(now, timeZone);
  if (zoned.getHours() < settings.databaseBackupHour) return false;
  if (schedule === 'weekly' && zoned.getDay() !== settings.databaseBackupDayOfWeek) return false;
  const last = settings.databaseBackupScheduledAt;
  return !last || getLocalDateKey(last, timeZone) !== getLocalDateKey(now, timeZone);
}

interface OverdueSettings {
  databaseBackupSchedule: string;
  databaseBackupAlertDays: number;
  databaseBackupAlertedAt: Date | null;
  lastDatabaseBackupAt: Date | null;
}

/**
 * Only while scheduled backups are on, so an install that backs up with
 * backup.sh alone (update.sh runs it before each update) is never nagged. A
 * schedule that never succeeded is reported by the failure push instead.
 */
export function isBackupOverdue(settings: OverdueSettings, nowMs: number): boolean {
  if (settings.databaseBackupSchedule === 'off' || settings.databaseBackupAlertDays <= 0) return false;
  const last = settings.lastDatabaseBackupAt;
  if (!last || nowMs - last.getTime() <= settings.databaseBackupAlertDays * DAY_MS) return false;
  const alerted = settings.databaseBackupAlertedAt;
  return !alerted || nowMs - alerted.getTime() >= OVERDUE_REMINDER_MS;
}

async function activeAdminIds(): Promise<string[]> {
  const admins = await prisma.user.findMany({ where: { role: 'admin', status: 'active' }, select: { id: true } });
  return admins.map((admin) => admin.id);
}

async function notifyAdmins(title: string, body: string, reason: string): Promise<void> {
  const userIds = await activeAdminIds();
  if (userIds.length === 0) return;
  await notifyAndLog({
    eventType: 'databaseBackup',
    title,
    body,
    url: '/settings/backup',
    userIds,
    metadata: { source: 'backup', reason, redirect: '/settings/backup' },
  }, { service: 'backup', reason });
}

export async function checkDatabaseBackup(context: CycleContext): Promise<void> {
  const settings = await context.getSettings();
  const now = new Date(context.startedAtMs);

  if (isScheduledBackupDue(settings, now, settings.timeZone)) {
    // Claimed before it starts, so a slow or failed run is tried once per window.
    await prisma.appSettings.update({ where: { id: 'singleton' }, data: { databaseBackupScheduledAt: now } });
    // Not awaited: a dump can outlast a poll cycle. The run holds its own lock.
    const run = startDatabaseBackup({ trigger: 'scheduled', actor: null });
    if (!run) {
      logger.info('Scheduled database backup skipped: a backup is already running', {}, { scope: 'backup' });
      return;
    }
    void run.then(async (result) => {
      if (result.ok) return;
      await notifyAdmins('Scheduled database backup failed', result.message, 'scheduled-failed');
    }).catch((error) => {
      logger.warn('Scheduled database backup could not finish', { error: (error as Error).message }, { scope: 'backup' });
    });
    return;
  }

  if (isBackupRunning() || !isBackupOverdue(settings, context.startedAtMs)) {
    noteJobSkipped();
    return;
  }
  const days = Math.floor((context.startedAtMs - settings.lastDatabaseBackupAt!.getTime()) / DAY_MS);
  await notifyAdmins(
    'Database backup overdue',
    `The last database backup was ${days} days ago. Check Settings → Backup & Restore.`,
    'overdue',
  );
  await prisma.appSettings.update({ where: { id: 'singleton' }, data: { databaseBackupAlertedAt: now } });
}
