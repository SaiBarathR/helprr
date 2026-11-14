import { afterEach, describe, expect, it, vi } from 'vitest';
import { calendarEventDate, calendarEventDayKey, isReleaseDayEvent, releaseDayKey } from './release-day';
import type { CalendarEvent } from '@/types';

const event = (over: Partial<CalendarEvent>): Pick<CalendarEvent, 'type' | 'origin' | 'date'> => ({
  type: 'movie', date: '2026-11-20T00:00:00Z', ...over,
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
