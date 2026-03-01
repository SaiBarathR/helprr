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

export function buildTmdbDataKey(generation: number, keySeed: string): string {
  return `helprr:cache:tmdb:v${generation}:${sha256Hex(keySeed)}`;
}

export function buildLockKey(scope: string, keySeed: string): string {
  return `helprr:cache:lock:${scope}:${sha256Hex(keySeed)}`;
}
