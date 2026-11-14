export const AUTOMATIC_INITIAL_BITRATE = 6_000_000;
export const DATA_SAVER_BITRATE = 2_000_000;
export const PLAYBACK_POLICY_KEY = 'helprr:playback-bitrate';
/** How long a measured start bitrate is trusted: jellyfin-web's hour
 *  (bitrateTest.ts `BITRATE_CACHE_DURATION`). */
export const BANDWIDTH_PROBE_TTL_MS = 60 * 60_000;
/**
 * Automatic's highest ceiling: the highest quality the picker offers and the
 * stream route accepts. jellyfin-web's Automatic has no lower cap than that, so
 * a fast link direct-plays what it can carry.
 */
export const AUTOMATIC_MAX_BITRATE = 120_000_000;
/** The share of a measured link a start may use (jellyfin-web: 70%). */
const MEASURED_HEADROOM = 0.7;

// 0 = automatic, -1 = data saver, positive = explicit ceiling in bits/sec.
export function normalizeBitrateChoice(value: number): number {
  return value === -1 || value === 0 || (Number.isFinite(value) && value >= 128_000 && value <= 120_000_000) ? value : 0;
}
export function effectiveBitrate(choice: number, measured = AUTOMATIC_INITIAL_BITRATE): number {
  if (choice === -1) return DATA_SAVER_BITRATE;
  if (choice > 0) return normalizeBitrateChoice(choice) || AUTOMATIC_INITIAL_BITRATE;
  return Math.min(AUTOMATIC_MAX_BITRATE, Math.max(720_000, measured));
}

/**
 * The start ceiling a speed test gives, by jellyfin-web's rule
 * (bitrateTest.ts `normalizeReturnBitrate`): 70% of what was measured, and no
 * more than 70% of the connection's own top speed where the browser reports
 * one (`navigator.connection.downlinkMax`, in Mbps; Chrome on Android only).
 * jellyfin-web converts that top speed to bytes, not bits, by mistake, which
 * caps it at an eighth of the link; this keeps it in bits.
 */
export function measuredStartBitrate(bitsPerSecond: number, downlinkMaxMbps?: number): number {
  let result = bitsPerSecond * MEASURED_HEADROOM;
  if (downlinkMaxMbps && downlinkMaxMbps > 0 && Number.isFinite(downlinkMaxMbps)) {
    result = Math.min(result, downlinkMaxMbps * 1_000_000 * MEASURED_HEADROOM);
  }
  return Math.round(result / 100_000) * 100_000;
}

/** Conservative headroom, three samples before raising, immediate lower ceiling
 * after sustained slow transfer. Applies to the next negotiation, never restarts
 * an active stream merely because a network hint changed. */
export class PlaybackBandwidthEstimate {
  ceiling = AUTOMATIC_INITIAL_BITRATE;
  /** When `seed` last set the ceiling from a measured download; 0 before. */
  seededAt = 0;
  private samples = 0;
  private average = 0;
  /** Whether Automatic should measure the link again before its next start. */
  needsProbe(now = Date.now()): boolean {
    return !this.seededAt || now - this.seededAt > BANDWIDTH_PROBE_TTL_MS;
  }
  /**
   * Start from a measured download (`probeBandwidth`) instead of the fixed
   * guess, as jellyfin-web does: the measurement replaces the ceiling, lower
   * for a slow link and higher for a fast one (see `measuredStartBitrate`).
   * A failed test (0) keeps the ceiling it has.
   */
  seed(bitsPerSecond: number, now = Date.now(), downlinkMaxMbps?: number): void {
    this.seededAt = now;
    if (!(bitsPerSecond > 0)) return;
    const next = effectiveBitrate(0, measuredStartBitrate(bitsPerSecond, downlinkMaxMbps));
    if (next === this.ceiling) return;
    this.ceiling = next;
    this.samples = 0;
  }
  observe(bytes: number, milliseconds: number): void {
    if (bytes < 32_000 || milliseconds < 100 || !Number.isFinite(milliseconds)) return;
    const measured = bytes * 8_000 / milliseconds;
    this.average = this.samples ? this.average * 0.7 + measured * 0.3 : measured;
    this.samples++;
    if (this.samples < 3) return;
    const candidate = effectiveBitrate(0, this.average * 0.6);
    if (candidate < this.ceiling * 0.8 || candidate > this.ceiling * 1.5) this.ceiling = Math.round(candidate / 100_000) * 100_000;
  }
  stalled(): void { this.ceiling = Math.max(720_000, Math.floor(this.ceiling / 2)); this.samples = 0; }
}
