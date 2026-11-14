export const AUTOMATIC_INITIAL_BITRATE = 6_000_000;
export const DATA_SAVER_BITRATE = 2_000_000;
export const PLAYBACK_POLICY_KEY = 'helprr:playback-bitrate';
/**
 * How long a measured start bitrate is trusted. Shorter than jellyfin-web's
 * hour (bitrateTest.ts): a phone leaves home Wi-Fi for cellular well within one.
 */
export const BANDWIDTH_PROBE_TTL_MS = 10 * 60_000;

// 0 = automatic, -1 = data saver, positive = explicit ceiling in bits/sec.
export function normalizeBitrateChoice(value: number): number {
  return value === -1 || value === 0 || (Number.isFinite(value) && value >= 128_000 && value <= 120_000_000) ? value : 0;
}
export function effectiveBitrate(choice: number, measured = AUTOMATIC_INITIAL_BITRATE): number {
  if (choice === -1) return DATA_SAVER_BITRATE;
  if (choice > 0) return normalizeBitrateChoice(choice) || AUTOMATIC_INITIAL_BITRATE;
  return Math.min(20_000_000, Math.max(720_000, measured));
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
   * guess. Only ever lowers the guess: on a fast link the first stream stays
   * exactly what it was before, and the stream's own transfers can still raise
   * the ceiling as they arrive.
   */
  seed(bitsPerSecond: number, now = Date.now()): void {
    this.seededAt = now;
    if (!(bitsPerSecond > 0)) return;
    const candidate = effectiveBitrate(0, Math.round(bitsPerSecond * 0.6 / 100_000) * 100_000);
    this.ceiling = Math.min(AUTOMATIC_INITIAL_BITRATE, candidate);
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
