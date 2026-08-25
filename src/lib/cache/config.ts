function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const normalized = value.trim();
  if (!/^[1-9][0-9]*$/.test(normalized)) return fallback;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return parsed;
}

export const IMAGE_CACHE_DIR = process.env.IMAGE_CACHE_DIR || '/app/image-cache';

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

export const IMAGE_UPSTREAM_MAX_BYTES = parsePositiveInt(
  process.env.IMAGE_UPSTREAM_MAX_BYTES,
  10 * 1024 * 1024
);

export const IMAGE_UPSTREAM_MAX_PIXELS = parsePositiveInt(
  process.env.IMAGE_UPSTREAM_MAX_PIXELS,
  40_000_000
);

export const IMAGE_CACHE_MAX_BYTES = parsePositiveInt(
  process.env.IMAGE_CACHE_MAX_BYTES,
  1024 * 1024 * 1024
);

export const IMAGE_CACHE_MAX_ENTRIES = parsePositiveInt(
  process.env.IMAGE_CACHE_MAX_ENTRIES,
  32_000
);

export const IMAGE_PROCESSING_QUEUE_WAIT_MS = parsePositiveInt(
  process.env.IMAGE_PROCESSING_QUEUE_WAIT_MS,
  30_000
);

export const IMAGE_PROCESSING_QUEUE_MAX = parsePositiveInt(
  process.env.IMAGE_PROCESSING_QUEUE_MAX,
  256
);

export const IMAGE_PROCESSING_QUEUE_PER_USER_MAX = parsePositiveInt(
  process.env.IMAGE_PROCESSING_QUEUE_PER_USER_MAX,
  64
);

export const IMAGE_PROCESSING_GLOBAL_MAX = 16;
export const IMAGE_PROCESSING_PER_USER_MAX = 5;

export const IMAGE_FETCH_RATE_BURST = parsePositiveInt(
  process.env.IMAGE_FETCH_RATE_BURST,
  600
);

export const IMAGE_FETCH_RATE_REFILL_PER_MINUTE = parsePositiveInt(
  process.env.IMAGE_FETCH_RATE_REFILL_PER_MINUTE,
  300
);

export const IMAGE_QUOTA_LOCK_WAIT_MS = parsePositiveInt(
  process.env.IMAGE_QUOTA_LOCK_WAIT_MS,
  2_000
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
