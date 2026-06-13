import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient, getRadarrClients } from '@/lib/service-helpers';
import { resolveConnection } from '@/lib/arr-instances';
import { RadarrClient } from '@/lib/radarr-client';
import { requireAuth, requireCapability } from '@/lib/auth';
import type { RadarrMovie, RadarrMovieListItem } from '@/types';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';
import { getCachedTaggedLibrary } from '@/lib/cache/tagged-library';

const RADARR_CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=120, stale-while-revalidate=300',
  // Partition the private cache by session cookie so a capability-gated response can't be
  // replayed from the browser cache to a different (or logged-out) user within the TTL.
  'Vary': 'Cookie',
} as const;

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
    const cacheKeySeed = instanceId ?? 'all';

    // Cache the raw tagged library (full objects) so both ?full=true and the slim list
    // view are served from one entry. Authorized callers all get identical bytes (binary
    // capability gate), so no per-user filtering is needed after the read.
    const { items: tagged, cached } = await getCachedTaggedLibrary({
      scope: 'radarr',
      cacheKeySeed,
      getInstances: () =>
        instanceId
          ? resolveConnection('RADARR', instanceId).then((conn) => [
              { connection: conn, client: new RadarrClient(conn.url, conn.apiKey) },
            ])
          : getRadarrClients(),
      fetchOne: (client) => client.getMovies(),
    });

    logApiDuration('/api/radarr', startedAt, {
      method: 'GET',
      full,
      movieCount: tagged.length,
      cached: !!cached,
    });
    if (full) return NextResponse.json(tagged, { headers: RADARR_CACHE_HEADERS });
    return NextResponse.json(
      tagged.map((m) => ({ ...toListItem(m), instanceId: m.instanceId, instanceLabel: m.instanceLabel })),
      { headers: RADARR_CACHE_HEADERS }
    );
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
