import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient, getRadarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';

type WantedType = 'missing' | 'cutoff';
type WantedSource = 'sonarr' | 'radarr';

function normalizeWantedType(value: string | null): WantedType | null {
  return value === 'missing' || value === 'cutoff' ? value : null;
}

async function fetchWantedPage(type: WantedType, sourceFilter?: WantedSource) {
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

  return { sonarrData, radarrData };
}

async function fetchWantedCounts(sourceFilter?: WantedSource) {
  const [missingResult, cutoffResult] = await Promise.all([
    (async () => {
      const [sonarrResult, radarrResult] = await Promise.allSettled([
        (async () => {
          if (sourceFilter === 'radarr') return 0;
          try {
            const client = await getSonarrClient();
            return (await client.getWantedMissing(1, 1)).totalRecords;
          } catch {
            return 0;
          }
        })(),
        (async () => {
          if (sourceFilter === 'sonarr') return 0;
          try {
            const client = await getRadarrClient();
            return (await client.getWantedMissing(1, 1)).totalRecords;
          } catch {
            return 0;
          }
        })(),
      ]);

      return (sonarrResult.status === 'fulfilled' ? sonarrResult.value : 0)
        + (radarrResult.status === 'fulfilled' ? radarrResult.value : 0);
    })(),
    (async () => {
      const [sonarrResult, radarrResult] = await Promise.allSettled([
        (async () => {
          if (sourceFilter === 'radarr') return 0;
          try {
            const client = await getSonarrClient();
            return (await client.getCutoffUnmet(1, 1)).totalRecords;
          } catch {
            return 0;
          }
        })(),
        (async () => {
          if (sourceFilter === 'sonarr') return 0;
          try {
            const client = await getRadarrClient();
            return (await client.getCutoffUnmet(1, 1)).totalRecords;
          } catch {
            return 0;
          }
        })(),
      ]);

      return (sonarrResult.status === 'fulfilled' ? sonarrResult.value : 0)
        + (radarrResult.status === 'fulfilled' ? radarrResult.value : 0);
    })(),
  ]);

  return {
    missingTotal: missingResult,
    cutoffTotal: cutoffResult,
  };
}

/**
 * Fetches either combined wanted counts or a paginated wanted/cutoff-unmet list from Sonarr and Radarr.
 *
 * Supports these query parameters on the request URL:
 * - `type`: optional; when present must be "missing" or "cutoff"
 * - `page`: 1-based page number (default 1)
 * - `pageSize`: number of items per page (default 20)
 * - `source`: optional; when set to "sonarr" or "radarr" restricts results to that backend
 *
 * When `type` is omitted the response contains `{ missingTotal, cutoffTotal }`.
 * When `type` is present the response merges records from both services, adds `source`
 * ("sonarr" | "radarr") and `mediaType` ("episode" | "movie") to each record, and returns
 * the requested page slice.
 *
 * @returns Count totals or a paginated records payload. On failure returns a 500 JSON error object.
 */
export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const typeParam = searchParams.get('type');
    const type = typeParam === null ? null : normalizeWantedType(typeParam) ?? 'missing';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const source = searchParams.get('source');
    const sourceFilter = source === 'sonarr' || source === 'radarr' ? source : undefined;

    if (!type) {
      return NextResponse.json(await fetchWantedCounts(sourceFilter));
    }

    const { sonarrData, radarrData } = await fetchWantedPage(type, sourceFilter);

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
