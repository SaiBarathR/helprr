import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { checkOwnership, coercePositiveInt, coercePositiveIntArray } from '@/lib/manage-files-guard';

async function postHandler(request: NextRequest) {
  const auth = await requireUserCapability('activity.manage');
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getRadarrClient(instanceId);

    let result;
    // Data-mutating commands routed here must also be listed in MUTATING_COMMANDS
    // (lib/cache/tagged-library.ts), or their completion won't drop the Redis caches.
    // ManualImport is deliberately not one of them: it moves whatever path it is
    // handed, so imports go through the routes that check the paths and write the
    // audit row (/api/activity/manualimport and /api/radarr/manualimport/import).
    switch (body.name) {
      case 'MoviesSearch':
        result = await client.searchMovie(body.movieIds);
        break;
      case 'RefreshMovie':
        result = await client.refreshMovie(body.movieId);
        break;
      case 'RefreshMonitoredDownloads':
        result = await client.refreshMonitoredDownloads();
        break;
      case 'RenameFiles':
        if (Array.isArray(body.files)) {
          if (body.files.length === 0) {
            return NextResponse.json(
              { error: 'files must be a non-empty array' },
              { status: 400 }
            );
          }
          const movieId = coercePositiveInt(body.movieId);
          const files = coercePositiveIntArray(body.files);
          if (!movieId || !files) {
            return NextResponse.json(
              { error: 'movieId and files must be positive integers' },
              { status: 400 }
            );
          }
          // Radarr renames whatever file ids it is handed, under the movie it
          // is handed: it does not check that they belong together.
          const owned = checkOwnership(files, await client.getMovieFiles(movieId));
          if (!owned.ok) {
            return NextResponse.json(
              { error: `Movie file id(s) not in movie ${movieId}: ${owned.missing.join(', ')}` },
              { status: 400 }
            );
          }
          result = await client.renameMovieFiles(movieId, files);
        } else {
          result = await client.renameMovie(body.movieId);
        }
        break;
      default:
        return NextResponse.json(
          { error: `Unknown command: ${body.name}` },
          { status: 400 }
        );
    }

    return NextResponse.json(result);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to execute command');
  }
}

export const POST = withApiLogging(postHandler, 'api/radarr/command');
