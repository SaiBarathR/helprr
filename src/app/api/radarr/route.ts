import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import type { RadarrMovie, RadarrMovieListItem } from '@/types';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';

function toListItem(movie: RadarrMovie): RadarrMovieListItem {
  const poster = movie.images.find((img) => img.coverType === 'poster');
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
    images: poster ? [poster] : [],
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

async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('movies.view');
  if (capError) return capError;
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

async function postHandler(request: Request) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('movies.add');
  if (capError) return capError;
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

export const GET = withApiLogging(getHandler, 'api/radarr');
export const POST = withApiLogging(postHandler, 'api/radarr');
