import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient, getRadarrClient } from '@/lib/service-helpers';
import type { HistoryItem } from '@/types';

/**
 * Retrieve merged and optionally filtered history records from Sonarr and Radarr and return a paginated JSON response.
 *
 * Accepts the following query parameters on the provided request URL:
 * - `page` (default 1) — 1-based page number.
 * - `pageSize` (default 50) — number of records per page.
 * - `sortKey` (default "date") — field to sort by.
 * - `sortDirection` (default "descending") — "ascending" or "descending".
 * - `eventType` — if provided, only records with this eventType are returned.
 * - `episodeId`, `seriesId`, `movieId` — numeric IDs used to narrow the fetch to relevant records.
 * - `source` — "sonarr" or "radarr" to restrict fetching to a single service.
 *
 * @param request - NextRequest whose URL search params control filtering, sorting, and pagination.
 * @returns An object with `page`, `pageSize`, `totalRecords`, and `records` (the page of merged history items).
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '50', 10);
    const sortKey = searchParams.get('sortKey') || 'date';
    const sortDirection = searchParams.get('sortDirection') || 'descending';
    const eventType = searchParams.get('eventType') || undefined;
    const episodeId = searchParams.get('episodeId') ? parseInt(searchParams.get('episodeId')!, 10) : undefined;
    const seriesId = searchParams.get('seriesId') ? parseInt(searchParams.get('seriesId')!, 10) : undefined;
    const movieId = searchParams.get('movieId') ? parseInt(searchParams.get('movieId')!, 10) : undefined;
    const source = searchParams.get('source');
    const sourceFilter = source === 'sonarr' || source === 'radarr' ? source : undefined;

    // Fetch large batches from both services so we can merge and re-sort
    const fetchSize = 500;

    const [sonarrResult, radarrResult] = await Promise.allSettled([
      (async () => {
        if (sourceFilter === 'radarr') return null;
        // Skip Sonarr fetch if filtering by movieId only
        if (movieId && !episodeId && !seriesId) return null;
        try {
          const sonarr = await getSonarrClient();
          return await sonarr.getHistory(1, fetchSize, sortKey, sortDirection, { episodeId, seriesId });
        } catch {
          return null;
        }
      })(),
      (async () => {
        if (sourceFilter === 'sonarr') return null;
        // Skip Radarr fetch if filtering by episodeId/seriesId only
        if ((episodeId || seriesId) && !movieId) return null;
        try {
          const radarr = await getRadarrClient();
          return await radarr.getHistory(1, fetchSize, sortKey, sortDirection, { movieId });
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