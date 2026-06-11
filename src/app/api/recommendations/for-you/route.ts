import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { getTMDBClient, loadTaggedLibrary } from '@/lib/service-helpers';
import { prisma } from '@/lib/db';
import {
  buildForYou,
  type Seed,
} from '@/lib/recommendations/build-for-you';
import type { ForYouResponse } from '@/lib/recommendations/types';
import type { RadarrMovie, SonarrSeries } from '@/types';
import type { TmdbListItem } from '@/lib/tmdb-client';

const MAX_SEEDS_PER_TYPE = 5;
const DEFAULT_LIMIT = 12;

function parseAddedTime(value: string | undefined): number {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function buildSonarrSeeds(series: SonarrSeries[]): Seed[] {
  const withTmdb = series
    .filter((s): s is SonarrSeries & { tmdbId: number } => typeof s.tmdbId === 'number' && s.tmdbId > 0)
    .sort((a, b) => parseAddedTime(b.added) - parseAddedTime(a.added))
    .slice(0, MAX_SEEDS_PER_TYPE);
  return withTmdb.map((s, index) => ({
    tmdbId: s.tmdbId,
    mediaType: 'tv',
    title: s.title,
    // Recency weight: 1.0 for the newest seed, decaying by 0.1 each step (0.6 for the 5th).
    weight: 1 - index * 0.1,
  }));
}

function buildRadarrSeeds(movies: RadarrMovie[]): Seed[] {
  const withTmdb = movies
    .filter((m): m is RadarrMovie & { tmdbId: number } => typeof m.tmdbId === 'number' && m.tmdbId > 0)
    .sort((a, b) => parseAddedTime(b.added) - parseAddedTime(a.added))
    .slice(0, MAX_SEEDS_PER_TYPE);
  return withTmdb.map((m, index) => ({
    tmdbId: m.tmdbId,
    mediaType: 'movie',
    title: m.title,
    weight: 1 - index * 0.1,
  }));
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 50
    ? Math.floor(limitParam)
    : DEFAULT_LIMIT;

  // Pull library + watchlist in parallel; allow each to fail soft.
  const [libraryResult, watchlistResult] = await Promise.allSettled([
    loadTaggedLibrary(),
    prisma.watchlistItem.findMany({
      // Per-user: only the caller's own watchlist excludes/seeds their recommendations.
      where: { userId: auth.user.id, source: 'TMDB' },
      select: { externalId: true, mediaType: true },
    }),
  ]);

  const series = libraryResult.status === 'fulfilled' ? libraryResult.value.series : [];
  const movies = libraryResult.status === 'fulfilled' ? libraryResult.value.movies : [];
  const watchlistRows = watchlistResult.status === 'fulfilled' ? watchlistResult.value : [];

  const seeds = [...buildSonarrSeeds(series), ...buildRadarrSeeds(movies)];

  if (seeds.length === 0) {
    const payload: ForYouResponse = { items: [], empty: true };
    return NextResponse.json(payload);
  }

  // TMDB-driven library set: titles we already own (and shouldn't recommend).
  // Keyed by `${mediaType}:${tmdbId}` because TMDB movie/TV ids overlap.
  const libraryKeys = new Set<string>();
  for (const s of series) {
    if (typeof s.tmdbId === 'number' && s.tmdbId > 0) libraryKeys.add(`tv:${s.tmdbId}`);
  }
  for (const m of movies) {
    if (typeof m.tmdbId === 'number' && m.tmdbId > 0) libraryKeys.add(`movie:${m.tmdbId}`);
  }

  const watchlistKeys = new Set<string>();
  for (const w of watchlistRows) {
    const id = Number(w.externalId);
    if (!Number.isFinite(id)) continue;
    const mediaType = w.mediaType === 'series' ? 'tv' : 'movie';
    watchlistKeys.add(`${mediaType}:${id}`);
  }

  let tmdb;
  try {
    tmdb = await getTMDBClient();
  } catch {
    const payload: ForYouResponse = { items: [], empty: true };
    return NextResponse.json(payload);
  }

  // Fan out recommendation fetches in parallel; fail-soft per seed so a single
  // 404 (TMDB occasionally rejects very fresh titles) doesn't sink the widget.
  const seedResults = await Promise.allSettled(
    seeds.map(async (seed) => {
      const data = seed.mediaType === 'movie'
        ? await tmdb.movieRecommendations(seed.tmdbId)
        : await tmdb.tvRecommendations(seed.tmdbId);
      return { seed, results: data.results ?? [] };
    }),
  );

  const recommendationsBySeed = new Map<string, TmdbListItem[]>();
  for (const result of seedResults) {
    if (result.status !== 'fulfilled') continue;
    const key = `${result.value.seed.mediaType}:${result.value.seed.tmdbId}`;
    recommendationsBySeed.set(key, result.value.results);
  }

  const items = buildForYou({
    seeds,
    recommendationsBySeed,
    libraryKeys,
    watchlistKeys,
    limit,
  });

  const payload: ForYouResponse = { items, empty: items.length === 0 };
  return NextResponse.json(payload);
}

export const GET = withApiLogging(getHandler, 'api/recommendations/for-you');
