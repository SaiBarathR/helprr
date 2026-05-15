/**
 * Format a millisecond delta as a compact "Xh Ym Zs" / "Ym Zs" / "Zs" string.
 * Returns "imminent" when the delta is zero or negative.
 *
 * Used by the cleanup dashboard tab and the cleanup-status widget for the
 * "Next run in …" countdown — sharing one implementation keeps the copy
 * identical between the two surfaces.
 */
export function formatDelta(ms: number): string {
  if (ms <= 0) return 'imminent';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
