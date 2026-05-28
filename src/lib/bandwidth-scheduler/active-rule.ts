import { toZonedDate } from '@/lib/timezone';
import type { BandwidthRule } from './types';

function minutesOfDay(hour: number, minute: number): number {
  return hour * 60 + minute;
}

/**
 * Tests whether `rule` is active given the wall-clock day-of-week and
 * minutes-past-midnight, accounting for windows that wrap midnight.
 *
 * A rule with `endMinutes < startMinutes` is treated as wrapping; the test
 * has to consider both today's day-of-week (for the "after start" tail) and
 * yesterday's day-of-week (for the "before end" head). A rule with start ===
 * end is treated as a 24h window on each selected day.
 */
export function isRuleActive(
  rule: BandwidthRule,
  dow: number,
  nowMinutes: number,
): boolean {
  if (!rule.enabled) return false;
  if (!rule.daysOfWeek?.length) return false;

  const startMin = minutesOfDay(rule.startHour, rule.startMinute);
  const endMin = minutesOfDay(rule.endHour, rule.endMinute);

  // Same-day window
  if (endMin > startMin) {
    return rule.daysOfWeek.includes(dow) && nowMinutes >= startMin && nowMinutes < endMin;
  }

  // 24h window (start === end). Active any time the day-of-week matches.
  if (endMin === startMin) {
    return rule.daysOfWeek.includes(dow);
  }

  // Wraps midnight (endMin < startMin). Two halves:
  //   1) today, from `startMin` until midnight — needs today's dow active.
  //   2) today, from midnight until `endMin` — needs YESTERDAY's dow active.
  if (rule.daysOfWeek.includes(dow) && nowMinutes >= startMin) return true;
  const yesterdayDow = (dow + 6) % 7;
  if (rule.daysOfWeek.includes(yesterdayDow) && nowMinutes < endMin) return true;
  return false;
}

/**
 * Returns the highest-priority rule active right now, or null.
 *
 * Rules are evaluated in array order — earlier rules take precedence — so the
 * user controls precedence by ordering rules in the editor.
 */
export function pickActiveRule(
  rules: BandwidthRule[],
  now: Date,
  timeZone: string,
): BandwidthRule | null {
  if (!Array.isArray(rules) || rules.length === 0) return null;
  const zoned = toZonedDate(now, timeZone);
  const dow = zoned.getDay();
  const nowMinutes = zoned.getHours() * 60 + zoned.getMinutes();
  for (const rule of rules) {
    if (isRuleActive(rule, dow, nowMinutes)) return rule;
  }
  return null;
}
