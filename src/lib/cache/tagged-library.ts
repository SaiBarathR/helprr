import { getCachedJson, setCachedJson } from '@/lib/cache/json-cache';

// Shared get-or-fetch for a tagged *arr library (Sonarr series / Radarr movies /
// Lidarr artists). One entry per (scope, instance) is reused by both the library
// routes (/api/sonarr, /api/radarr) and Insights, so a warm cache serves them all.
//
// The cache is only written when the result is TRUSTWORTHY — at least one instance
// answered. A transient all-instances-failed poll returns an empty list WITHOUT
// caching it, so a blip can never blank (or half-blank) the library for the whole
// TTL the way an unconditional write would.

export type Tagged<T> = T & { instanceId: string; instanceLabel: string };

interface LibraryInstance<C> {
  connection: { id: string; label: string };
  client: C;
}

export interface TaggedLibraryResult<T> {
  items: Tagged<T>[];
  /** True when served from cache (no live fetch happened this request). */
  cached: boolean;
  /**
   * Data is trustworthy: a cache hit, or ≥1 configured instance answered live.
   * False when nothing is configured or every instance failed — callers that
   * distinguish "unavailable" from "empty" (e.g. Insights) key off this.
   */
  available: boolean;
}

const DEFAULT_TTL_SECONDS = 120;

export function emptyTaggedLibrary<T>(): TaggedLibraryResult<T> {
  return { items: [], cached: false, available: false };
}

export async function getCachedTaggedLibrary<C, T extends object>(opts: {
  scope: string;
  cacheKeySeed: string;
  ttlSeconds?: number;
  getInstances: () => Promise<LibraryInstance<C>[]>;
  fetchOne: (client: C) => Promise<T[]>;
}): Promise<TaggedLibraryResult<T>> {
  const cached = await getCachedJson<Tagged<T>[]>(opts.scope, opts.cacheKeySeed);
  if (cached) return { items: cached, cached: true, available: true };

  const instances = await opts.getInstances();
  let anyOk = false;
  const lists = await Promise.all(
    instances.map(async ({ connection, client }) => {
      try {
        const rows = await opts.fetchOne(client);
        anyOk = true;
        return rows.map((row): Tagged<T> => ({
          ...row,
          instanceId: connection.id,
          instanceLabel: connection.label,
        }));
      } catch {
        // One unreachable/misconfigured instance must not blank the whole library.
        return [] as Tagged<T>[];
      }
    })
  );
  const items = lists.flat();

  if (anyOk) {
    await setCachedJson(opts.scope, opts.cacheKeySeed, items, opts.ttlSeconds ?? DEFAULT_TTL_SECONDS);
  }
  return { items, cached: false, available: anyOk };
}
