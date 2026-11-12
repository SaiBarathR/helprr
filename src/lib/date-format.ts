// Absolute date/time display for the signed-in user's format preference
// (Settings -> Preferences -> Date & Time). Relative times ("3 hours ago")
// stay in format.ts / date-fns.
//
// The preference lives in a client-only module store: the (app) layout seeds it
// from UserSettings before pages render (DateFormatInit), and the Preferences
// page updates it. On the server (SSR, API routes) it stays 'auto' so one
// user's choice can never leak into another request's render.

export const TIME_FORMATS = ['auto', '12h', '24h'] as const;
export const DATE_FORMATS = ['auto', 'dmy', 'mdy', 'iso'] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];
export type DateFormat = (typeof DATE_FORMATS)[number];

export interface DateTimePrefs {
  timeFormat: TimeFormat;
  dateFormat: DateFormat;
}

export const DEFAULT_DATE_TIME_PREFS: DateTimePrefs = { timeFormat: 'auto', dateFormat: 'auto' };

/** Stored value (null = auto) or request value -> preference; anything unknown is 'auto'. */
export function parseTimeFormat(value: unknown): TimeFormat {
  return typeof value === 'string' && (TIME_FORMATS as readonly string[]).includes(value)
    ? (value as TimeFormat)
    : 'auto';
}

export function parseDateFormat(value: unknown): DateFormat {
  return typeof value === 'string' && (DATE_FORMATS as readonly string[]).includes(value)
    ? (value as DateFormat)
    : 'auto';
}

let current: DateTimePrefs = DEFAULT_DATE_TIME_PREFS;
const listeners = new Set<() => void>();

export function getDateTimePrefs(): DateTimePrefs {
  return current;
}

/** Updates the preference and tells subscribers (the Preferences page) to re-render. */
export function setDateTimePrefs(next: DateTimePrefs, { notify = true } = {}): void {
  if (typeof window === 'undefined') return;
  if (next.timeFormat === current.timeFormat && next.dateFormat === current.dateFormat) return;
  current = { timeFormat: next.timeFormat, dateFormat: next.dateFormat };
  if (notify) listeners.forEach((listener) => listener());
}

/** For useSyncExternalStore. */
export function subscribeDateTimePrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// dmy/mdy pin an English locale with that field order; auto and iso use the
// browser's locale (iso only rewrites full dates, below).
const LOCALE: Record<DateFormat, string | undefined> = {
  auto: undefined,
  dmy: 'en-GB',
  mdy: 'en-US',
  iso: undefined,
};

const TIME_KEYS = ['timeStyle', 'hour', 'minute', 'second', 'dayPeriod', 'fractionalSecondDigits'] as const;

// Building an Intl.DateTimeFormat is expensive; lists format many rows.
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(locale: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${JSON.stringify(options)}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, f);
  }
  return f;
}

function hasTime(options: Intl.DateTimeFormatOptions): boolean {
  return TIME_KEYS.some((key) => options[key] !== undefined);
}

let browserHourCycle: Intl.DateTimeFormatOptions['hourCycle'] | undefined;
function autoHourCycle(): Intl.DateTimeFormatOptions['hourCycle'] {
  browserHourCycle ??= new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle ?? 'h12';
  return browserHourCycle;
}

// The clock follows the time preference alone — never the locale a date format
// pins (en-GB would otherwise turn an 'auto' US clock into 24-hour).
function withClock(
  options: Intl.DateTimeFormatOptions,
  locale: string | undefined,
  timeFormat: TimeFormat,
): Intl.DateTimeFormatOptions {
  if (!hasTime(options) || (timeFormat === 'auto' && locale === undefined)) return options;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { hour12, hourCycle, ...rest } = options;
  const cycle = timeFormat === '12h' ? 'h12' : timeFormat === '24h' ? 'h23' : autoHourCycle();
  // A 24-hour clock reads 09:05, not 9:05.
  const hour = rest.hour === 'numeric' && (cycle === 'h23' || cycle === 'h24') ? '2-digit' : rest.hour;
  return { ...rest, ...(hour ? { hour } : {}), hourCycle: cycle };
}

function isFullDate(options: Intl.DateTimeFormatOptions): boolean {
  return options.dateStyle !== undefined
    || (options.year !== undefined && options.month !== undefined && options.day !== undefined);
}

function toValidDate(input: Date | string | number): Date | null {
  const date = input instanceof Date ? input : new Date(input);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Formats with the given Intl options under the user's preference. Returns ''
 * for an invalid date. iso turns a full date into YYYY-MM-DD (dropping any
 * weekday or era asked for); shorter forms ("Nov 7", "Monday") keep the
 * browser locale.
 */
export function formatDateTime(
  input: Date | string | number,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
  prefs: DateTimePrefs = current,
): string {
  const date = toValidDate(input);
  if (!date) return '';

  if (prefs.dateFormat === 'iso' && isFullDate(options)) {
    const parts = formatter('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: options.timeZone,
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const day = `${get('year')}-${get('month')}-${get('day')}`;
    if (!hasTime(options)) return day;
    const timeOptions: Intl.DateTimeFormatOptions = { timeZone: options.timeZone, timeZoneName: options.timeZoneName };
    for (const key of TIME_KEYS) {
      if (options[key] !== undefined) Object.assign(timeOptions, { [key]: options[key] });
    }
    return `${day} ${formatter(undefined, withClock(timeOptions, undefined, prefs.timeFormat)).format(date)}`;
  }

  const locale = LOCALE[prefs.dateFormat];
  return formatter(locale, withClock(options, locale, prefs.timeFormat)).format(date);
}

/** A date without time; defaults to "Nov 7, 2026" style. */
export function formatDate(
  input: Date | string | number,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
  prefs: DateTimePrefs = current,
): string {
  return formatDateTime(input, options, prefs);
}

/** A clock time; defaults to "8:26 PM" / "20:26". */
export function formatTime(
  input: Date | string | number,
  options: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' },
  prefs: DateTimePrefs = current,
): string {
  return formatDateTime(input, options, prefs);
}

/** "2026-11-13" in this device's time zone, for file names (toISOString gives the UTC date). */
export function localDateStamp(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
