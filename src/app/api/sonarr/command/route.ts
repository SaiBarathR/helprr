import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function postHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  // Commands (search / refresh / rename / manual import) are activity-management
  // actions; members are read-only here.
  const capError = await requireCapability('activity.manage');
  if (capError) return capError;

  try {
    const body = await request.json();
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getSonarrClient(instanceId);

    let result;
    // Data-mutating commands routed here must also be listed in MUTATING_COMMANDS
    // (lib/cache/tagged-library.ts), or their completion won't drop the Redis caches.
    switch (body.name) {
      case 'EpisodeSearch':
        result = await client.searchEpisode(body.episodeIds);
        break;
      case 'SeasonSearch':
        result = await client.searchSeason(body.seriesId, body.seasonNumber);
        break;
      case 'SeriesSearch':
        // Sonarr has no multi-series search command, so a bulk request fans out
        // one SeriesSearch per id; single-id callers keep the legacy `seriesId`.
        if (Array.isArray(body.seriesIds)) {
          const seriesIds: unknown[] = body.seriesIds;
          if (seriesIds.length === 0 || !seriesIds.every((x) => Number.isInteger(x) && (x as number) > 0)) {
            return NextResponse.json(
              { error: 'seriesIds must be a non-empty array of positive integers' },
              { status: 400 }
            );
          }
          // Fan out in bounded batches so selecting a large library doesn't fire
          // hundreds of concurrent searches at the Sonarr instance at once.
          const ids = seriesIds as number[];
          let ok = 0;
          let fail = 0;
          for (let i = 0; i < ids.length; i += 5) {
            const batch = ids.slice(i, i + 5);
            const settled = await Promise.allSettled(batch.map((id) => client.searchSeries(id)));
            for (const outcome of settled) {
              if (outcome.status === 'fulfilled') ok++;
              else fail++;
            }
          }
          result = { ok, fail };
        } else {
          if (!Number.isInteger(body.seriesId) || (body.seriesId as number) <= 0) {
            return NextResponse.json(
              { error: 'seriesId must be a positive integer' },
              { status: 400 }
            );
          }
          result = await client.searchSeries(body.seriesId as number);
        }
        break;
      case 'RefreshSeries':
        result = await client.refreshSeries(body.seriesId);
        break;
      case 'RefreshMonitoredDownloads':
        result = await client.refreshMonitoredDownloads();
        break;
      case 'RenameSeries':
        result = await client.renameSeries(body.seriesId);
        break;
      case 'RenameFiles':
        if (!Array.isArray(body.files) || body.files.length === 0) {
          return NextResponse.json(
            { error: 'files must be a non-empty array' },
            { status: 400 }
          );
        }
        result = await client.renameFiles(body.seriesId, body.files);
        break;
      case 'ManualImport':
        result = await client.submitManualImport(body.files);
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

export const POST = withApiLogging(postHandler, 'api/sonarr/command');
