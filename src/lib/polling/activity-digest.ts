// The daily or weekly digest of what happened, once per window.
import { prisma } from '@/lib/db';
import { startOfLocalDay, toZonedDate, dateInTimeZone } from '@/lib/timezone';
import { buildActivityDigest, isLidarrRow, type ActivityDigestPeriod } from '@/lib/digests/build-activity-digest';
import { can } from '@/lib/permissions';
import { logger } from '@/lib/logger';
import { noteJobSkipped } from '@/lib/polling-job-report';
import { notifyAndLog, type CycleContext } from './shared';

export async function checkActivityDigest(context: CycleContext): Promise<void> {
  const settings = await context.getSettings();
  const mode = settings.activityDigestMode;
  if (mode !== 'daily' && mode !== 'weekly') return;

  const period: ActivityDigestPeriod = mode;
  const timeZone = settings.timeZone;
  const now = new Date(context.startedAtMs);
  const zoned = toZonedDate(now, timeZone);
  const localHour = zoned.getHours();
  const localDow = zoned.getDay(); // 0=Sun..6=Sat
  const localDateLabel = `${zoned.getFullYear()}-${String(zoned.getMonth() + 1).padStart(2, '0')}-${String(zoned.getDate()).padStart(2, '0')}`;

  // Catch-up: fire on the first poll AT OR AFTER the configured hour rather
  // than only on the exact hour, so a missed hour (downtime, deploy, DST gap)
  // still sends later the same day. The per-window dedupeKey below guarantees
  // it only sends once.
  if (localHour < settings.activityDigestHour) {
    logger.debug('Skipping activity digest before configured hour', {
      period,
      localHour,
      digestHour: settings.activityDigestHour,
      timeZone,
    }, { scope: 'polling' });
    noteJobSkipped();
    return;
  }

  if (period === 'weekly' && localDow !== settings.activityDigestDayOfWeek) {
    logger.debug('Skipping activity digest outside configured day-of-week', {
      period,
      localDow,
      digestDayOfWeek: settings.activityDigestDayOfWeek,
      timeZone,
    }, { scope: 'polling' });
    noteJobSkipped();
    return;
  }

  // dedupeKey carries period + local date so a daily digest and a weekly
  // digest landing on the same morning don't collide. notifyEvent itself does
  // NOT dedupe (it only stamps dedupeKey onto the history row it writes), so
  // the findFirst guard below is what prevents re-sending within the window —
  // do not remove it.
  const dedupeKey = `activity-digest-${period}-${localDateLabel}`;
  const existing = await prisma.notificationHistory.findFirst({
    where: { eventType: 'activityDigest', dedupeKey },
    select: { id: true },
  });
  if (existing) {
    logger.debug('Skipping duplicate activity digest in same window', {
      period,
      dedupeKey,
    }, { scope: 'polling' });
    noteJobSkipped();
    return;
  }

  // Pull the digest window, aligned to the local calendar. Windows are
  // computed via calendar arithmetic (not fixed ms math) so a DST transition
  // inside the window doesn't shift the boundary by an hour.
  //   daily  = the prior full local day [yesterday 00:00, today 00:00) — fired
  //            in the morning it summarizes the complete previous day rather
  //            than the few hours since midnight.
  //   weekly = the trailing 7 local days (today plus the prior six), ending now.
  const dayStart = startOfLocalDay(now, timeZone);
  const windowStart =
    period === 'daily'
      ? dateInTimeZone(timeZone, zoned.getFullYear(), zoned.getMonth(), zoned.getDate() - 1)
      : dateInTimeZone(timeZone, zoned.getFullYear(), zoned.getMonth(), zoned.getDate() - 6);
  // Daily is a closed prior-day window; weekly runs up to now (no upper bound).
  const createdAt =
    period === 'daily' ? { gte: windowStart, lt: dayStart } : { gte: windowStart };
  const rows = await prisma.notificationHistory.findMany({
    where: {
      createdAt,
      // Don't summarize the digest itself.
      eventType: { not: 'activityDigest' },
    },
    select: { eventType: true, body: true, metadata: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  const digest = buildActivityDigest({ period, rows });
  if (digest.eventCount === 0) {
    logger.debug('Skipping activity digest: nothing happened in the window', {
      period,
      windowStart: windowStart.toISOString(),
    }, { scope: 'polling' });
    return;
  }

  // Lidarr's rows name albums and artists, which only people who may see the
  // music library are told about. When the window has any, the full digest is
  // marked so notifyEvent sends it only to them (includesLidarr), and everyone
  // else gets a second digest built without those rows.
  const includesLidarr = rows.some(isLidarrRow);
  if (includesLidarr) {
    await sendDigestWithoutLidarr(period, windowStart, rows.filter((row) => !isLidarrRow(row)), `${dedupeKey}-without-music`);
  }

  await notifyAndLog({
    eventType: 'activityDigest',
    title: digest.title,
    body: digest.body,
    dedupeKey,
    metadata: {
      source: 'digest',
      period,
      windowStart: windowStart.toISOString(),
      eventCount: digest.eventCount,
      sourceCounts: digest.sourceCounts,
      ...(includesLidarr ? { includesLidarr: true } : {}),
      redirect: '/notifications',
    },
    url: '/notifications',
  }, {
    service: 'digest',
    reason: 'activity-digest',
    period,
    dedupeKey,
  });
}

/**
 * The digest for active users without music.view, targeted at them alone. Sent
 * before the full digest, whose row is the window's dedupe guard above, so this
 * one checks its own key: a retry after the full digest failed sends it once.
 */
async function sendDigestWithoutLidarr(
  period: ActivityDigestPeriod,
  windowStart: Date,
  rows: Parameters<typeof buildActivityDigest>[0]['rows'],
  dedupeKey: string,
): Promise<void> {
  const users = await prisma.user.findMany({
    where: { status: 'active' },
    select: { id: true, role: true, template: true, permissions: true },
  });
  const userIds = users.filter((user) => !can(user, 'music.view')).map((user) => user.id);
  if (userIds.length === 0) return;
  const digest = buildActivityDigest({ period, rows });
  if (digest.eventCount === 0) return;
  const existing = await prisma.notificationHistory.findFirst({
    where: { eventType: 'activityDigest', dedupeKey },
    select: { id: true },
  });
  if (existing) return;

  await notifyAndLog({
    eventType: 'activityDigest',
    title: digest.title,
    body: digest.body,
    dedupeKey,
    userIds,
    metadata: {
      source: 'digest',
      period,
      windowStart: windowStart.toISOString(),
      eventCount: digest.eventCount,
      sourceCounts: digest.sourceCounts,
      audience: 'without-music',
      redirect: '/notifications',
    },
    url: '/notifications',
  }, {
    service: 'digest',
    reason: 'activity-digest-without-music',
    period,
    dedupeKey,
  });
}
