import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { can } from '@/lib/permissions';
import { getRadarrClients, getSonarrClients } from '@/lib/service-helpers';
import { fetchUserWatchStatusMap, lookupWatchStatus } from '@/lib/jellyfin-watch-status-map';
import { arrKey, isFullyWatched } from '@/types/watch-status';
import type { RadarrMovie, RandomPick, SonarrSeries } from '@/types';

type RandomType = 'movie' | 'series' | 'any';
const VALID_TYPES: ReadonlySet<RandomType> = new Set(['movie', 'series', 'any']);

type WatchScope = 'all' | 'unwatched';
const VALID_WATCH: ReadonlySet<WatchScope> = new Set(['all', 'unwatched']);

type TaggedMovie = RadarrMovie & { instanceId: string };
type TaggedSeries = SonarrSeries & { instanceId: string };

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

function pickMovie(m: TaggedMovie): RandomPick {
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

function pickSeries(s: TaggedSeries): RandomPick {
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

async function fetchMoviePool(): Promise<TaggedMovie[]> {
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

async function fetchSeriesPool(): Promise<TaggedSeries[]> {
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

function isEligibleUnwatched(
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

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('random.view');
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const raw = url.searchParams.get('type') ?? 'any';
  const type: RandomType = VALID_TYPES.has(raw as RandomType) ? (raw as RandomType) : 'any';

  const rawWatch = url.searchParams.get('watch') ?? 'all';
  let watch: WatchScope = VALID_WATCH.has(rawWatch as WatchScope) ? (rawWatch as WatchScope) : 'all';

  const jellyfinCapable = can(auth.user, 'jellyfin.view');
  let watchMap: Awaited<ReturnType<typeof fetchUserWatchStatusMap>> = null;

  if (watch === 'unwatched') {
    if (!jellyfinCapable) {
      watch = 'all';
    } else {
      try {
        watchMap = await fetchUserWatchStatusMap(auth.user);
      } catch (error) {
        console.error('Random watch: failed to load Jellyfin watch map:', error);
        watch = 'all';
      }
      if (watch === 'unwatched' && !watchMap) {
        watch = 'all';
      }
    }
  }

  const [movies, series] = await Promise.all([
    type === 'series' ? Promise.resolve([] as TaggedMovie[]) : fetchMoviePool(),
    type === 'movie' ? Promise.resolve([] as TaggedSeries[]) : fetchSeriesPool(),
  ]);

  const filteredMovies =
    watch === 'unwatched' && watchMap
      ? movies.filter((m) => isEligibleUnwatched(watchMap, 'radarr', m.instanceId, m.id))
      : movies;
  const filteredSeries =
    watch === 'unwatched' && watchMap
      ? series.filter((s) => isEligibleUnwatched(watchMap, 'sonarr', s.instanceId, s.id))
      : series;

  const pool: RandomPick[] = [...filteredMovies.map(pickMovie), ...filteredSeries.map(pickSeries)];
  if (pool.length === 0) {
    return NextResponse.json({ pick: null, poolSize: 0 });
  }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return NextResponse.json({ pick, poolSize: pool.length });
}

export const GET = withApiLogging(getHandler, 'api/random-watch');
