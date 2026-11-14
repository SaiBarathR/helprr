export const AUTOMATIC_INITIAL_BITRATE = 6_000_000;
export const DATA_SAVER_BITRATE = 2_000_000;
export const PLAYBACK_POLICY_KEY = 'helprr:playback-bitrate';
/** How long a measured start bitrate is trusted: jellyfin-web's hour
 *  (bitrateTest.ts `BITRATE_CACHE_DURATION`). */
export const BANDWIDTH_PROBE_TTL_MS = 60 * 60_000;
/**
 * How long a result above `FAST_LINK_BITRATE` is trusted. A phone that measured
 * home Wi-Fi can be on cellular minutes later, and an iPhone gives no network
 * change event (see `networkChanged`): a 120 Mbps ceiling kept for an hour
 * would direct-play a remux over LTE.
 */
export const FAST_LINK_TTL_MS = 10 * 60_000;
export const FAST_LINK_BITRATE = 20_000_000;
/** How long a failed test is trusted before the next start tries again.
 *  jellyfin-web keeps no failed result at all; a minute keeps a dead link
 *  from adding its timeout to every start. */
export const FAILED_PROBE_TTL_MS = 60_000;
/** Hidden longer than this, the page may be on another network when it is
 *  back: the measurement is dropped (the iPhone's only signal of a move). */
export const LONG_HIDDEN_MS = 10 * 60_000;
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
  /** The last test measured nothing (see `FAILED_PROBE_TTL_MS`). */
  private failed = false;
  private samples = 0;
  private average = 0;
  /** Whether Automatic should measure the link again before its next start. */
  needsProbe(now = Date.now()): boolean {
    if (!this.seededAt) return true;
    const ttl = this.failed ? FAILED_PROBE_TTL_MS
      : this.ceiling > FAST_LINK_BITRATE ? FAST_LINK_TTL_MS
        : BANDWIDTH_PROBE_TTL_MS;
    return now - this.seededAt > ttl;
  }
  /**
   * Start from a measured download (`probeBandwidth`) instead of the fixed
   * guess, as jellyfin-web does: the measurement replaces the ceiling, lower
   * for a slow link and higher for a fast one (see `measuredStartBitrate`).
   * A failed test (0) keeps the ceiling it has. `mayLower` false: a test that
   * shared the link with a stream still downloading reads it slow, so it may
   * only raise the ceiling.
   */
  seed(bitsPerSecond: number, now = Date.now(), downlinkMaxMbps?: number, mayLower = true): void {
    this.seededAt = now;
    this.failed = !(bitsPerSecond > 0);
    if (this.failed) return;
    const measured = effectiveBitrate(0, measuredStartBitrate(bitsPerSecond, downlinkMaxMbps));
    const next = mayLower ? measured : Math.max(measured, this.ceiling);
    if (next === this.ceiling) return;
    this.ceiling = next;
    this.samples = 0;
  }
  /**
   * The network may have changed (a connection change, back online, or the
   * page hidden a long while): measure again before the next start, and until
   * then start no higher than the first guess, since a restart of the title on
   * screen does not measure.
   */
  networkChanged(): void {
    this.seededAt = 0;
    this.failed = false;
    this.ceiling = Math.min(this.ceiling, AUTOMATIC_INITIAL_BITRATE);
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
