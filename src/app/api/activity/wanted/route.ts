import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient, getRadarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { parsePositiveIntParam } from '@/lib/request-parsing';

type WantedType = 'missing' | 'cutoff';
type WantedSource = 'sonarr' | 'radarr';
type WantedPageResponse<T> = {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: T[];
};

type WantedFetcher<T> = (page: number, pageSize: number) => Promise<WantedPageResponse<T>>;
type WantedCapableClient<T> = {
  getWantedMissing(page: number, pageSize: number): Promise<WantedPageResponse<T>>;
  getCutoffUnmet(page: number, pageSize: number): Promise<WantedPageResponse<T>>;
};

function normalizeWantedType(value: string | null): WantedType | null {
  return value === 'missing' || value === 'cutoff' ? value : null;
}

async function getWantedTotal<T>(fetchPage: WantedFetcher<T>): Promise<number> {
  try {
    return (await fetchPage(1, 1)).totalRecords ?? 0;
  } catch {
    return 0;
  }
}

async function getWantedSlice<T>(
  fetchPage: WantedFetcher<T>,
  startOffset: number,
  endOffset: number,
  fetchPageSize: number
): Promise<T[]> {
  if (endOffset <= startOffset) return [];

  try {
    const firstPage = Math.floor(startOffset / fetchPageSize) + 1;
    const lastPage = Math.floor((endOffset - 1) / fetchPageSize) + 1;
    const pages = await Promise.all(
      Array.from({ length: lastPage - firstPage + 1 }, (_, index) =>
        fetchPage(firstPage + index, fetchPageSize)
      )
    );
    const combined = pages.flatMap((page) => page.records);
    const trimStart = startOffset % fetchPageSize;
    return combined.slice(trimStart, trimStart + (endOffset - startOffset));
  } catch {
    return [];
  }
}

async function fetchWantedPage(type: WantedType, page: number, pageSize: number, sourceFilter?: WantedSource) {
  const safePage = Number.isFinite(page) && page > 0 ? page : 1;
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 20;
  const startIndex = (safePage - 1) * safePageSize;
  const endIndex = startIndex + safePageSize;

  const [sonarrClient, radarrClient] = await Promise.all([
    sourceFilter === 'radarr' ? Promise.resolve(null) : getSonarrClient().catch(() => null),
    sourceFilter === 'sonarr' ? Promise.resolve(null) : getRadarrClient().catch(() => null),
  ]);

  const sonarrFetchPage = sonarrClient
    ? (nextPage: number, nextPageSize: number) =>
        type === 'cutoff'
          ? sonarrClient.getCutoffUnmet(nextPage, nextPageSize)
          : sonarrClient.getWantedMissing(nextPage, nextPageSize)
    : null;

  const radarrFetchPage = radarrClient
    ? (nextPage: number, nextPageSize: number) =>
        type === 'cutoff'
          ? radarrClient.getCutoffUnmet(nextPage, nextPageSize)
          : radarrClient.getWantedMissing(nextPage, nextPageSize)
    : null;

  const [sonarrTotal, radarrTotal] = await Promise.all([
    sonarrFetchPage ? getWantedTotal(sonarrFetchPage) : Promise.resolve(0),
    radarrFetchPage ? getWantedTotal(radarrFetchPage) : Promise.resolve(0),
  ]);

  const sonarrStart = Math.min(startIndex, sonarrTotal);
  const sonarrEnd = Math.min(endIndex, sonarrTotal);
  const radarrStart = Math.max(0, startIndex - sonarrTotal);
  const radarrEnd = Math.max(0, Math.min(endIndex - sonarrTotal, radarrTotal));

  const [sonarrRecords, radarrRecords] = await Promise.all([
    sonarrFetchPage ? getWantedSlice(sonarrFetchPage, sonarrStart, sonarrEnd, safePageSize) : Promise.resolve([]),
    radarrFetchPage ? getWantedSlice(radarrFetchPage, radarrStart, radarrEnd, safePageSize) : Promise.resolve([]),
  ]);

  return {
    page: safePage,
    pageSize: safePageSize,
    totalRecords: sonarrTotal + radarrTotal,
    records: [
      ...sonarrRecords.map((record) => ({
        ...record,
        source: 'sonarr' as const,
        mediaType: 'episode' as const,
      })),
      ...radarrRecords.map((record) => ({
        ...record,
        source: 'radarr' as const,
        mediaType: 'movie' as const,
      })),
    ],
  };
}

async function fetchWantedCounts(sourceFilter?: WantedSource) {
  const [sonarrClient, radarrClient] = await Promise.all([
    sourceFilter === 'radarr' ? Promise.resolve(null) : getSonarrClient().catch(() => null),
    sourceFilter === 'sonarr' ? Promise.resolve(null) : getRadarrClient().catch(() => null),
  ]);

  const getFetcher = <T,>(client: WantedCapableClient<T> | null, type: WantedType): WantedFetcher<T> | null => {
    if (!client) return null;
    return (page, pageSize) =>
      type === 'cutoff'
        ? client.getCutoffUnmet(page, pageSize)
        : client.getWantedMissing(page, pageSize);
  };

  const [missingResult, cutoffResult] = await Promise.all([
    (() => {
      const sonarrFetcher = getFetcher(sonarrClient, 'missing');
      const radarrFetcher = getFetcher(radarrClient, 'missing');
      return Promise.all([
        sonarrFetcher ? getWantedTotal(sonarrFetcher) : Promise.resolve(0),
        radarrFetcher ? getWantedTotal(radarrFetcher) : Promise.resolve(0),
      ]).then(([sonarrResult, radarrResult]) => sonarrResult + radarrResult);
    })(),
    (() => {
      const sonarrFetcher = getFetcher(sonarrClient, 'cutoff');
      const radarrFetcher = getFetcher(radarrClient, 'cutoff');
      return Promise.all([
        sonarrFetcher ? getWantedTotal(sonarrFetcher) : Promise.resolve(0),
        radarrFetcher ? getWantedTotal(radarrFetcher) : Promise.resolve(0),
      ]).then(([sonarrResult, radarrResult]) => sonarrResult + radarrResult);
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
    const type = typeParam === null ? null : normalizeWantedType(typeParam);
    const page = parsePositiveIntParam(searchParams.get('page'), { defaultValue: 1 });
    const pageSize = parsePositiveIntParam(searchParams.get('pageSize'), { defaultValue: 20, max: 200 });
    const source = searchParams.get('source');
    const sourceFilter = source === 'sonarr' || source === 'radarr' ? source : undefined;

    if (typeParam !== null && type === null) {
      return NextResponse.json({ error: 'Unknown wanted type' }, { status: 400 });
    }

    if (page === null || pageSize === null) {
      return NextResponse.json({ error: 'Invalid pagination params' }, { status: 400 });
    }

    if (!type) {
      return NextResponse.json(await fetchWantedCounts(sourceFilter));
    }

    const wantedPage = await fetchWantedPage(type, page, pageSize, sourceFilter);

    return NextResponse.json({
      page: wantedPage.page,
      pageSize: wantedPage.pageSize,
      totalRecords: wantedPage.totalRecords,
      records: wantedPage.records,
    });
  } catch (error) {
    console.error('Failed to fetch wanted:', error);
    return NextResponse.json(
      { error: 'Failed to fetch wanted' },
      { status: 500 }
    );
  }
}
