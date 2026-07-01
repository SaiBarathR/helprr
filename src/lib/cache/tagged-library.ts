import { getCachedJson, setCachedJson, deleteCachedJson } from '@/lib/cache/json-cache';
import { deleteCachedLibraryGaps } from '@/lib/cache/library-gaps-cache';

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

// Maps each *arr library scope to its global-search index module (see search/index-builder.ts).
const SEARCH_MODULE_BY_SCOPE: Record<string, string> = {
  radarr: 'movies',
  sonarr: 'series',
  lidarr: 'music',
};

// *arr commands (refresh / rename / manual import) mutate data ASYNCHRONOUSLY: the
// POST returns immediately while the work happens seconds later, so invalidating at
// POST time is useless — the next GET would just re-cache pre-refresh data. Instead
// the command STATUS routes (/api/{svc}/command/[id], polled by pollCommand until a
// terminal status) call this on every poll: any poll that observes `completed` for a
// data-mutating command drops the derived caches — in practice once per command, since
// pollCommand stops at the first terminal status. Searches are excluded — their
// completion only queues grabs; the library changes later via the *arr's own import.
const MUTATING_COMMANDS = new Set([
  'RefreshMovie',
  'RefreshSeries',
  'RefreshArtist',
  'RenameFiles',
  'RenameSeries',
  'ManualImport',
  'RefreshMonitoredDownloads',
]);

export async function invalidateOnCommandComplete(
  scope: string,
  command: { name?: string; status?: string },
  instanceId?: string
): Promise<void> {
  if (command.status === 'completed' && command.name && MUTATING_COMMANDS.has(command.name)) {
    await invalidateTaggedLibrary(scope, instanceId);
  }
}

// Bust every cache derived from a service's raw library after a mutation: the library list
// itself, its global-search index module, and (Radarr only) the collections view — so none
// of them replays a deleted/added item for the rest of its TTL. Drops the instance's own seed
// AND the 'all' aggregate, because a per-instance write also changes the combined list —
// mirroring the `instanceId ?? 'all'` seed convention the library routes write under.
export async function invalidateTaggedLibrary(scope: string, instanceId?: string): Promise<void> {
  try {
    const seeds = [...new Set([instanceId ?? 'all', 'all'])];
    const ops: Promise<void>[] = seeds.map((seed) => deleteCachedJson(scope, seed));

    // Global search serves a pre-built per-module index; a deleted item stays findable until it
    // is dropped (scope 'searchindex' / module from search/index-builder.ts).
    const searchModule = SEARCH_MODULE_BY_SCOPE[scope];
    if (searchModule) ops.push(deleteCachedJson('searchindex', searchModule));

    // Radarr collections derive from the movie library (membership + missing counts). Keep
    // 'radarr-collections' in sync with COLLECTIONS_SCOPE in api/radarr/collections/route.ts.
    if (scope === 'radarr') {
      for (const seed of seeds) ops.push(deleteCachedJson('radarr-collections', seed));
    }

    // Library gaps aggregate across the *arr libraries; drop them so a mutated
    // library doesn't replay its pre-mutation gaps for the rest of the TTL.
    ops.push(deleteCachedLibraryGaps());

    await Promise.all(ops);
  } catch {
    // Cache busting is best-effort: a mutation that already succeeded upstream must never
    // turn into a 500 because Redis hiccuped. Leaf helpers already swallow their own
    // errors; this guarantees the no-throw contract here instead of relying on them.
  }
}
