export const AUTOMATIC_INITIAL_BITRATE = 6_000_000;
export const DATA_SAVER_BITRATE = 2_000_000;
export const PLAYBACK_POLICY_KEY = 'helprr:playback-bitrate';

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
  private samples = 0;
  private average = 0;
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
