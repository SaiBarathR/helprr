import { NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function postHandler(request: Request) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const body = await request.json();
    const client = await getSonarrClient();

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
