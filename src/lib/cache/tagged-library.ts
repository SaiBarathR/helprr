import { getCacheGeneration } from '@/lib/cache/state';
import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { getCachedJson, setCachedJson, deleteCachedJson } from '@/lib/cache/json-cache';
import { deleteCachedLibraryGaps } from '@/lib/cache/library-gaps-cache';
import { measureServer } from '@/lib/server-perf';

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
  complete: boolean;
}

const DEFAULT_TTL_SECONDS = 120;
const PROJECTED_CACHE_SCOPE_PREFIX = 'tagged-library-projection';
const PROJECTED_CACHE_KEYS = ['full', 'list'] as const;

interface SerializedJsonProjection {
  body: string;
  etag: string;
  itemCount: number;
}

// Shared across route bundles in the supported single-process deployment.
const catalogGlobal = globalThis as typeof globalThis & { __helprrTaggedLibraries?: {
  library: Map<string, Promise<TaggedLibraryResult<object>>>;
  projection: Map<string, Promise<SerializedJsonProjection>>;
  versions: Map<string, number>;
} };
const cacheState = catalogGlobal.__helprrTaggedLibraries ??= { library: new Map(), projection: new Map(), versions: new Map() };
const inflightLibraryLoads = cacheState.library;
const inflightProjectionLoads = cacheState.projection;
const invalidationVersions = cacheState.versions;
async function revisionSeed(scope: string, seed: string): Promise<string> {
  return JSON.stringify([seed, await getCacheGeneration(), currentInvalidationVersion(scope, seed)]);
}

function versionKey(scope: string, cacheKeySeed: string): string {
  return `${scope}:${cacheKeySeed}`;
}

function currentInvalidationVersion(scope: string, cacheKeySeed: string): number {
  return invalidationVersions.get(versionKey(scope, cacheKeySeed)) ?? 0;
}

function bumpInvalidationVersion(scope: string, cacheKeySeed: string): void {
  const key = versionKey(scope, cacheKeySeed);
  invalidationVersions.set(key, (invalidationVersions.get(key) ?? 0) + 1);
}

function projectionScope(scope: string): string {
  return `${PROJECTED_CACHE_SCOPE_PREFIX}:${scope}`;
}

function projectionSeed(cacheKeySeed: string, projectionKey: string): string {
  return JSON.stringify([cacheKeySeed, projectionKey]);
}

function makeSerializedProjection(payload: unknown, itemCount: number): SerializedJsonProjection {
  const body = JSON.stringify(payload);
  return {
    body,
    etag: `"${createHash('sha1').update(body).digest('hex')}"`,
    itemCount,
  };
}

