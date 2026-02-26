import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import type { RadarrMovie, RadarrMovieListItem } from '@/types';
import { logApiDuration } from '@/lib/server-perf';

function toListItem(movie: RadarrMovie): RadarrMovieListItem {
  return {
    id: movie.id,
    title: movie.title,
    sortTitle: movie.sortTitle,
    originalTitle: movie.originalTitle,
    originalLanguage: movie.originalLanguage,
    sizeOnDisk: movie.sizeOnDisk,
    status: movie.status,
    overview: movie.overview,
    inCinemas: movie.inCinemas,
    physicalRelease: movie.physicalRelease,
    digitalRelease: movie.digitalRelease,
    images: movie.images.filter((img) => img.coverType === 'poster').slice(0, 1),
    year: movie.year,
    hasFile: movie.hasFile,
    path: movie.path,
    qualityProfileId: movie.qualityProfileId,
    monitored: movie.monitored,
    runtime: movie.runtime,
    genres: movie.genres,
    tags: movie.tags,
    added: movie.added,
    ratings: movie.ratings,
    popularity: movie.popularity,
    studio: movie.studio,
    certification: movie.certification,
  };
}

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const startedAt = performance.now();

  try {
    const full = request.nextUrl.searchParams.get('full') === 'true';
    const client = await getRadarrClient();
    const movies = await client.getMovies();
    logApiDuration('/api/radarr', startedAt, {
      method: 'GET',
      full,
      movieCount: movies.length,
    });
    if (full) return NextResponse.json(movies);
    return NextResponse.json(movies.map(toListItem));
  } catch (error) {
    logApiDuration('/api/radarr', startedAt, { method: 'GET', failed: true });
    const message = error instanceof Error ? error.message : 'Failed to fetch movies';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authError = await requireAuth();
  if (authError) return authError;
  const startedAt = performance.now();

  try {
    const body = await request.json();
    const client = await getRadarrClient();
    const result = await client.addMovie(body);
    logApiDuration('/api/radarr', startedAt, { method: 'POST' });
    return NextResponse.json(result);
  } catch (error) {
    logApiDuration('/api/radarr', startedAt, { method: 'POST', failed: true });
    const message = error instanceof Error ? error.message : 'Failed to add movie';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
