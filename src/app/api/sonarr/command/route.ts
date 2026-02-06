import { NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';

export async function POST(request: Request) {
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
