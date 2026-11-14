import { describe, expect, it, vi } from 'vitest';
import { TZDate } from '@date-fns/tz';
import type { CalendarEvent } from '@/types';

vi.mock('@/lib/db', () => ({ prisma: {} }));

import { mergeCalendarWithScheduled, type ScheduledCalendarEvent } from './calendar';

function film(date: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'radarr-1-cinema',
    type: 'movie',
    title: 'Witch on the Holy Night',
    subtitle: 'In Cinemas',
    date,
    hasFile: false,
    monitored: true,
    images: [],
    origin: 'service',
    movieId: 1,
    ...overrides,
  };
}

/** A reminder as the resolver writes it: 9:00 on the release day in the alert's zone. */
function reminder(day: string, alertTimeZone: string, overrides: Partial<ScheduledCalendarEvent> = {}): ScheduledCalendarEvent {
  const [y, m, d] = day.split('-').map(Number);
  // A plain Date's ISO string, as the API sends it (a TZDate's carries its offset).
  const at = new Date(new TZDate(y, m - 1, d, 9, 0, 0, 0, alertTimeZone).getTime()).toISOString();
  return {
    ...film(at),
    id: 'scheduled-occ-1',
    subtitle: 'In cinemas',
    origin: 'scheduled',
    scheduledAlertId: 'alert-1',
    scheduledOccurrenceId: 'occ-1',
    scheduleLabel: 'Scheduled',
    notifyAt: at,
    alertTimeZone,
    ...overrides,
  };
}

describe('mergeCalendarWithScheduled', () => {
  const zones = [
    'Asia/Tokyo', // +9: 9:00 is exactly the UTC midnight
    'Australia/Sydney', // +11 in November
    'Pacific/Auckland', // +13 in November
    'Pacific/Kiritimati', // +14
    'Asia/Kolkata',
    'UTC',
    'America/Los_Angeles',
    'Pacific/Honolulu', // -10
  ];

  it.each(zones)('merges a film and its reminder into one row in %s', (zone) => {
    const merged = mergeCalendarWithScheduled([film('2026-11-20T00:00:00Z')], [reminder('2026-11-20', zone)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'radarr-1-cinema',
      origin: 'service',
      scheduleLabel: 'Scheduled',
      scheduledOccurrenceId: 'occ-1',
    });
  });

  it.each(zones)('keeps a reminder for another day as its own row in %s', (zone) => {
    const merged = mergeCalendarWithScheduled([film('2026-11-20T00:00:00Z')], [reminder('2026-11-21', zone)]);
    expect(merged.map((e) => e.id)).toEqual(['radarr-1-cinema', 'scheduled-occ-1']);
    expect(merged[0].scheduledOccurrenceId).toBeUndefined();
  });

  it('merges an album and its reminder east of UTC+9', () => {
    const album = film('2026-12-04T00:00:00Z', { id: 'lidarr-1', type: 'album', title: 'Album', movieId: undefined });
    const merged = mergeCalendarWithScheduled([album], [reminder('2026-12-04', 'Pacific/Auckland', { type: 'album', title: 'Album' })]);
    expect(merged.map((e) => e.id)).toEqual(['lidarr-1']);
  });

  it('merges an episode and its reminder (the airing moment) on the day it airs in the alert zone', () => {
    // 07:30 in Auckland on Nov 21 is still Nov 20 in UTC.
    const airs = '2026-11-20T18:30:00Z';
    const episode = film(airs, { id: 'sonarr-1', type: 'episode', title: 'Show', movieId: undefined });
    const sched = reminder('2026-11-21', 'Pacific/Auckland', { type: 'episode', title: 'Show', date: airs, notifyAt: airs });
    expect(mergeCalendarWithScheduled([episode], [sched]).map((e) => e.id)).toEqual(['sonarr-1']);
  });

  it('does not send the alert zone to the client', () => {
    const merged = mergeCalendarWithScheduled([], [reminder('2026-11-20', 'Pacific/Auckland')]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).not.toHaveProperty('alertTimeZone');
  });

  it('keeps a film and a same-titled reminder on another instance apart', () => {
    const merged = mergeCalendarWithScheduled(
      [film('2026-11-20T00:00:00Z', { instanceId: 'a' })],
      [reminder('2026-11-20', 'Pacific/Auckland', { instanceId: 'b' })],
    );
    expect(merged).toHaveLength(2);
  });
});
