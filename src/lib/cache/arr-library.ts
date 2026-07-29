import { logger } from '@/lib/logger';
import { getRadarrClients, getSonarrClients } from '@/lib/service-helpers';
import {
  getCachedTaggedLibrary,
  type Tagged,
} from '@/lib/cache/tagged-library';
import type { RadarrMovie, SonarrSeries } from '@/types';

export interface ArrLibrary {
  movies: Tagged<RadarrMovie>[];
  series: Tagged<SonarrSeries>[];
}

let inflight: Promise<ArrLibrary> | null = null;

/**
 * Load the complete Radarr/Sonarr library from the same Redis entries used by
 * their list routes and polling warm-up. The two families start together, and
 * concurrent consumers in this process share one cold load.
 */
export function loadCachedArrLibrary(): Promise<ArrLibrary> {
  if (inflight) return inflight;

  const startedAt = performance.now();
  const promise = Promise.all([
    getCachedTaggedLibrary({
      scope: 'radarr',
      cacheKeySeed: 'all',
      getInstances: getRadarrClients,
      fetchOne: (client) => client.getMovies(),
    }),
    getCachedTaggedLibrary({
      scope: 'sonarr',
      cacheKeySeed: 'all',
      getInstances: getSonarrClients,
      fetchOne: (client) => client.getSeries(),
    }),
  ])
    .then(([movies, series]) => {
      logger.debug('Arr library load completed', {
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        radarrCache: movies.cached ? 'hit' : 'miss',
        sonarrCache: series.cached ? 'hit' : 'miss',
        movieCount: movies.items.length,
        seriesCount: series.items.length,
      }, { scope: 'arr-library' });
      return { movies: movies.items, series: series.items };
    })
    .finally(() => {
      if (inflight === promise) inflight = null;
    });

  inflight = promise;
  return promise;
}
