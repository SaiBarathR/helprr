/**
 * Shared HTTP rate-limit header helpers (used by the TMDB and AniList clients).
 * Headers may arrive as plain objects or AxiosHeaders instances with arbitrary
 * casing — never index them directly.
 */

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
}

export function getHeader(headers: unknown, key: string): string | null {
  const record = toRecord(headers);
  const direct = record[key];
  if (typeof direct === 'string' && direct) return direct;

  const lower = key.toLowerCase();
  const lowerValue = record[lower];
  if (typeof lowerValue === 'string' && lowerValue) return lowerValue;

  for (const [k, v] of Object.entries(record)) {
    if (k.toLowerCase() === lower && typeof v === 'string' && v) {
      return v;
    }
  }

  return null;
}

/** Parse `Retry-After` (seconds or HTTP-date) with `X-RateLimit-Reset` (epoch seconds) fallback. */
export function parseRetryAfter(headers: unknown): { retryAfterSeconds: number | null; retryAt: string | null } {
  const retryAfterRaw = getHeader(headers, 'retry-after');
  if (retryAfterRaw) {
    const asSeconds = Number(retryAfterRaw);
    if (Number.isFinite(asSeconds) && asSeconds > 0) {
      const retryAtMs = Date.now() + asSeconds * 1000;
      return {
        retryAfterSeconds: Math.ceil(asSeconds),
        retryAt: new Date(retryAtMs).toISOString(),
      };
    }

    const asDateMs = Date.parse(retryAfterRaw);
    if (!Number.isNaN(asDateMs)) {
      const delta = Math.max(1, Math.ceil((asDateMs - Date.now()) / 1000));
      return {
        retryAfterSeconds: delta,
        retryAt: new Date(asDateMs).toISOString(),
      };
    }
  }

  const resetRaw = getHeader(headers, 'x-ratelimit-reset') || getHeader(headers, 'x-rate-limit-reset');
  if (resetRaw) {
    const asEpochSeconds = Number(resetRaw);
    if (Number.isFinite(asEpochSeconds) && asEpochSeconds > 0) {
      const resetMs = asEpochSeconds * 1000;
      const delta = Math.max(1, Math.ceil((resetMs - Date.now()) / 1000));
      return {
        retryAfterSeconds: delta,
        retryAt: new Date(resetMs).toISOString(),
      };
    }
  }

  return { retryAfterSeconds: null, retryAt: null };
}
