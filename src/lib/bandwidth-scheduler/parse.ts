import type { BandwidthRule, BandwidthSchedule } from './types';
import { MAX_KBPS } from './types';

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function clampHour(value: unknown): number | null {
  if (!isFiniteInteger(value) || value < 0 || value > 23) return null;
  return value;
}

function clampMinute(value: unknown): number | null {
  if (!isFiniteInteger(value) || value < 0 || value > 59) return null;
  return value;
}

function clampKbps(value: unknown): number | null {
  if (!isFiniteInteger(value) || value < 0 || value > MAX_KBPS) return null;
  return value;
}

function parseDaysOfWeek(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const result: number[] = [];
  for (const entry of raw) {
    if (!isFiniteInteger(entry) || entry < 0 || entry > 6) return null;
    if (!result.includes(entry)) result.push(entry);
  }
  return result.sort((a, b) => a - b);
}

function parseRule(raw: unknown): BandwidthRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const id = typeof r.id === 'string' && r.id.length > 0 ? r.id : null;
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, 80) : '';
  const enabled = Boolean(r.enabled);
  const daysOfWeek = parseDaysOfWeek(r.daysOfWeek);
  const startHour = clampHour(r.startHour);
  const startMinute = clampMinute(r.startMinute);
  const endHour = clampHour(r.endHour);
  const endMinute = clampMinute(r.endMinute);
  const downloadLimitKbps = clampKbps(r.downloadLimitKbps);
  const uploadLimitKbps = clampKbps(r.uploadLimitKbps);

  if (
    !id ||
    !daysOfWeek ||
    startHour === null ||
    startMinute === null ||
    endHour === null ||
    endMinute === null ||
    downloadLimitKbps === null ||
    uploadLimitKbps === null
  ) {
    return null;
  }

  return {
    id,
    name: name || 'Rule',
    enabled,
    daysOfWeek,
    startHour,
    startMinute,
    endHour,
    endMinute,
    downloadLimitKbps,
    uploadLimitKbps,
  };
}

/**
 * Parses a stored bandwidth schedule from `AppSettings.qbtBandwidthSchedule`.
 * Tolerant — drops invalid rules silently and returns `{ rules: [] }` when the
 * JSON is missing or malformed, so the polling tick can no-op safely.
 */
export function parseBandwidthSchedule(raw: unknown): BandwidthSchedule {
  if (!raw || typeof raw !== 'object') return { rules: [] };
  const obj = raw as { rules?: unknown };
  if (!Array.isArray(obj.rules)) return { rules: [] };
  const rules = obj.rules
    .map(parseRule)
    .filter((r): r is BandwidthRule => r !== null);
  return { rules };
}
