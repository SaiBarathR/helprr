import { prisma } from '@/lib/db';
import type { CalendarEvent } from '@/types';
import { validateInternalHref } from '@/lib/scheduled-alerts/helpers';

function sameCalendarDay(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10);
}

function matchesServiceEvent(service: CalendarEvent, sched: CalendarEvent): boolean {
  if (!sameCalendarDay(service.date, sched.date) || service.title !== sched.title) return false;
  if (sched.instanceId && service.instanceId && sched.instanceId !== service.instanceId) return false;
  return true;
}

export async function fetchScheduledCalendarEvents(args: {
  userId: string;
  start: Date;
  end: Date;
}): Promise<CalendarEvent[]> {
  const occurrences = await prisma.scheduledAlertOccurrence.findMany({
    where: {
      status: { in: ['pending', 'sent'] },
      alert: { userId: args.userId, status: 'active' },
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
      alert.mediaType === 'movie' ? 'movie' : alert.mediaType === 'anime' ? 'episode' : 'episode';
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
    };
  });
}

export function mergeCalendarWithScheduled(
  serviceEvents: CalendarEvent[],
  scheduledEvents: CalendarEvent[],
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
    merged.push(sched);
  }
  merged.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return merged;
}
