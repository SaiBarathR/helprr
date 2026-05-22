import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { getRadarrClient, getSonarrClient } from '@/lib/service-helpers';
import type { RadarrMovie, SonarrSeries } from '@/types';

type RandomType = 'movie' | 'series' | 'any';

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

async function fetchMoviePool(): Promise<RadarrMovie[]> {
  try {
    const client = await getRadarrClient();
    const all = await client.getMovies();
    return all.filter((m) => m.hasFile === true);
  } catch {
    return [];
  }
}

async function fetchSeriesPool(): Promise<SonarrSeries[]> {
  try {
    const client = await getSonarrClient();
    const all = await client.getSeries();
    return all.filter((s) => (s.statistics?.episodeFileCount ?? 0) > 0);
  } catch {
    return [];
  }
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  const url = new URL(request.url);
  const type = (url.searchParams.get('type') ?? 'any') as RandomType;

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