function serializedJsonResponse(
  request: { headers: Headers },
  projection: SerializedJsonProjection,
  headers: Record<string, string>,
): NextResponse {
  const ifNoneMatch = request.headers.get('if-none-match');
  const matches = ifNoneMatch
    ?.split(',')
    .some((candidate) => candidate.trim().replace(/^W\//, '') === projection.etag);
  if (matches) {
    return new NextResponse(null, { status: 304, headers: { ...headers, ETag: projection.etag } });
  }

  return new NextResponse(projection.body, {
    status: 200,
    headers: { ...headers, ETag: projection.etag, 'Content-Type': 'application/json' },
  });
}

export function emptyTaggedLibrary<T>(): TaggedLibraryResult<T> {
  return { items: [], cached: false, available: false, complete: false };
}

export async function getCachedTaggedLibrary<C, T extends object>(opts: {
  scope: string;
  cacheKeySeed: string;
  ttlSeconds?: number;
  getInstances: () => Promise<LibraryInstance<C>[]>;
  fetchOne: (client: C) => Promise<T[]>;
}): Promise<TaggedLibraryResult<T>> {
  const readSeed = await revisionSeed(opts.scope, opts.cacheKeySeed);
  const cached = await measureServer('cache', () => getCachedJson<Tagged<T>[]>(opts.scope, readSeed));
  if (cached) return { items: cached, cached: true, available: true, complete: true };

  const startedVersion = currentInvalidationVersion(opts.scope, opts.cacheKeySeed);
  const inflightKey = JSON.stringify([opts.scope, readSeed]);
  const existing = inflightLibraryLoads.get(inflightKey) as Promise<TaggedLibraryResult<T>> | undefined;
  if (existing) return existing;

  const promise = loadTaggedLibraryLive(opts, startedVersion, readSeed).finally(() => {
    inflightLibraryLoads.delete(inflightKey);
  });
  inflightLibraryLoads.set(inflightKey, promise as Promise<TaggedLibraryResult<object>>);
  return promise;
}

async function loadTaggedLibraryLive<C, T extends object>(
  opts: {
    scope: string;
    cacheKeySeed: string;
    ttlSeconds?: number;
    getInstances: () => Promise<LibraryInstance<C>[]>;
    fetchOne: (client: C) => Promise<T[]>;
  },
  startedVersion: number,
  readSeed: string,
): Promise<TaggedLibraryResult<T>> {
  const instances = await opts.getInstances();
  let anyOk = false;
  let anyFailed = false;
  const lists = await Promise.all(
    instances.map(async ({ connection, client }) => {
      try {
        const rows = await measureServer('upstream', () => opts.fetchOne(client));
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
  if (
    instances.length > 0
    && !anyFailed
    && currentInvalidationVersion(opts.scope, opts.cacheKeySeed) === startedVersion
  ) {
    await setCachedJson(opts.scope, readSeed, items, opts.ttlSeconds ?? DEFAULT_TTL_SECONDS);
  }
  return { items, cached: false, available: anyOk, complete: instances.length > 0 && !anyFailed };
}

export async function getCachedTaggedLibraryJsonResponse(
  request: { headers: Headers },
  headers: Record<string, string>,
  opts: {
    scope: string;
    cacheKeySeed: string;
    projectionKey: (typeof PROJECTED_CACHE_KEYS)[number] | string;
    ttlSeconds?: number;
    buildPayload: () => Promise<{ payload: unknown; itemCount: number; cacheable?: boolean }>;
  },
): Promise<{ response: NextResponse; cached: boolean; itemCount: number }> {
  const scope = projectionScope(opts.scope);
  const seed = projectionSeed(await revisionSeed(opts.scope, opts.cacheKeySeed), opts.projectionKey);
  const cached = await measureServer('cache', () => getCachedJson<SerializedJsonProjection>(scope, seed));
  if (cached) {
    return {
      response: serializedJsonResponse(request, cached, headers),
      cached: true,
      itemCount: cached.itemCount,
    };
  }

  const startedVersion = currentInvalidationVersion(opts.scope, opts.cacheKeySeed);
  const inflightKey = JSON.stringify([scope, seed, startedVersion]);
  const existing = inflightProjectionLoads.get(inflightKey);
  if (existing) {
    const projection = await existing;
    return {
      response: serializedJsonResponse(request, projection, headers),
      cached: false,
      itemCount: projection.itemCount,
    };
  }

  const promise = (async () => {
    // Projection includes its nested cache/upstream reads; the other spans
    // expose that breakdown, and these totals must not be summed together.
    const { payload, itemCount, cacheable } = await measureServer('projection', opts.buildPayload);
    const projection = await measureServer('serialization', async () => makeSerializedProjection(payload, itemCount));
    if (cacheable !== false && currentInvalidationVersion(opts.scope, opts.cacheKeySeed) === startedVersion) {
      await setCachedJson(scope, seed, projection, opts.ttlSeconds ?? DEFAULT_TTL_SECONDS);
    }
    return projection;
  })().finally(() => {
    inflightProjectionLoads.delete(inflightKey);
  });

  inflightProjectionLoads.set(inflightKey, promise);
  const projection = await promise;
  return {
    response: serializedJsonResponse(request, projection, headers),
    cached: false,
    itemCount: projection.itemCount,
  };
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
    for (const seed of seeds) bumpInvalidationVersion(scope, seed);
    const ops: Promise<void>[] = seeds.map((seed) => deleteCachedJson(scope, seed));
    for (const seed of seeds) {
      for (const projectionKey of PROJECTED_CACHE_KEYS) {
        ops.push(deleteCachedJson(projectionScope(scope), projectionSeed(seed, projectionKey)));
      }
    }

    // Global search serves a pre-built per-module index; a deleted item stays findable until it
    // is dropped (scope 'searchindex' / module from search/index-builder.ts).
    const searchModule = SEARCH_MODULE_BY_SCOPE[scope];
    if (searchModule) ops.push(deleteCachedJson('searchindex', searchModule));

    // Radarr collections derive from the movie library (membership + missing counts). Keep
    // 'radarr-collections' in sync with COLLECTIONS_SCOPE in api/radarr/collections/route.ts.
    if (scope === 'radarr') {
      for (const seed of seeds) ops.push(deleteCachedJson('radarr-collections', seed));
    }

    // Insights' media analysis keeps its own normalized Sonarr episode-file cache
    // (15 min); drop it so an import/upgrade/delete shows up in Analysis right away.
    // Keep in sync with CACHE_SCOPE in lib/media-analysis.ts. Radarr needs no entry —
    // its analysis rows derive live from the tagged movie library dropped above.
    if (scope === 'sonarr') ops.push(deleteCachedJson('media-analysis', 'sonarr'));

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
