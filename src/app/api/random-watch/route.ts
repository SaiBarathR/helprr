import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { can } from '@/lib/permissions';
import { fetchUserWatchStatusMap } from '@/lib/jellyfin-watch-status-map';
import {
  fetchMoviePool,
  fetchSeriesPool,
  isEligibleUnwatched,
  pickMovie,
  pickSeries,
  type TaggedMovie,
  type TaggedSeries,
} from '@/lib/random-watch-pool';
import type { RandomPick } from '@/types';

type RandomType = 'movie' | 'series' | 'any';
const VALID_TYPES: ReadonlySet<RandomType> = new Set(['movie', 'series', 'any']);

type WatchScope = 'all' | 'unwatched';
const VALID_WATCH: ReadonlySet<WatchScope> = new Set(['all', 'unwatched']);

const RANDOM_RESPONSE_OPTIONS = {
  headers: {
    'Cache-Control': 'private, no-store',
    'Vary': 'Cookie',
  },
} as const;

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
    return NextResponse.json({ pick: null, poolSize: 0 }, RANDOM_RESPONSE_OPTIONS);
  }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return NextResponse.json({ pick, poolSize: pool.length }, RANDOM_RESPONSE_OPTIONS);
}

export const GET = withApiLogging(getHandler, 'api/random-watch');
