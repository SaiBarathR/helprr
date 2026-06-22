import type { Tagged } from '@/lib/discover';
import type { RadarrMovie, SonarrSeries, LidarrArtist } from '@/types';
import type { SearchDoc, SearchModule } from '@/lib/search/types';
import { getCachedJson, setCachedJson } from '@/lib/cache/json-cache';
import { tryAcquireCacheLock, releaseCacheLock } from '@/lib/cache/state';
import { getSonarrClients, getRadarrClients, getLidarrClients } from '@/lib/service-helpers';
import { seriesToDocs, moviesToDocs, artistsToDocs, watchlistToDocs } from '@/lib/search/normalize';
import { withTimeout } from '@/lib/search/with-timeout';

// Pre-built, cached library index. Libraries are bounded and change slowly, so we
// normalize once into SearchDoc[] and cache it in Redis (generation-versioned, so an
// admin cache-purge invalidates it for free). A keystroke search = one Redis read per
// gated module + an in-memory scan — no *arr/HTTP work in the hot path.

type CachedModule = Exclude<SearchModule, 'watchlist'>; // watchlist is per-user, never cached cross-user
const SCOPE = 'searchindex';
const INDEX_TTL_SECONDS = 300;
const INSTANCE_FETCH_TIMEOUT_MS = 4_000;
const LOCK_WAIT_MS = 200;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function buildMovieDocs(): Promise<SearchDoc[]> {
  const clients = await getRadarrClients();
  const per = await Promise.all(
    clients.map(({ connection, client }) =>
      withTimeout(
        client
          .getMovies()
          .then((list) => list.map((m): Tagged<RadarrMovie> => ({ ...m, instanceId: connection.id, instanceLabel: connection.label }))),
        INSTANCE_FETCH_TIMEOUT_MS,
        [] as Tagged<RadarrMovie>[]
      )
    )
  );
  return moviesToDocs(per.flat());
}

async function buildSeriesDocs(): Promise<SearchDoc[]> {
  const clients = await getSonarrClients();
  const per = await Promise.all(
    clients.map(({ connection, client }) =>
      withTimeout(
        client
          .getSeries()
          .then((list) => list.map((s): Tagged<SonarrSeries> => ({ ...s, instanceId: connection.id, instanceLabel: connection.label }))),
        INSTANCE_FETCH_TIMEOUT_MS,
        [] as Tagged<SonarrSeries>[]
      )
    )
  );
  return seriesToDocs(per.flat());
}

async function buildMusicDocs(): Promise<SearchDoc[]> {
  const clients = await getLidarrClients();
  const per = await Promise.all(
    clients.map(({ connection, client }) =>
      withTimeout(
        client
          .getArtists()
          .then((list) => list.map((a): Tagged<LidarrArtist> => ({ ...a, instanceId: connection.id, instanceLabel: connection.label }))),
        INSTANCE_FETCH_TIMEOUT_MS,
        [] as Tagged<LidarrArtist>[]
      )
    )
  );
  return artistsToDocs(per.flat());
}

function buildModuleDocs(module: CachedModule): Promise<SearchDoc[]> {
  if (module === 'series') return buildSeriesDocs();
  if (module === 'movies') return buildMovieDocs();
  return buildMusicDocs();
}

/**
 * Cached, normalized index for one *arr-backed module. Cache hit → instant Redis
 * read. Miss → rebuild under a coalescing lock so concurrent first-searches don't
 * all hammer the *arr instances (thundering-herd guard); a request that loses the
 * lock waits briefly and re-reads the cache the winner populated.
 */
export async function getModuleIndex(module: CachedModule): Promise<SearchDoc[]> {
  const cached = await getCachedJson<SearchDoc[]>(SCOPE, module);
  if (cached) return cached;

  const token = await tryAcquireCacheLock(SCOPE, module);
  if (!token) {
    await sleep(LOCK_WAIT_MS);
    const retry = await getCachedJson<SearchDoc[]>(SCOPE, module);
    if (retry) return retry;
    // Builder still running (or caching disabled) — fall through and build ourselves.
  }

  try {
    const docs = await buildModuleDocs(module);
    // Never cache an empty index: it's either a genuinely empty library (cheap to
    // rebuild) or every instance failed/timed out — and caching the latter would
    // blank this module for the whole TTL even after the *arr services recover.
    if (docs.length > 0) await setCachedJson(SCOPE, module, docs, INDEX_TTL_SECONDS);
    return docs;
  } finally {
    if (token) await releaseCacheLock(SCOPE, module, token);
  }
}

/** Per-user watchlist index — queried fresh (cheap, indexed) so it never leaks across users. */
export function getWatchlistDocs(userId: string): Promise<SearchDoc[]> {
  return watchlistToDocs(userId);
}
