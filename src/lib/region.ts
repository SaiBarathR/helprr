/** Default region used when a watch-provider region is missing or invalid. */
export const FALLBACK_REGION = 'US';

/**
 * Normalize a value to an ISO 3166-1 alpha-2 region code (uppercase), or return
 * null when it isn't a valid 2-letter code. Pure and dependency-free so both
 * client and server callers can share one source of truth for region validation.
 */
export function normalizeRegionCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}
