/**
 * How far the player's back and forward controls jump. Separate back and
 * forward lengths, as Jellyfin Web has, picked from a fixed list so a hand-
 * edited settings import cannot set something unusable.
 */
export const SKIP_LENGTH_OPTIONS = [5, 10, 15, 20, 30, 45, 60] as const;

export const DEFAULT_SKIP_SECONDS = 10;

export function isSkipLength(value: unknown): value is number {
  return typeof value === 'number' && (SKIP_LENGTH_OPTIONS as readonly number[]).includes(value);
}
