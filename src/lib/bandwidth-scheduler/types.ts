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
  /**
   * Which of qBittorrent's limits the rule sets. `global`: the regular ones
   * only, so while Alternative Speed Limits is on the rule waits until it is
   * switched off. `active`: the limits of whichever mode is on, so the rule
   * applies either way and the user's own alternative limits are put back
   * when it ends. A rule saved before the choice existed is `global`.
   */
  target: BandwidthTarget;
}

export const BANDWIDTH_TARGETS = ['global', 'active'] as const;
export type BandwidthTarget = (typeof BANDWIDTH_TARGETS)[number];

export interface BandwidthSchedule {
  rules: BandwidthRule[];
}

export const MAX_KBPS = 1_000_000;
