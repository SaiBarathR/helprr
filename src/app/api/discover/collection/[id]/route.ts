import { NextRequest, NextResponse } from 'next/server';
import { getTMDBClient, getRadarrClient, getSonarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { normalizeTmdbItem, annotateDiscoverItems, tmdbImageUrl } from '@/lib/discover';
import { TmdbRateLimitError } from '@/lib/tmdb-client';
import type { DiscoverCollectionDetail, DiscoverItem, RadarrMovie, SonarrSeries } from '@/types';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid collection ID' }, { status: 400 });
    }

    const tmdb = await getTMDBClient();

    const [collection, movies, series] = await Promise.all([
      tmdb.collectionDetails(id),
      (async () => {
        try {
          const client = await getRadarrClient();
          return await client.getMovies();
        } catch {
          return [] as RadarrMovie[];
        }
      })(),
      (async () => {
        try {
          const client = await getSonarrClient();
          return await client.getSeries();
        } catch {
          return [] as SonarrSeries[];
        }
      })(),
    ]);

    const parts: DiscoverItem[] = (collection.parts || [])
      .sort((a, b) => {
        const dateA = a.release_date || '';
        const dateB = b.release_date || '';
        return dateA.localeCompare(dateB);
      })
      .map((item) => normalizeTmdbItem(item, 'movie'))
      .filter((item): item is DiscoverItem => item !== null);

    const annotatedParts = annotateDiscoverItems(parts, movies, series);

    const payload: DiscoverCollectionDetail = {
      id: collection.id,
      name: collection.name,
      overview: collection.overview || '',
      posterPath: tmdbImageUrl(collection.poster_path),
      backdropPath: tmdbImageUrl(collection.backdrop_path, 'w1280'),
      parts: annotatedParts,
    };

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof TmdbRateLimitError) {
      return NextResponse.json(
        {
          error: 'TMDB rate limit reached',
          code: 'TMDB_RATE_LIMIT',
          retryAfterSeconds: error.retryAfterSeconds,
          retryAt: error.retryAt,
        },
        { status: 429 }
      );
    }
    const message = error instanceof Error ? error.message : 'Failed to load collection';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
