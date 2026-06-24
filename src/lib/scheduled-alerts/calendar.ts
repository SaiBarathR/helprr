import { prisma } from '@/lib/db';
import type { CalendarEvent } from '@/types';

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
        { releaseAt: { gte: args.start, lte: args.end } },
        { notifyAt: { gte: args.start, lte: args.end } },
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
      ...(alert.instanceId ? { instanceId: alert.instanceId } : {}),
    };
  });
}

export function mergeCalendarWithScheduled(
  serviceEvents: CalendarEvent[],
  scheduledEvents: CalendarEvent[],
): CalendarEvent[] {
  const merged = [...serviceEvents];
  for (const sched of scheduledEvents) {
    const duplicate = serviceEvents.some((e) => {
      if (e.date.slice(0, 10) === sched.date.slice(0, 10) && sched.title === e.title) return true;
      return false;
    });
    if (duplicate) {
      const idx = merged.findIndex(
        (e) => e.origin !== 'scheduled' && e.title === sched.title && e.date.slice(0, 10) === sched.date.slice(0, 10),
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
