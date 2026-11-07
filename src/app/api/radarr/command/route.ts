import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { checkOwnership, coercePositiveInt, coercePositiveIntArray } from '@/lib/manage-files-guard';
import { can } from '@/lib/permissions';
import { isFilmNotReleased } from '@/lib/film-releases';
import type { RadarrClient } from '@/lib/radarr-client';

const MISSING_PAGE_SIZE = 500;
const MISSING_MAX_PAGES = 20;
// Films per MoviesSearch command: Radarr works through each command's list one
// film at a time, so a long list becomes several commands instead of one huge one.
const SEARCH_BATCH_SIZE = 100;

/**
 * Search every monitored missing film that is out, by id. Radarr's own
 * MissingMoviesSearch runs as a manual search from the API, which skips its
 * availability check and so searches films not released yet too. Films already
 * in the queue are left out, as Radarr's own command does.
 */
async function searchReleasedMissing(client: RadarrClient) {
  const now = Date.now();
  // A film that moves between pages while they are read is counted once.
  const ids = new Set<number>();
  for (let page = 1; page <= MISSING_MAX_PAGES; page++) {
    const { records, totalRecords } = await client.getWantedMissing(page, MISSING_PAGE_SIZE);
    for (const film of records) if (!isFilmNotReleased(film, now)) ids.add(film.id);
    if (records.length < MISSING_PAGE_SIZE || page * MISSING_PAGE_SIZE >= totalRecords) break;
  }
  // Leaving the queued ones out only saves indexer requests: search them anyway if the queue can't be read.
  const queue = await client.getQueue(1, 1000).catch(() => null);
  const queued = new Set(queue?.records.map((item) => item.movieId) ?? []);
  const movieIds = [...ids].filter((id) => !queued.has(id));

  const commands = [];
  for (let i = 0; i < movieIds.length; i += SEARCH_BATCH_SIZE) {
    commands.push(await client.searchMovie(movieIds.slice(i, i + SEARCH_BATCH_SIZE)));
  }
  return { movieCount: movieIds.length, commands };
}

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
    // Renaming moves files on disk, so Organize and per-file rename also need
    // the movie file capability, checked before anything is sent.
    if ((body.name === 'RenameMovie' || body.name === 'RenameFiles') && !can(auth.user, 'movies.manageFiles')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    switch (body.name) {
      case 'MoviesSearch':
        result = await client.searchMovie(body.movieIds);
        break;
      case 'MissingMoviesSearch':
        result = await searchReleasedMissing(client);
        break;
      case 'CutoffUnmetMoviesSearch':
        result = await client.searchWanted('cutoff');
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
      case 'RenameMovie': {
        // Bulk Organize: rename every file of each movie to the naming format.
        const movieIds = coercePositiveIntArray(body.movieIds);
        if (!movieIds) {
          return NextResponse.json(
            { error: 'movieIds must be a non-empty array of positive integers' },
            { status: 400 }
          );
        }
        result = await client.renameMovies(movieIds);
        break;
      }
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
