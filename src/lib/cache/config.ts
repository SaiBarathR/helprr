function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export const IMAGE_CACHE_DIR = process.env.IMAGE_CACHE_DIR || '/tmp/helprr-image-cache';

export const IMAGE_CACHE_TTL_SECONDS = parsePositiveInt(
  process.env.IMAGE_CACHE_TTL_SECONDS,
  7 * 24 * 60 * 60
);

export const IMAGE_CACHE_STALE_SECONDS = parsePositiveInt(
  process.env.IMAGE_CACHE_STALE_SECONDS,
  30 * 24 * 60 * 60
);

export const IMAGE_UPSTREAM_FETCH_TIMEOUT_MS = parsePositiveInt(
  process.env.IMAGE_UPSTREAM_FETCH_TIMEOUT_MS,
  5_000
);

export const TMDB_CACHE_DEFAULT_TTL_SECONDS = parsePositiveInt(
  process.env.TMDB_CACHE_DEFAULT_TTL_SECONDS,
  10 * 60
);

export const TMDB_CACHE_DISCOVER_TTL_SECONDS = parsePositiveInt(
  process.env.TMDB_CACHE_DISCOVER_TTL_SECONDS,
  10 * 60
);

export const TMDB_CACHE_DETAILS_TTL_SECONDS = parsePositiveInt(
  process.env.TMDB_CACHE_DETAILS_TTL_SECONDS,
  24 * 60 * 60
);

export const TMDB_CACHE_STATIC_TTL_SECONDS = parsePositiveInt(
  process.env.TMDB_CACHE_STATIC_TTL_SECONDS,
  7 * 24 * 60 * 60
);

export const TMDB_CACHE_STALE_SECONDS = parsePositiveInt(
  process.env.TMDB_CACHE_STALE_SECONDS,
  30 * 24 * 60 * 60
);

export const CACHE_LOCK_TTL_MS = parsePositiveInt(
  process.env.CACHE_LOCK_TTL_MS,
  10_000
);
