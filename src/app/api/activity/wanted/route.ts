import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient, getRadarrClient } from '@/lib/service-helpers';

/**
 * Fetches and returns combined wanted or cutoff-unmet records from Sonarr and Radarr, with optional source filtering and pagination.
 *
 * Supports these query parameters on the request URL:
 * - `type`: "missing" (default) or "cutoff"
 * - `page`: 1-based page number (default 1)
 * - `pageSize`: number of items per page (default 20)
 * - `source`: optional; when set to "sonarr" or "radarr" restricts results to that backend
 *
 * The response merges records from both services, adds `source` ("sonarr" | "radarr") and `mediaType` ("episode" | "movie") to each record, and returns the requested page slice.
 *
 * @returns A JSON object with `page`, `pageSize`, `totalRecords`, and `records` (the paginated merged records). On failure returns a 500 JSON error object.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'missing'; // 'missing' | 'cutoff'
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const source = searchParams.get('source');
    const sourceFilter = source === 'sonarr' || source === 'radarr' ? source : undefined;

    const [sonarrResult, radarrResult] = await Promise.allSettled([
      (async () => {
        if (sourceFilter === 'radarr') return null;
        try {
          const client = await getSonarrClient();
          return type === 'cutoff'
            ? await client.getCutoffUnmet(1, 500)
            : await client.getWantedMissing(1, 500);
        } catch {
          return null;
        }
      })(),
      (async () => {
        if (sourceFilter === 'sonarr') return null;
        try {
          const client = await getRadarrClient();
          return type === 'cutoff'
            ? await client.getCutoffUnmet(1, 500)
            : await client.getWantedMissing(1, 500);
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

    const sonarrRecords = sonarrData.records.map((record) => ({
      ...record,
      source: 'sonarr' as const,
      mediaType: 'episode' as const,
    }));

    const radarrRecords = radarrData.records.map((record) => ({
      ...record,
      source: 'radarr' as const,
      mediaType: 'movie' as const,
    }));

    const mergedRecords = [...sonarrRecords, ...radarrRecords];
    const totalRecords = mergedRecords.length;

    // Manual pagination
    const startIndex = (page - 1) * pageSize;
    const paginatedRecords = mergedRecords.slice(startIndex, startIndex + pageSize);

    return NextResponse.json({
      page,
      pageSize,
      totalRecords,
      records: paginatedRecords,
    });
  } catch (error) {
    console.error('Failed to fetch wanted:', error);
    return NextResponse.json(
      { error: 'Failed to fetch wanted' },
      { status: 500 }
    );
  }
}