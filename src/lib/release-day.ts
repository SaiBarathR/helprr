import type { CalendarEvent } from '@/types';

// Radarr's cinema, digital and physical dates and Lidarr's album releaseDate
// name a day, not a moment: they arrive as that day's UTC midnight
// ("2026-11-20T00:00:00Z"). Read as an instant and shown in local time, that
// midnight is still the evening before anywhere west of UTC, so films and
// albums showed a day early there (and only there). The day is the value's UTC
// date, the same wherever it is shown; scheduled alerts already read it so.

/** "2026-11-20" for a release-day value, or null when it is not a date. */
export function releaseDayKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * A calendar event dated by its day: a film release or an album. An episode
 * airs at a time, and a scheduled alert's date is its own moment (9:00 on the
 * release day in the alert's time zone, or when it notifies).
 */
export function isReleaseDayEvent(event: Pick<CalendarEvent, 'type' | 'origin'>): boolean {
  return event.type !== 'episode' && event.origin !== 'scheduled';
}

/** Where an event sits on this device: a release at local midnight of its day, anything else at its moment. */
export function calendarEventDate(event: Pick<CalendarEvent, 'type' | 'origin' | 'date'>): Date {
  const key = isReleaseDayEvent(event) ? releaseDayKey(event.date) : null;
  if (!key) return new Date(event.date);
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** "2026-11-20": the day on this device an event belongs to. */
export function calendarEventDayKey(event: Pick<CalendarEvent, 'type' | 'origin' | 'date'>): string {
  const date = calendarEventDate(event);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
