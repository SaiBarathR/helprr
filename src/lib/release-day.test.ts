import { afterEach, describe, expect, it, vi } from 'vitest';
import { calendarEventDate, calendarEventDayKey, compareCalendarEvents, isAllDayEvent, isReleaseDayEvent, releaseDayKey } from './release-day';
import type { CalendarEvent } from '@/types';

type EventFields = Pick<CalendarEvent, 'type' | 'origin' | 'date' | 'notifyAt' | 'title'>;
const event = (over: Partial<EventFields>): EventFields => ({
  type: 'movie', title: 'event', date: '2026-11-20T00:00:00Z', ...over,
});

// The device's zone, as the page and widgets read it (getHours, date-fns).
function inZone(timeZone: string) {
  vi.stubEnv('TZ', timeZone);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('releaseDayKey', () => {
  it("reads the day of Radarr's and Lidarr's UTC midnight, and of a plain date", () => {
    expect(releaseDayKey('2026-11-20T00:00:00Z')).toBe('2026-11-20');
    expect(releaseDayKey('2026-11-20')).toBe('2026-11-20');
    expect(releaseDayKey('2026-12-31T00:00:00Z')).toBe('2026-12-31');
  });

  it('keeps the UTC date at both ends of the day', () => {
    expect(releaseDayKey('2026-11-20T23:59:59Z')).toBe('2026-11-20');
    expect(releaseDayKey('2026-11-21T00:00:00Z')).toBe('2026-11-21');
  });

  it('is null for no date or a bad one', () => {
    expect(releaseDayKey(undefined)).toBeNull();
    expect(releaseDayKey('')).toBeNull();
    expect(releaseDayKey('not a date')).toBeNull();
  });
});

describe('isReleaseDayEvent', () => {
  it('is a film or album from its app, not an episode or a scheduled alert', () => {
    expect(isReleaseDayEvent({ type: 'movie' })).toBe(true);
    expect(isReleaseDayEvent({ type: 'album', origin: 'service' })).toBe(true);
    expect(isReleaseDayEvent({ type: 'episode' })).toBe(false);
    expect(isReleaseDayEvent({ type: 'movie', origin: 'scheduled' })).toBe(false);
  });
});

describe.each([
  ['America/Los_Angeles', 'west of UTC'],
  ['Pacific/Honolulu', 'far west of UTC'],
  ['UTC', 'at UTC'],
  ['Asia/Kolkata', 'east of UTC'],
  ['Pacific/Kiritimati', 'far east of UTC (+14)'],
])('calendarEventDayKey in %s (%s)', (timeZone) => {
  it('puts a film and an album on their own day', () => {
    inZone(timeZone);
    expect(calendarEventDayKey(event({}))).toBe('2026-11-20');
    expect(calendarEventDayKey(event({ type: 'album', date: '2026-12-31T00:00:00Z' }))).toBe('2026-12-31');
    const date = calendarEventDate(event({}));
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([2026, 10, 20, 0]);
  });
});

describe('calendarEventDayKey for timed events', () => {
  it("places an episode on this device's day of its air time", () => {
    // 01:00Z on the 20th: still the 19th in Los Angeles, the 20th in India.
    const episode = event({ type: 'episode', date: '2026-11-20T01:00:00Z' });
    inZone('America/Los_Angeles');
    expect(calendarEventDayKey(episode)).toBe('2026-11-19');
    inZone('Asia/Kolkata');
    expect(calendarEventDayKey(episode)).toBe('2026-11-20');
  });

  it("places a scheduled alert at its own moment", () => {
    // 9:00 on the 20th in Sydney is 22:00Z on the 19th.
    const alert = event({ origin: 'scheduled', date: '2026-11-19T22:00:00Z' });
    inZone('Australia/Sydney');
    expect(calendarEventDayKey(alert)).toBe('2026-11-20');
  });

  it('is empty for a bad date', () => {
    expect(calendarEventDayKey(event({ type: 'episode', date: 'nope' }))).toBe('');
  });
});

describe('isAllDayEvent', () => {
  it('is a release, or an alert on its release day; not an episode or an alert at its notify time', () => {
    expect(isAllDayEvent(event({}))).toBe(true);
    expect(isAllDayEvent(event({ type: 'episode' }))).toBe(false);
    expect(isAllDayEvent(event({ origin: 'scheduled', date: '2026-11-20T03:30:00Z', notifyAt: '2026-11-20T02:30:00Z' }))).toBe(true);
    expect(isAllDayEvent(event({ origin: 'scheduled', date: '2026-11-20T03:30:00Z', notifyAt: '2026-11-20T03:30:00Z' }))).toBe(false);
  });
});

describe('compareCalendarEvents', () => {
  const titles = (events: Array<ReturnType<typeof event>>) => [...events].sort(compareCalendarEvents).map((e) => e.title);
  // Upstream order is by raw instant: the film (Nov 20, 00:00Z) between these episodes.
  const events = [
    event({ type: 'episode', title: 'Ep 19:00Z', date: '2026-11-19T19:00:00Z' }),
    event({ title: 'Film Nov 20', date: '2026-11-20T00:00:00Z' }),
    event({ type: 'episode', title: 'Ep 01:00Z', date: '2026-11-20T01:00:00Z' }),
    event({ type: 'episode', title: 'Ep 04:00Z', date: '2026-11-20T04:00:00Z' }),
  ];

  it("west of UTC: the evening before's episodes come before the film's day", () => {
    inZone('America/Los_Angeles');
    // 11:00, 17:00 and 20:00 on Nov 19; the film on Nov 20.
    expect(titles(events)).toEqual(['Ep 19:00Z', 'Ep 01:00Z', 'Ep 04:00Z', 'Film Nov 20']);
  });

  it("east of UTC: the film heads its day, before that morning's episodes", () => {
    inZone('Asia/Kolkata');
    // 00:30, 06:30 and 09:30 on Nov 20 (the first is past midnight here).
    expect(titles(events)).toEqual(['Film Nov 20', 'Ep 19:00Z', 'Ep 01:00Z', 'Ep 04:00Z']);
    inZone('Asia/Tokyo');
    expect(titles(events)).toEqual(['Film Nov 20', 'Ep 19:00Z', 'Ep 01:00Z', 'Ep 04:00Z']);
  });
});
