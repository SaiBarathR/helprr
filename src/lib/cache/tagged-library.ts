import { getCachedJson, setCachedJson, deleteCachedJson } from '@/lib/cache/json-cache';

// Shared get-or-fetch for a tagged *arr library (Sonarr series / Radarr movies /
// Lidarr artists). One entry per (scope, instance) is reused by both the library
// routes (/api/sonarr, /api/radarr) and Insights, so a warm cache serves them all.
//
// The cache is only written when the result is COMPLETE — every configured instance
// answered. A partial (some instances failed) or all-failed poll returns its list
// WITHOUT caching it, so a blip can never blank (or half-blank) the library for the
// whole TTL the way an unconditional write would.

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
  let anyFailed = false;
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
        anyFailed = true;
        return [] as Tagged<T>[];
      }
    })
  );
  const items = lists.flat();

  // Cache only a COMPLETE result — every configured instance answered. A partial poll
  // (some instances failed) is left uncached so a recovered instance appears on the next
  // request instead of being masked by a stale partial aggregate for the whole TTL.
  if (instances.length > 0 && !anyFailed) {
    await setCachedJson(opts.scope, opts.cacheKeySeed, items, opts.ttlSeconds ?? DEFAULT_TTL_SECONDS);
  }
  return { items, cached: false, available: anyOk };
}

// Bust the cached library for a service after a mutation so the next read repopulates from
// upstream instead of replaying a stale entry for the rest of its TTL. Drops the instance's
// own seed AND the 'all' aggregate, because a per-instance write also changes the combined
// list — mirroring the `instanceId ?? 'all'` seed convention the library routes write under.
export async function invalidateTaggedLibrary(scope: string, instanceId?: string): Promise<void> {
  const seeds = new Set([instanceId ?? 'all', 'all']);
  await Promise.all([...seeds].map((seed) => deleteCachedJson(scope, seed)));
}
