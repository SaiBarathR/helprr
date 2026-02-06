import { NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const client = await getRadarrClient();

    let result;
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
        result = await client.renameMovie(body.movieId);
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
