import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient, getRadarrClient } from '@/lib/service-helpers';
import type { HistoryItem } from '@/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '50', 10);
    const sortKey = searchParams.get('sortKey') || 'date';
    const sortDirection = searchParams.get('sortDirection') || 'descending';
    const eventType = searchParams.get('eventType') || undefined;

    // Fetch large batches from both services so we can merge and re-sort
    const fetchSize = 500;

    const [sonarrResult, radarrResult] = await Promise.allSettled([
      (async () => {
        try {
          const sonarr = await getSonarrClient();
          return await sonarr.getHistory(1, fetchSize, sortKey, sortDirection);
        } catch {
          return null;
        }
      })(),
      (async () => {
        try {
          const radarr = await getRadarrClient();
          return await radarr.getHistory(1, fetchSize, sortKey, sortDirection);
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

    const sonarrRecords = sonarrData.records.map((record: HistoryItem) => ({
      ...record,
      source: 'sonarr' as const,
    }));

    const radarrRecords = radarrData.records.map((record: HistoryItem) => ({
      ...record,
      source: 'radarr' as const,
    }));

    let mergedRecords = [...sonarrRecords, ...radarrRecords];

    // Sort by date descending
    mergedRecords.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return sortDirection === 'descending' ? dateB - dateA : dateA - dateB;
    });

    // Apply eventType filter if provided
    if (eventType) {
      mergedRecords = mergedRecords.filter(
        (record) => record.eventType === eventType
      );
    }

    const totalRecords = mergedRecords.length;

    // Manual pagination on the merged result
    const startIndex = (page - 1) * pageSize;
    const paginatedRecords = mergedRecords.slice(startIndex, startIndex + pageSize);

    return NextResponse.json({
      page,
      pageSize,
      totalRecords,
      records: paginatedRecords,
    });
  } catch (error) {
    console.error('Failed to fetch history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch history' },
      { status: 500 }
    );
  }
}
