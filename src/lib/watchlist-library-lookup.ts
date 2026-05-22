import { getRadarrClient, getSonarrClient } from '@/lib/service-helpers';
import type { RadarrMovie, SonarrSeries } from '@/types';
import { watchlistHrefFor } from '@/lib/watchlist-helpers';

export interface LibraryHrefLookups {
  radarrByTmdbId: Map<number, number>;
  sonarrByTvdbId: Map<number, number>;
  sonarrByTmdbId: Map<number, number>;
}

export interface LookupNeeds {
  tmdbMovie: boolean;
  tvdbSeries: boolean;
  tmdbSeries: boolean;
}

const LOOKUPS_TTL_MS = 5 * 60 * 1000;

// Module-scope cache. Helprr is single-instance today; if that ever changes,
// move this behind Redis (the dashboard layout cache is the existing pattern).
let lookupsCache: { at: number; value: LibraryHrefLookups } | null = null;

export async function getLibraryLookups(needs: LookupNeeds): Promise<LibraryHrefLookups> {
  const now = Date.now();
  if (lookupsCache && now - lookupsCache.at < LOOKUPS_TTL_MS) {
    return lookupsCache.value;
  }

  const needRadarr = needs.tmdbMovie;
  const needSonarr = needs.tvdbSeries || needs.tmdbSeries;

  const [movies, series] = await Promise.all([
    needRadarr
      ? (async () => {
          try {
            const c = await getRadarrClient();
            return await c.getMovies();
          } catch {
            return [] as RadarrMovie[];
          }
        })()
      : Promise.resolve([] as RadarrMovie[]),
    needSonarr
      ? (async () => {
          try {
            const c = await getSonarrClient();
            return await c.getSeries();
          } catch {
            return [] as SonarrSeries[];
          }
        })()
      : Promise.resolve([] as SonarrSeries[]),
  ]);

  const radarrByTmdbId = new Map<number, number>();
  for (const m of movies) {
    if (m.tmdbId) radarrByTmdbId.set(m.tmdbId, m.id);
  }
  const sonarrByTvdbId = new Map<number, number>();
  const sonarrByTmdbId = new Map<number, number>();
  for (const s of series) {
    if (s.tvdbId) sonarrByTvdbId.set(s.tvdbId, s.id);
    const tmdbId = (s as SonarrSeries & { tmdbId?: number }).tmdbId;
    if (tmdbId) sonarrByTmdbId.set(tmdbId, s.id);
  }

  const value: LibraryHrefLookups = { radarrByTmdbId, sonarrByTvdbId, sonarrByTmdbId };
  lookupsCache = { at: now, value };
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
        const id = lookups.radarrByTmdbId.get(externalNum);
        if (id) return `/movies/${id}`;
      }
      if (source === 'TVDB' && mediaType === 'series') {
        const id = lookups.sonarrByTvdbId.get(externalNum);
        if (id) return `/series/${id}`;
      }
      if (source === 'TMDB' && mediaType === 'series') {
        const id = lookups.sonarrByTmdbId.get(externalNum);
        if (id) return `/series/${id}`;
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
