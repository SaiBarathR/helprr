import { createHash } from 'crypto';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function stableSortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableSortValue(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = stableSortValue((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableSortValue(value));
}

export function buildImageMetaKey(generation: number, keySeed: string): string {
  return `helprr:cache:image:v${generation}:${sha256Hex(keySeed)}`;
}

export function buildImageIndexKey(generation: number): string {
  return `helprr:cache:image-index:v${generation}`;
}

export function buildImageLruKey(generation: number): string {
  return `helprr:cache:image-lru:v${generation}`;
}

export function buildImageUsageKey(generation: number): string {
  return `helprr:cache:image-usage:v${generation}`;
}

export const IMAGE_CACHE_OBSERVABILITY_KEY = 'helprr:cache:image-observability';

export function buildTmdbDataKey(generation: number, keySeed: string): string {
  return `helprr:cache:tmdb:v${generation}:${sha256Hex(keySeed)}`;
}

export function buildAnilistDataKey(generation: number, keySeed: string): string {
  return `helprr:cache:anilist:v${generation}:${sha256Hex(keySeed)}`;
}

export function buildJellyfinLookupKey(generation: number, keySeed: string): string {
  return `helprr:cache:jellyfin-lookup:v${generation}:${sha256Hex(keySeed)}`;
}

export function buildJellyfinWatchStatusKey(generation: number, keySeed: string): string {
  return `helprr:cache:jellyfin-watch-status:v${generation}:${sha256Hex(keySeed)}`;
}

export function buildLibraryGapsKey(generation: number): string {
  return `helprr:cache:library-gaps:v${generation}`;
}

export function buildApiReadKey(scope: string, generation: number, keySeed: string): string {
  return `helprr:cache:api:${scope}:v${generation}:${sha256Hex(keySeed)}`;
}

export function buildLockKey(scope: string, keySeed: string): string {
  return `helprr:cache:lock:${scope}:${sha256Hex(keySeed)}`;
}
