import { prisma } from '@/lib/db';
import type { CalendarEvent } from '@/types';
import { validateInternalHref } from '@/lib/scheduled-alerts/helpers';
import { isReleaseDayEvent, releaseDayKey } from '@/lib/release-day';
import { getLocalDateKey } from '@/lib/timezone';

/** A scheduled-alert event plus the zone its alert counts its days in (used to merge, never sent). */
export type ScheduledCalendarEvent = CalendarEvent & { alertTimeZone: string };

/**
 * Whether a service event falls on the day a reminder is for. The reminder's
 * moment is 9:00 on the release day in the alert's zone, which east of UTC+9
 * is still the UTC day before, so comparing the two raw UTC dates split a
 * film and its reminder into two rows there. Both are read in the alert's
 * zone instead; a film or album is dated by its UTC day (release-day.ts), an
 * episode by its moment (the reminder is that same moment).
 */
function sameCalendarDay(service: CalendarEvent, sched: ScheduledCalendarEvent): boolean {
  const serviceDay = isReleaseDayEvent(service)
    ? releaseDayKey(service.date)
    : getLocalDateKey(service.date, sched.alertTimeZone);
  return serviceDay !== null && serviceDay !== '' && serviceDay === getLocalDateKey(sched.date, sched.alertTimeZone);
}

function matchesServiceEvent(service: CalendarEvent, sched: ScheduledCalendarEvent): boolean {
  if (!sameCalendarDay(service, sched) || service.title !== sched.title) return false;
  if (sched.instanceId && service.instanceId && sched.instanceId !== service.instanceId) return false;
  return true;
}

export async function fetchScheduledCalendarEvents(args: {
  userId: string;
  start: Date;
  end: Date;
}): Promise<ScheduledCalendarEvent[]> {
  const occurrences = await prisma.scheduledAlertOccurrence.findMany({
    where: {
      status: { in: ['pending', 'sent'] },
      alert: { userId: args.userId, status: 'active' },
      // A "new album" announcement repeats the album's release reminder.
      NOT: { targetKey: { endsWith: ':announced' } },
      OR: [
        { releaseAt: { not: null, gte: args.start, lte: args.end } },
        { releaseAt: null, notifyAt: { gte: args.start, lte: args.end } },
      ],
    },
    include: { alert: true },
    orderBy: { notifyAt: 'asc' },
  });

  return occurrences.map((occ) => {
    const alert = occ.alert;
    const displayDate = occ.releaseAt ?? occ.notifyAt;
    const type =
      alert.mediaType === 'movie' ? 'movie' : alert.mediaType === 'music' ? 'album' : 'episode';
    const href = alert.href ? validateInternalHref(alert.href) ?? undefined : undefined;
    const externalNum = Number.parseInt(alert.externalId, 10);

    return {
      id: `scheduled-${occ.id}`,
      type: type as CalendarEvent['type'],
      title: occ.title,
      subtitle: occ.body ?? alert.subtitle ?? 'Scheduled alert',
      date: displayDate.toISOString(),
      hasFile: false,
      monitored: true,
      images: alert.posterUrl
        ? [{ coverType: 'poster', url: alert.posterUrl, remoteUrl: alert.posterUrl }]
        : [],
      origin: 'scheduled' as const,
      scheduledAlertId: alert.id,
      scheduledOccurrenceId: occ.id,
      releaseKind: occ.releaseKind,
      scheduleLabel: 'Scheduled',
      notifyAt: occ.notifyAt.toISOString(),
      ...(href ? { href } : {}),
      ...(alert.instanceId ? { instanceId: alert.instanceId } : {}),
      ...(alert.mediaType === 'movie' && Number.isFinite(externalNum) ? { movieId: externalNum } : {}),
      ...(alert.mediaType === 'series' && Number.isFinite(externalNum) ? { seriesId: externalNum } : {}),
      alertTimeZone: alert.timeZone,
    };
  });
}

export function mergeCalendarWithScheduled(
  serviceEvents: CalendarEvent[],
  scheduledEvents: ScheduledCalendarEvent[],
): CalendarEvent[] {
  const merged = [...serviceEvents];
  for (const sched of scheduledEvents) {
    const duplicate = serviceEvents.some((e) => matchesServiceEvent(e, sched));
    if (duplicate) {
      const idx = merged.findIndex(
        (e) => e.origin !== 'scheduled' && matchesServiceEvent(e, sched),
      );
      if (idx >= 0) {
        merged[idx] = {
          ...merged[idx],
          scheduleLabel: 'Scheduled',
          scheduledAlertId: sched.scheduledAlertId,
          scheduledOccurrenceId: sched.scheduledOccurrenceId,
          notifyAt: sched.notifyAt,
        };
        continue;
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- only the merge reads it
    const { alertTimeZone, ...event } = sched;
    merged.push(event);
  }
  merged.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return merged;
}
