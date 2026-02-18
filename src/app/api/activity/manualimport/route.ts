import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient, getRadarrClient } from '@/lib/service-helpers';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const downloadId = searchParams.get('downloadId');
    const source = searchParams.get('source') as 'sonarr' | 'radarr';

    if (!downloadId) {
      return NextResponse.json(
        { error: 'downloadId is required' },
        { status: 400 }
      );
    }

    if (!source || !['sonarr', 'radarr'].includes(source)) {
      return NextResponse.json(
        { error: 'source parameter is required and must be "sonarr" or "radarr"' },
        { status: 400 }
      );
    }

    if (source === 'sonarr') {
      const sonarr = await getSonarrClient();
      const result = await sonarr.getManualImport(downloadId);
      return NextResponse.json(result);
    } else {
      const radarr = await getRadarrClient();
      const result = await radarr.getManualImport(downloadId);
      return NextResponse.json(result);
    }
  } catch (error) {
    console.error('Failed to get manual import:', error);
    return NextResponse.json(
      { error: 'Failed to get manual import data' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { source, files } = body;

    if (!source || !['sonarr', 'radarr'].includes(source)) {
      return NextResponse.json(
        { error: 'source is required and must be "sonarr" or "radarr"' },
        { status: 400 }
      );
    }

    if (!files || !Array.isArray(files)) {
      return NextResponse.json(
        { error: 'files array is required' },
        { status: 400 }
      );
    }

    if (source === 'sonarr') {
      const sonarr = await getSonarrClient();
      const result = await sonarr.submitManualImport(files);
      return NextResponse.json(result);
    } else {
      const radarr = await getRadarrClient();
      const result = await radarr.submitManualImport(files);
      return NextResponse.json(result);
    }
  } catch (error) {
    console.error('Failed to submit manual import:', error);
    return NextResponse.json(
      { error: 'Failed to submit manual import' },
      { status: 500 }
    );
  }
}
