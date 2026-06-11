import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

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
    switch (body.name) {
      case 'EpisodeSearch':
        result = await client.searchEpisode(body.episodeIds);
        break;
      case 'SeasonSearch':
        result = await client.searchSeason(body.seriesId, body.seasonNumber);
        break;
      case 'SeriesSearch':
        result = await client.searchSeries(body.seriesId);
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
    const message = error instanceof Error ? error.message : 'Failed to execute command';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withApiLogging(postHandler, 'api/sonarr/command');
