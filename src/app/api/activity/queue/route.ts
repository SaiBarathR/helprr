import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient, getRadarrClient } from '@/lib/service-helpers';
import type { QueueItem } from '@/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '50', 10);

    const [sonarrResult, radarrResult] = await Promise.allSettled([
      (async () => {
        try {
          const sonarr = await getSonarrClient();
          return await sonarr.getQueue(page, pageSize);
        } catch {
          return null;
        }
      })(),
      (async () => {
        try {
          const radarr = await getRadarrClient();
          return await radarr.getQueue(page, pageSize);
        } catch {
          return null;
        }
      })(),
    ]);

    const sonarrData =
      sonarrResult.status === 'fulfilled' && sonarrResult.value
        ? sonarrResult.value
        : { records: [], totalRecords: 0 };

    const radarrData =
      radarrResult.status === 'fulfilled' && radarrResult.value
        ? radarrResult.value
        : { records: [], totalRecords: 0 };

    const sonarrRecords = sonarrData.records.map((record: QueueItem) => ({
      ...record,
      source: 'sonarr' as const,
    }));

    const radarrRecords = radarrData.records.map((record: QueueItem) => ({
      ...record,
      source: 'radarr' as const,
    }));

    const mergedRecords = [...sonarrRecords, ...radarrRecords];
    const totalRecords = sonarrData.totalRecords + radarrData.totalRecords;

    return NextResponse.json({ records: mergedRecords, totalRecords });
  } catch (error) {
    console.error('Failed to fetch queue:', error);
    return NextResponse.json(
      { error: 'Failed to fetch queue' },
      { status: 500 }
    );
  }
}
