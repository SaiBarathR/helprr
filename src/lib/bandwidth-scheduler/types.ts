/**
 * A single time-of-day bandwidth rule.
 *
 * Limits are kilobytes per second; `0` means "unlimited" (qBittorrent's
 * convention: `0` disables the limit).
 *
 * Time fields are in local time per `AppSettings.timeZone`. If `endHour:endMinute`
 * is earlier than `startHour:startMinute`, the rule is treated as wrapping
 * midnight (e.g., start 22:00 → end 06:00 means "active 22:00–06:00 the
 * following morning"). When start equals end exactly, the rule is treated as
 * a full-day window on each selected day.
 */
export interface BandwidthRule {
  id: string;
  name: string;
  enabled: boolean;
  /** 0=Sun..6=Sat. Empty array means the rule never fires. */
  daysOfWeek: number[];
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  /** Download limit in KB/s. 0 = unlimited. */
  downloadLimitKbps: number;
  /** Upload limit in KB/s. 0 = unlimited. */
  uploadLimitKbps: number;
}

export interface BandwidthSchedule {
  rules: BandwidthRule[];
}

export const MAX_KBPS = 1_000_000;
