import { getRadarrClients, getSonarrClients } from '@/lib/service-helpers';
import { lookupWatchStatus, type fetchUserWatchStatusMap } from '@/lib/jellyfin-watch-status-map';
import { arrKey, isFullyWatched } from '@/types/watch-status';
import type { RadarrMovie, RandomPick, SonarrSeries } from '@/types';

// The downloaded movie/series pool behind Random Watch, shared by
// /api/random-watch and the household Tonight pick.

export type TaggedMovie = RadarrMovie & { instanceId: string };
export type TaggedSeries = SonarrSeries & { instanceId: string };

function imageOf(images: { coverType: string; remoteUrl?: string; url?: string }[] | undefined, coverType: string): string | null {
  if (!images) return null;
  const img = images.find((i) => i.coverType === coverType);
  return img?.remoteUrl || img?.url || null;
}

function ratingOf(movie: RadarrMovie): number | null {
  const r = movie.ratings;
  if (!r) return null;
  return r.tmdb?.value ?? r.imdb?.value ?? r.metacritic?.value ?? r.trakt?.value ?? null;
}

export function pickMovie(m: TaggedMovie): RandomPick {
  return {
    mediaType: 'movie',
    id: m.id,
    instanceId: m.instanceId,
    title: m.title,
    year: m.year ?? null,
    overview: m.overview ?? null,
    posterUrl: imageOf(m.images, 'poster'),
    backdropUrl: imageOf(m.images, 'fanart') ?? imageOf(m.images, 'banner'),
    runtime: m.runtime ?? null,
    genres: m.genres ?? [],
    href: `/movies/${m.id}?instance=${m.instanceId}`,
    rating: ratingOf(m),
  };
}

export function pickSeries(s: TaggedSeries): RandomPick {
  const rating = s.ratings?.value ?? null;
  return {
    mediaType: 'series',
    id: s.id,
    instanceId: s.instanceId,
    title: s.title,
    year: s.year ?? null,
    overview: s.overview ?? null,
    posterUrl: imageOf(s.images, 'poster'),
    backdropUrl: imageOf(s.images, 'fanart') ?? imageOf(s.images, 'banner'),
    runtime: s.runtime ?? null,
    genres: s.genres ?? [],
    href: `/series/${s.id}?instance=${s.instanceId}`,
    rating: rating ?? null,
  };
}

// Module-scope pool cache, unioned across all Radarr/Sonarr instances and tagged
// with the originating instance so a pick links back to the right one. Lives
// per-process; if Helprr ever runs multiple replicas, move this behind Redis or
// accept the per-process cost.
const POOL_TTL_MS = 5 * 60 * 1000;
let moviePoolCache: { at: number; value: TaggedMovie[] } | null = null;
let seriesPoolCache: { at: number; value: TaggedSeries[] } | null = null;

export async function fetchMoviePool(): Promise<TaggedMovie[]> {
  const now = Date.now();
  if (moviePoolCache && now - moviePoolCache.at < POOL_TTL_MS) {
    return moviePoolCache.value;
  }
  try {
    const all = (await Promise.all((await getRadarrClients()).map(async ({ connection, client }) => {
      try { return (await client.getMovies()).map((m) => ({ ...m, instanceId: connection.id })); } catch { return [] as TaggedMovie[]; }
    }))).flat();
    const filtered = all.filter((m) => m.hasFile === true);
    moviePoolCache = { at: now, value: filtered };
    return filtered;
  } catch {
    return [];
  }
}

export async function fetchSeriesPool(): Promise<TaggedSeries[]> {
  const now = Date.now();
  if (seriesPoolCache && now - seriesPoolCache.at < POOL_TTL_MS) {
    return seriesPoolCache.value;
  }
  try {
    const all = (await Promise.all((await getSonarrClients()).map(async ({ connection, client }) => {
      try { return (await client.getSeries()).map((s) => ({ ...s, instanceId: connection.id })); } catch { return [] as TaggedSeries[]; }
    }))).flat();
    const filtered = all.filter((s) => (s.statistics?.episodeFileCount ?? 0) > 0);
    seriesPoolCache = { at: now, value: filtered };
    return filtered;
  } catch {
    return [];
  }
}

export function isEligibleUnwatched(
  watchMap: Awaited<ReturnType<typeof fetchUserWatchStatusMap>>,
  scope: 'radarr' | 'sonarr',
  instanceId: string,
  id: number
): boolean {
  if (!watchMap) return true;
  const status = lookupWatchStatus(watchMap, arrKey(scope, instanceId, id));
  if (!status) return true;
  return !isFullyWatched(status);
}
