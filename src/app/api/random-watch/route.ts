import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { getRadarrClient, getSonarrClient } from '@/lib/service-helpers';
import type { RadarrMovie, SonarrSeries } from '@/types';

type RandomType = 'movie' | 'series' | 'any';
const VALID_TYPES: ReadonlySet<RandomType> = new Set(['movie', 'series', 'any']);

interface RandomPick {
  mediaType: 'movie' | 'series';
  id: number;
  title: string;
  year: number | null;
  overview: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  runtime: number | null;
  genres: string[];
  href: string;
  rating: number | null;
}

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

function pickMovie(m: RadarrMovie): RandomPick {
  return {
    mediaType: 'movie',
    id: m.id,
    title: m.title,
    year: m.year ?? null,
    overview: m.overview ?? null,
    posterUrl: imageOf(m.images, 'poster'),
    backdropUrl: imageOf(m.images, 'fanart') ?? imageOf(m.images, 'banner'),
    runtime: m.runtime ?? null,
    genres: m.genres ?? [],
    href: `/movies/${m.id}`,
    rating: ratingOf(m),
  };
}

function pickSeries(s: SonarrSeries): RandomPick {
  const rating = s.ratings?.value ?? null;
  return {
    mediaType: 'series',
    id: s.id,
    title: s.title,
    year: s.year ?? null,
    overview: s.overview ?? null,
    posterUrl: imageOf(s.images, 'poster'),
    backdropUrl: imageOf(s.images, 'fanart') ?? imageOf(s.images, 'banner'),
    runtime: s.runtime ?? null,
    genres: s.genres ?? [],
    href: `/series/${s.id}`,
    rating: rating ?? null,
  };
}

// Module-scope pool cache. Helprr is single-instance today; the cache lives
// per-process. If that ever changes (multi-replica deploy), move this behind
// Redis or accept the per-process cost.
const POOL_TTL_MS = 5 * 60 * 1000;
let moviePoolCache: { at: number; value: RadarrMovie[] } | null = null;
let seriesPoolCache: { at: number; value: SonarrSeries[] } | null = null;

async function fetchMoviePool(): Promise<RadarrMovie[]> {
  const now = Date.now();
  if (moviePoolCache && now - moviePoolCache.at < POOL_TTL_MS) {
    return moviePoolCache.value;
  }
  try {
    const client = await getRadarrClient();
    const all = await client.getMovies();
    const filtered = all.filter((m) => m.hasFile === true);
    moviePoolCache = { at: now, value: filtered };
    return filtered;
  } catch {
    return [];
  }
}

async function fetchSeriesPool(): Promise<SonarrSeries[]> {
  const now = Date.now();
  if (seriesPoolCache && now - seriesPoolCache.at < POOL_TTL_MS) {
    return seriesPoolCache.value;
  }
  try {
    const client = await getSonarrClient();
    const all = await client.getSeries();
    const filtered = all.filter((s) => (s.statistics?.episodeFileCount ?? 0) > 0);
    seriesPoolCache = { at: now, value: filtered };
    return filtered;
  } catch {
    return [];
  }
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('random.view');
  if (capError) return capError;

  const url = new URL(request.url);
  const raw = url.searchParams.get('type') ?? 'any';
  const type: RandomType = VALID_TYPES.has(raw as RandomType) ? (raw as RandomType) : 'any';

  const [movies, series] = await Promise.all([
    type === 'series' ? Promise.resolve([] as RadarrMovie[]) : fetchMoviePool(),
    type === 'movie' ? Promise.resolve([] as SonarrSeries[]) : fetchSeriesPool(),
  ]);

  const pool: RandomPick[] = [...movies.map(pickMovie), ...series.map(pickSeries)];
  if (pool.length === 0) {
    return NextResponse.json({ pick: null, poolSize: 0 });
  }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return NextResponse.json({ pick, poolSize: pool.length });
}

export const GET = withApiLogging(getHandler, 'api/random-watch');
