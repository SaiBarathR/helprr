import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient, getRadarrClients } from '@/lib/service-helpers';
import { resolveConnection } from '@/lib/arr-instances';
import { RadarrClient } from '@/lib/radarr-client';
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
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;

    const instances = instanceId
      ? await (async () => {
          const conn = await resolveConnection('RADARR', instanceId);
          return [{ connection: conn, client: new RadarrClient(conn.url, conn.apiKey) }];
        })()
      : await getRadarrClients();

    const tagged = (await Promise.all(
      instances.map(async ({ connection, client }) => {
        try {
          const movies = await client.getMovies();
          return movies.map((m) => ({ ...m, instanceId: connection.id, instanceLabel: connection.label }));
        } catch {
          // One unreachable/misconfigured instance must not blank the whole library.
          return [];
        }
      })
    )).flat();

    logApiDuration('/api/radarr', startedAt, {
      method: 'GET',
      full,
      movieCount: tagged.length,
    });
    if (full) return NextResponse.json(tagged);
    return NextResponse.json(tagged.map((m) => ({ ...toListItem(m), instanceId: m.instanceId, instanceLabel: m.instanceLabel })));
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
    const instanceId = typeof body.instanceId === 'string' ? body.instanceId : undefined;
    const client = await getRadarrClient(instanceId);
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
