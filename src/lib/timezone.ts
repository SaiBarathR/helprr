import { TZDate, tzOffset } from '@date-fns/tz';

export const FALLBACK_TIME_ZONE = 'UTC';
let appTimeZone = getEnvTimeZone();

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || timeZone.trim().length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function getEnvTimeZone(): string {
  return isValidTimeZone(process.env.TZ) ? process.env.TZ : FALLBACK_TIME_ZONE;
}

export function normalizeTimeZone(timeZone: unknown, fallback = getEnvTimeZone()): string {
  return isValidTimeZone(timeZone) ? timeZone : fallback;
}

export function setAppTimeZone(timeZone: unknown): string {
  appTimeZone = normalizeTimeZone(timeZone);
  return appTimeZone;
}

export function getAppTimeZone(): string {
  return normalizeTimeZone(appTimeZone);
}

export function getSupportedTimeZones(): string[] {
  const intlWithSupportedValues = Intl as typeof Intl & {
    supportedValuesOf?: (key: 'timeZone') => string[];
  };
  return intlWithSupportedValues.supportedValuesOf?.('timeZone') ?? [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Berlin',
    'Asia/Kolkata',
    'Asia/Singapore',
    'Australia/Sydney',
  ];
}

export function toDate(input: Date | string | number): Date {
  return input instanceof Date ? input : new Date(input);
}

export function toZonedDate(input: Date | string | number, timeZone: string): TZDate {
  return TZDate.tz(normalizeTimeZone(timeZone), toDate(input));
}

export function getTimeZoneOffsetMinutes(input: Date | string | number, timeZone: string): number {
  return tzOffset(normalizeTimeZone(timeZone), toDate(input));
}

export function formatInTimeZone(
  input: Date | string | number,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }
): string {
  const date = toDate(input);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    ...options,
    timeZone: normalizeTimeZone(timeZone),
  }).format(date);
}

export function getLocalDateParts(input: Date | string | number, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: normalizeTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(toDate(input));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
  };
}

export function getLocalDateKey(input: Date | string | number, timeZone: string): string {
  const { year, month, day } = getLocalDateParts(input, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function startOfLocalDay(input: Date | string | number, timeZone: string): Date {
  const { year, month, day } = getLocalDateParts(input, timeZone);
  return new TZDate(year, month - 1, day, 0, 0, 0, 0, normalizeTimeZone(timeZone));
}

export function dateInTimeZone(
  timeZone: string,
  year: number,
  monthIndex: number,
  day = 1,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0
): Date {
  return new TZDate(year, monthIndex, day, hour, minute, second, millisecond, normalizeTimeZone(timeZone));
}
