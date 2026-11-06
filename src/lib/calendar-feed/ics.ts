import type { CalendarEvent, MovieReleaseType } from '@/types';

// RFC 5545 output for the subscribable calendar feed. Lines end in CRLF and are
// folded at 75 octets; text values are escaped. Episodes are timed (UTC, their
// series runtime long); movie and album releases are dates upstream, so they
// are all-day events on that date.

const CRLF = '\r\n';
const MAX_LINE_OCTETS = 75;
const DEFAULT_EPISODE_MINUTES = 30;
const UID_DOMAIN = 'helprr';

const APP_NAME: Record<CalendarEvent['type'], string> = { episode: 'Sonarr', movie: 'Radarr', album: 'Lidarr' };
const RELEASE_LABEL: Record<MovieReleaseType, string> = {
  cinema: 'In cinemas',
  digital: 'Digital release',
  physical: 'Physical release',
};
const FINALE_LABEL: Record<NonNullable<CalendarEvent['finaleType']>, string> = {
  series: 'Series finale',
  season: 'Season finale',
  midseason: 'Midseason finale',
};

/** Escape a TEXT value (RFC 5545 3.3.11): backslash, semicolon, comma and newlines. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    // Other control characters are not allowed in a TEXT value.
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Fold a content line so no physical line exceeds 75 octets (RFC 5545 3.1).
 * Continuation lines start with one space, and a multi-byte character is
 * never split.
 */
export function foldIcsLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let octets = 0;
  let limit = MAX_LINE_OCTETS;
  for (const char of line) {
    const size = Buffer.byteLength(char, 'utf8');
    if (octets + size > limit) {
      parts.push(current);
      current = '';
      octets = 0;
      limit = MAX_LINE_OCTETS - 1; // the leading space counts
    }
    current += char;
    octets += size;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/** 20261107T200000Z */
function formatUtcDateTime(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

/** 20261107: Radarr and Lidarr keep release dates as UTC midnight. */
function formatUtcDate(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

function summaryOf(event: CalendarEvent): string {
  if (event.type === 'movie') {
    return event.releaseType ? `${event.title} (${RELEASE_LABEL[event.releaseType]})` : event.title;
  }
  return `${event.title} - ${event.subtitle}`;
}

function descriptionOf(event: CalendarEvent): string {
  const lines: string[] = [];
  if (event.finaleType) lines.push(FINALE_LABEL[event.finaleType]);
  const app = APP_NAME[event.type];
  lines.push(event.instanceLabel && event.instanceLabel.toLowerCase() !== app.toLowerCase()
    ? `${app} · ${event.instanceLabel}`
    : app);
  const status = [event.monitored ? 'Monitored' : 'Not monitored'];
  if (event.hasFile) status.push(event.type === 'album' ? 'All tracks downloaded' : 'Downloaded');
  lines.push(status.join(' · '));
  return lines.join('\n');
}

function eventLines(event: CalendarEvent, stamp: string): string[] | null {
  const start = new Date(event.date);
  if (!Number.isFinite(start.getTime())) return null;

  const lines = ['BEGIN:VEVENT', `UID:${escapeIcsText(event.id)}@${UID_DOMAIN}`, `DTSTAMP:${stamp}`];
  if (event.type === 'episode') {
    const minutes = event.runtime && event.runtime > 0 ? event.runtime : DEFAULT_EPISODE_MINUTES;
    lines.push(
      `DTSTART:${formatUtcDateTime(start)}`,
      `DTEND:${formatUtcDateTime(new Date(start.getTime() + minutes * 60_000))}`,
    );
  } else {
    const nextDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 1));
    lines.push(`DTSTART;VALUE=DATE:${formatUtcDate(start)}`, `DTEND;VALUE=DATE:${formatUtcDate(nextDay)}`);
  }
  lines.push(
    `SUMMARY:${escapeIcsText(summaryOf(event))}`,
    `DESCRIPTION:${escapeIcsText(descriptionOf(event))}`,
    `CATEGORIES:${event.type === 'episode' ? 'Episode' : event.type === 'movie' ? 'Movie' : 'Album'}`,
    // A release should not mark the person busy.
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
  );
  return lines;
}

/** A whole VCALENDAR document, CRLF-terminated. */
export function buildCalendarFeed(events: readonly CalendarEvent[], now: Date = new Date()): string {
  const stamp = formatUtcDateTime(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Helprr//Calendar feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Helprr',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const event of events) {
    const vevent = eventLines(event, stamp);
    if (vevent) lines.push(...vevent);
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}
