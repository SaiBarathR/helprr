import { describe, expect, it } from 'vitest';
import { buildCalendarFeed, escapeIcsText, foldIcsLine } from '@/lib/calendar-feed/ics';
import type { CalendarEvent } from '@/types';

const NOW = new Date('2026-11-07T10:00:00Z');

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'sonarr-conn1-42',
    type: 'episode',
    title: 'Show',
    subtitle: 'S01E02 - Pilot',
    date: '2026-11-10T01:00:00Z',
    hasFile: false,
    monitored: true,
    images: [],
    instanceId: 'conn1',
    instanceLabel: 'HD',
    ...overrides,
  };
}

/** Undo RFC 5545 folding. */
function unfold(text: string): string {
  return text.replace(/\r\n /g, '');
}

function vevents(text: string): string[] {
  return unfold(text).split('BEGIN:VEVENT').slice(1).map((block) => block.split('END:VEVENT')[0]);
}

describe('escapeIcsText', () => {
  it('escapes backslash, semicolon, comma and newlines', () => {
    expect(escapeIcsText('a\\b;c,d\ne\r\nf\rg')).toBe(String.raw`a\\b\;c\,d\ne\nf\ng`);
  });

  it('drops control characters other than tab', () => {
    expect(escapeIcsText('a\u0000b\u0007c\u001Bd\u007Fe\tf')).toBe('abcde\tf');
  });
});

describe('foldIcsLine', () => {
  it('leaves a short line alone', () => {
    expect(foldIcsLine('SUMMARY:short')).toBe('SUMMARY:short');
  });

  it('folds at 75 octets with a space-led continuation', () => {
    const line = `SUMMARY:${'x'.repeat(200)}`;
    const folded = foldIcsLine(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    expect(Buffer.byteLength(parts[0], 'utf8')).toBe(75);
    for (const part of parts.slice(1)) {
      expect(part.startsWith(' ')).toBe(true);
      expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(75);
    }
    expect(unfold(folded)).toBe(line);
  });

  it('never splits a multi-byte character', () => {
    const line = `SUMMARY:${'é漢🎬'.repeat(40)}`;
    const folded = foldIcsLine(line);
    for (const part of folded.split('\r\n')) {
      expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(75);
      expect(part).not.toContain('�');
    }
    expect(unfold(folded)).toBe(line);
  });
});

describe('buildCalendarFeed', () => {
  it('writes a CRLF VCALENDAR with the required properties', () => {
    const text = buildCalendarFeed([], { now: NOW });
    expect(text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:')).toBe(true);
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('times an episode in UTC for its runtime, and dates releases all-day', () => {
    const text = buildCalendarFeed([
      event({ runtime: 45 }),
      event({ id: 'sonarr-conn1-43', runtime: undefined }),
      event({ id: 'radarr-conn2-7-digital', type: 'movie', title: 'Film', releaseType: 'digital', date: '2026-12-31T00:00:00Z' }),
      event({ id: 'lidarr-conn3-9', type: 'album', title: 'Artist', subtitle: 'Album', date: '2026-11-20T00:00:00Z' }),
    ], { now: NOW });
    const [ep, epDefault, movie, album] = vevents(text);
    expect(ep).toContain('DTSTART:20261110T010000Z\r\nDTEND:20261110T014500Z');
    expect(epDefault).toContain('DTEND:20261110T013000Z');
    expect(movie).toContain('DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101');
    expect(movie).toContain('SUMMARY:Film (Digital release)');
    expect(album).toContain('DTSTART;VALUE=DATE:20261120\r\nDTEND;VALUE=DATE:20261121');
    expect(album).toContain('SUMMARY:Artist - Album');
    for (const block of [ep, movie, album]) expect(block).toContain('DTSTAMP:20261107T100000Z');
  });

  it('dates a release on its own day in every time zone', () => {
    const events = [
      event({ id: 'radarr-conn2-7-digital', type: 'movie', title: 'Film', releaseType: 'digital', date: '2026-12-31T00:00:00Z' }),
      event({ id: 'lidarr-conn3-9', type: 'album', title: 'Artist', subtitle: 'Album', date: '2026-11-20T00:00:00Z' }),
    ];
    // Upstream gives the day as its UTC midnight, which is still the evening
    // before west of UTC; the feed does not depend on a zone at all now.
    const [movie, album] = vevents(buildCalendarFeed(events, { now: NOW }));
    expect(movie).toContain('DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101');
    expect(album).toContain('DTSTART;VALUE=DATE:20261120\r\nDTEND;VALUE=DATE:20261121');
    // Episodes stay timed in UTC.
    expect(vevents(buildCalendarFeed([event({ runtime: 45 })], { now: NOW }))[0])
      .toContain('DTSTART:20261110T010000Z');
  });

  it("names the calendar after the link, plain Helprr for the default one", () => {
    expect(buildCalendarFeed([], { now: NOW })).toContain('X-WR-CALNAME:Helprr\r\n');
    expect(buildCalendarFeed([], { name: 'Calendar', now: NOW })).toContain('X-WR-CALNAME:Helprr\r\n');
    expect(buildCalendarFeed([], { name: 'Kids, movies', now: NOW })).toContain('X-WR-CALNAME:Helprr · Kids\\, movies\r\n');
  });

  it('gives each event a stable UID from its instance and upstream id', () => {
    const events = [event({}), event({ id: 'radarr-conn2-7-cinema', type: 'movie', releaseType: 'cinema' })];
    const first = buildCalendarFeed(events, { now: NOW });
    const later = buildCalendarFeed(events, { now: new Date('2026-11-08T10:00:00Z') });
    const uids = (text: string) => vevents(text).map((block) => block.match(/UID:(.*)\r\n/)?.[1]);
    expect(uids(first)).toEqual(['sonarr-conn1-42@helprr', 'radarr-conn2-7-cinema@helprr']);
    expect(uids(later)).toEqual(uids(first));
  });

  it('escapes and folds titles from upstream', () => {
    const title = 'Law, Order; Special\\Victims\nUnit '.repeat(4);
    const text = buildCalendarFeed([event({ title })], { now: NOW });
    for (const line of text.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    const summary = unfold(text).match(/SUMMARY:(.*)\r\n/)?.[1] ?? '';
    expect(summary).toContain(String.raw`Law\, Order\; Special\\Victims\nUnit`);
    expect(summary).not.toMatch(/[^\\][,;]/);
  });

  it('describes the instance, finale and download state', () => {
    const [block] = vevents(buildCalendarFeed([event({ finaleType: 'season', hasFile: true })], { now: NOW }));
    expect(block).toContain('DESCRIPTION:Season finale\\nSonarr · HD\\nMonitored · Downloaded');
  });

  it('skips an event with an unreadable date', () => {
    expect(vevents(buildCalendarFeed([event({ date: 'not a date' })], { now: NOW }))).toHaveLength(0);
  });
});
