import { getRadarrClients, getSonarrClients } from '@/lib/service-helpers';
import type { RadarrMovie, SonarrSeries } from '@/types';
import { watchlistHrefFor } from '@/lib/watchlist-helpers';

/** The arr id of a library match plus the instance it lives in, so hrefs can
 * deep-link to the correct instance. */
interface LibraryRef {
  id: number;
  instanceId: string;
}

export interface LibraryHrefLookups {
  radarrByTmdbId: Map<number, LibraryRef>;
  sonarrByTvdbId: Map<number, LibraryRef>;
  sonarrByTmdbId: Map<number, LibraryRef>;
}

export interface LookupNeeds {
  tmdbMovie: boolean;
  tvdbSeries: boolean;
  tmdbSeries: boolean;
}

const LOOKUPS_TTL_MS = 5 * 60 * 1000;

// Module-scope cache, unioned across all instances of each type. Lives
// per-process; if Helprr ever runs multiple replicas, move this behind Redis
// (the dashboard layout cache is the existing pattern).
// Keyed by which datasets the caller asked for so a request for
// {tmdbMovie:true} doesn't get served a cached value that was populated with
// only Radarr data (empty Sonarr maps) — and vice versa.
let lookupsCache: { key: string; at: number; value: LibraryHrefLookups } | null = null;

function cacheKeyFor(needs: LookupNeeds): string {
  return `${needs.tmdbMovie ? 1 : 0}${needs.tvdbSeries ? 1 : 0}${needs.tmdbSeries ? 1 : 0}`;
}

export async function getLibraryLookups(needs: LookupNeeds): Promise<LibraryHrefLookups> {
  const now = Date.now();
  const cacheKey = cacheKeyFor(needs);
  if (lookupsCache && lookupsCache.key === cacheKey && now - lookupsCache.at < LOOKUPS_TTL_MS) {
    return lookupsCache.value;
  }

  const needRadarr = needs.tmdbMovie;
  const needSonarr = needs.tvdbSeries || needs.tmdbSeries;

  // Track per-service failures so we can serve a (possibly partial) result
  // for *this* request without poisoning the cache. Caching an empty map on
  // a transient Sonarr 503 would hide every TVDB-series href for 5 minutes.
  let radarrFailed = false;
  let sonarrFailed = false;

  // Union across every instance of each type (an item is "in library" if it lives
  // in ≥1 instance). One unreachable instance marks the type failed so we don't
  // cache a partial result, but reachable instances still contribute.
  const [movies, series] = await Promise.all([
    needRadarr
      ? (async () => {
          const results = await Promise.allSettled(
            (await getRadarrClients()).map(async ({ connection, client }) =>
              (await client.getMovies()).map((m) => ({ ...m, instanceId: connection.id }))
            )
          );
          if (results.some((r) => r.status === 'rejected')) radarrFailed = true;
          return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
        })()
      : Promise.resolve([] as (RadarrMovie & { instanceId: string })[]),
    needSonarr
      ? (async () => {
          const results = await Promise.allSettled(
            (await getSonarrClients()).map(async ({ connection, client }) =>
              (await client.getSeries()).map((s) => ({ ...s, instanceId: connection.id }))
            )
          );
          if (results.some((r) => r.status === 'rejected')) sonarrFailed = true;
          return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
        })()
      : Promise.resolve([] as (SonarrSeries & { instanceId: string })[]),
  ]);

  // getRadarrClients/getSonarrClients return the default instance first, so the
  // `!has` guard keeps the default instance's id when an item lives in several.
  const radarrByTmdbId = new Map<number, LibraryRef>();
  for (const m of movies) {
    if (m.tmdbId && !radarrByTmdbId.has(m.tmdbId)) radarrByTmdbId.set(m.tmdbId, { id: m.id, instanceId: m.instanceId });
  }
  const sonarrByTvdbId = new Map<number, LibraryRef>();
  const sonarrByTmdbId = new Map<number, LibraryRef>();
  for (const s of series) {
    if (s.tvdbId && !sonarrByTvdbId.has(s.tvdbId)) sonarrByTvdbId.set(s.tvdbId, { id: s.id, instanceId: s.instanceId });
    const tmdbId = (s as SonarrSeries & { tmdbId?: number }).tmdbId;
    if (tmdbId && !sonarrByTmdbId.has(tmdbId)) sonarrByTmdbId.set(tmdbId, { id: s.id, instanceId: s.instanceId });
  }

  const value: LibraryHrefLookups = { radarrByTmdbId, sonarrByTvdbId, sonarrByTmdbId };
  if (!radarrFailed && !sonarrFailed) {
    lookupsCache = { key: cacheKey, at: now, value };
  }
  return value;
}

export function resolveHrefFromLookups(
  source: string,
  externalId: string,
  mediaType: string,
  lookups: LibraryHrefLookups | null
): string | null {
  if (lookups) {
    const externalNum = Number.parseInt(externalId, 10);
    if (Number.isFinite(externalNum)) {
      if (source === 'TMDB' && mediaType === 'movie') {
        const ref = lookups.radarrByTmdbId.get(externalNum);
        if (ref) return `/movies/${ref.id}?instance=${ref.instanceId}`;
      }
      if (source === 'TVDB' && mediaType === 'series') {
        const ref = lookups.sonarrByTvdbId.get(externalNum);
        if (ref) return `/series/${ref.id}?instance=${ref.instanceId}`;
      }
      if (source === 'TMDB' && mediaType === 'series') {
        const ref = lookups.sonarrByTmdbId.get(externalNum);
        if (ref) return `/series/${ref.id}?instance=${ref.instanceId}`;
      }
    }
  }
  return watchlistHrefFor(source, externalId, mediaType);
}

// True when the watchlist item is already tracked by Radarr/Sonarr (either
// the source IS Radarr/Sonarr, or the external id resolves into one of them).
export function isItemInLibrary(
  source: string,
  externalId: string,
  mediaType: string,
  lookups: LibraryHrefLookups
): boolean {
  if (source === 'SONARR' || source === 'RADARR') return true;
  const externalNum = Number.parseInt(externalId, 10);
  if (!Number.isFinite(externalNum)) return false;
  if (source === 'TMDB' && mediaType === 'movie') {
    return lookups.radarrByTmdbId.has(externalNum);
  }
  if (source === 'TVDB' && mediaType === 'series') {
    return lookups.sonarrByTvdbId.has(externalNum);
  }
  if (source === 'TMDB' && mediaType === 'series') {
    return lookups.sonarrByTmdbId.has(externalNum);
  }
  return false;
}
