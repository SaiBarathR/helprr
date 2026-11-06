import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatTime,
  parseDateFormat,
  parseTimeFormat,
  type DateTimePrefs,
} from '@/lib/date-format';

// Local-time constructor, so the expected strings hold in any machine time zone.
const EVENING = new Date(2026, 10, 7, 20, 26);
const MORNING = new Date(2026, 0, 3, 9, 5);

const prefs = (timeFormat: DateTimePrefs['timeFormat'], dateFormat: DateTimePrefs['dateFormat']): DateTimePrefs => ({
  timeFormat,
  dateFormat,
});

describe('formatDateTime', () => {
  it('writes each date format', () => {
    expect(formatDate(EVENING, undefined, prefs('auto', 'dmy'))).toBe('7 Nov 2026');
    expect(formatDate(EVENING, undefined, prefs('auto', 'mdy'))).toBe('Nov 7, 2026');
    expect(formatDate(EVENING, undefined, prefs('auto', 'iso'))).toBe('2026-11-07');
    expect(formatDate(MORNING, { year: 'numeric', month: 'long', day: 'numeric' }, prefs('auto', 'iso'))).toBe('2026-01-03');
  });

  it('writes each time format, whatever the date format', () => {
    for (const dateFormat of ['dmy', 'mdy', 'iso'] as const) {
      expect(formatTime(EVENING, undefined, prefs('12h', dateFormat))).toMatch(/^8:26\s?PM$/i);
      expect(formatTime(EVENING, undefined, prefs('24h', dateFormat))).toBe('20:26');
      expect(formatTime(MORNING, undefined, prefs('24h', dateFormat))).toBe('09:05');
    }
  });

  it('overrides a call site that hard-codes hour12', () => {
    expect(formatTime(EVENING, { hour: 'numeric', minute: '2-digit', hour12: true }, prefs('24h', 'auto'))).toBe('20:26');
  });

  it('combines date and time', () => {
    expect(formatDateTime(EVENING, undefined, prefs('24h', 'dmy'))).toMatch(/^7 Nov 2026,? 20:26$/);
    expect(formatDateTime(EVENING, undefined, prefs('12h', 'mdy'))).toMatch(/^Nov 7, 2026,? 8:26\s?PM$/i);
    expect(formatDateTime(EVENING, undefined, prefs('24h', 'iso'))).toBe('2026-11-07 20:26');
  });

  it('keeps the browser clock for an automatic time under a pinned date format', () => {
    const browser = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(EVENING);
    // en-GB would otherwise switch a 12-hour browser to 24-hour (it writes "pm" in lower case).
    expect(formatTime(EVENING, undefined, prefs('auto', 'dmy')).toLowerCase()).toBe(browser.toLowerCase());
  });

  it('follows the browser locale on auto', () => {
    expect(formatDate(EVENING, undefined, prefs('auto', 'auto'))).toBe(
      new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(EVENING),
    );
  });

  it('keeps the field order for short dates, and the browser locale for short dates under iso', () => {
    const short = { month: 'short', day: 'numeric' } as const;
    expect(formatDate(EVENING, short, prefs('auto', 'dmy'))).toBe('7 Nov');
    expect(formatDate(EVENING, short, prefs('auto', 'mdy'))).toBe('Nov 7');
    expect(formatDate(EVENING, short, prefs('auto', 'iso'))).toBe(new Intl.DateTimeFormat(undefined, short).format(EVENING));
  });

  it('formats in a given time zone', () => {
    const utcMidnight = '1980-05-12T00:00:00Z';
    expect(formatDate(utcMidnight, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }, prefs('auto', 'mdy'))).toBe('May 12, 1980');
    expect(formatDate(utcMidnight, { dateStyle: 'medium', timeZone: 'UTC' }, prefs('auto', 'iso'))).toBe('1980-05-12');
  });

  it('accepts strings and epoch numbers, and returns empty for invalid input', () => {
    expect(formatDate(EVENING.toISOString(), undefined, prefs('auto', 'iso'))).toBe('2026-11-07');
    expect(formatDate(EVENING.getTime(), undefined, prefs('auto', 'iso'))).toBe('2026-11-07');
    expect(formatDateTime('not a date')).toBe('');
  });
});

describe('parseTimeFormat / parseDateFormat', () => {
  it('maps stored null and unknown values to auto', () => {
    expect(parseTimeFormat(null)).toBe('auto');
    expect(parseTimeFormat('25h')).toBe('auto');
    expect(parseTimeFormat('24h')).toBe('24h');
    expect(parseDateFormat(undefined)).toBe('auto');
    expect(parseDateFormat('ymd')).toBe('auto');
    expect(parseDateFormat('iso')).toBe('iso');
  });
});
