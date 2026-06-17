import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClients, getRadarrClients, getLidarrClients } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

const WANTED_CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=60, stale-while-revalidate=120',
  // Partition the private cache by session cookie so a capability-gated response can't be
  // replayed from the browser cache to a different (or logged-out) user within the TTL.
  'Vary': 'Cookie',
} as const;

type WantedType = 'missing' | 'cutoff';
type WantedSource = 'sonarr' | 'radarr' | 'lidarr';
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

type WantedRecord = { id?: number; artistId?: number };

// Server-side filter dimensions. `sources` (empty/undefined = all sources) and
// `instanceId` (undefined = all instances) intersect: a bucket survives only if
// it matches both.
type WantedFilter = { sources?: WantedSource[]; instanceId?: string };

type WantedBucket = {
  source: WantedSource;
  instanceId: string;
  instanceLabel: string;
  fetchPage: WantedFetcher<WantedRecord>;
  tag: (record: WantedRecord) => Record<string, unknown>;
};

// One bucket per connected instance, ordered sonarr → radarr → lidarr, each with
// its own page fetcher + record tagger. Pagination treats the buckets as one
// concatenated list (generalizing the old per-type offset math to N instances).
// The filter narrows which buckets exist (by source set and/or instance), so
// totalRecords and the page slice fall out correctly with no other edits.
async function buildWantedBuckets(type: WantedType, filter: WantedFilter = {}): Promise<WantedBucket[]> {
  const { sources, instanceId } = filter;
  const want = (s: WantedSource) => !sources || sources.length === 0 || sources.includes(s);
  const [sonarrClients, radarrClients, lidarrClients] = await Promise.all([
    want('sonarr') ? getSonarrClients().catch(() => []) : Promise.resolve([]),
    want('radarr') ? getRadarrClients().catch(() => []) : Promise.resolve([]),
    want('lidarr') ? getLidarrClients().catch(() => []) : Promise.resolve([]),
  ]);

  const makeFetch = (client: WantedCapableClient<WantedRecord>): WantedFetcher<WantedRecord> =>
    (page, pageSize) =>
      type === 'cutoff' ? client.getCutoffUnmet(page, pageSize) : client.getWantedMissing(page, pageSize);

  const buckets: WantedBucket[] = [];
  for (const { connection, client } of sonarrClients) {
    buckets.push({
      source: 'sonarr',
      instanceId: connection.id,
      instanceLabel: connection.label,
      fetchPage: makeFetch(client),
      tag: (record) => ({ ...record, source: 'sonarr' as const, mediaType: 'episode' as const, instanceId: connection.id, instanceLabel: connection.label }),
    });
  }
  for (const { connection, client } of radarrClients) {
    buckets.push({
      source: 'radarr',
      instanceId: connection.id,
      instanceLabel: connection.label,
      fetchPage: makeFetch(client),
      tag: (record) => ({ ...record, source: 'radarr' as const, mediaType: 'movie' as const, instanceId: connection.id, instanceLabel: connection.label }),
    });
  }
  for (const { connection, client } of lidarrClients) {
    buckets.push({
      source: 'lidarr',
      instanceId: connection.id,
      instanceLabel: connection.label,
      fetchPage: makeFetch(client),
      tag: (record) => ({ ...record, source: 'lidarr' as const, mediaType: 'album' as const, albumId: record.id, artistId: record.artistId, instanceId: connection.id, instanceLabel: connection.label }),
    });
  }
  return instanceId ? buckets.filter((bucket) => bucket.instanceId === instanceId) : buckets;
}

async function fetchWantedPage(type: WantedType, page: number, pageSize: number, filter: WantedFilter = {}) {
  const safePage = Number.isFinite(page) && page > 0 ? page : 1;
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 20;
  const startIndex = (safePage - 1) * safePageSize;
  const endIndex = startIndex + safePageSize;

  const buckets = await buildWantedBuckets(type, filter);

  // Single bucket (e.g. an instance filter) maps 1:1 to upstream pagination —
  // fetch the requested page directly and reuse its own totalRecords. One
  // upstream call instead of the separate total probe + slice fetch.
  if (buckets.length === 1) {
    const bucket = buckets[0];
    try {
      const upstream = await bucket.fetchPage(safePage, safePageSize);
      return {
        page: safePage,
        pageSize: safePageSize,
        totalRecords: upstream.totalRecords ?? 0,
        records: upstream.records.map(bucket.tag),
      };
    } catch {
      return { page: safePage, pageSize: safePageSize, totalRecords: 0, records: [] };
    }
  }

  const totals = await Promise.all(buckets.map((bucket) => getWantedTotal(bucket.fetchPage)));

  // Carve the global [startIndex, endIndex) window across the concatenated buckets.
  let cumulative = 0;
  const specs = buckets.map((bucket, index) => {
    const total = totals[index];
    const sliceStart = Math.max(0, Math.min(startIndex - cumulative, total));
    const sliceEnd = Math.max(0, Math.min(endIndex - cumulative, total));
    cumulative += total;
    return { bucket, sliceStart, sliceEnd };
  });

  const slices = await Promise.all(
    specs.map(({ bucket, sliceStart, sliceEnd }) =>
      getWantedSlice(bucket.fetchPage, sliceStart, sliceEnd, safePageSize).then((records) => records.map(bucket.tag))
    )
  );

  return {
    page: safePage,
    pageSize: safePageSize,
    totalRecords: totals.reduce((sum, n) => sum + n, 0),
    records: slices.flat(),
  };
}

async function fetchWantedCounts(filter: WantedFilter = {}) {
  const totalFor = async (type: WantedType) => {
    const buckets = await buildWantedBuckets(type, filter);
    const totals = await Promise.all(buckets.map((bucket) => getWantedTotal(bucket.fetchPage)));
    return totals.reduce((sum, n) => sum + n, 0);
  };

  const [missingTotal, cutoffTotal] = await Promise.all([
    totalFor('missing'),
    totalFor('cutoff'),
  ]);

  return { missingTotal, cutoffTotal };
}

/**
 * Fetches either combined wanted counts or a paginated wanted/cutoff-unmet list from Sonarr and Radarr.
 *
 * Supports these query parameters on the request URL:
 * - `type`: optional; when present must be "missing" or "cutoff"
 * - `page`: 1-based page number (default 1)
 * - `pageSize`: number of items per page (default 20)
 * - `sources`: optional CSV of "sonarr"/"radarr"/"lidarr"; restricts results to those
 *   backends (unknown tokens ignored; empty/absent = all). Falls back to the legacy
 *   single `source` param when `sources` is absent.
 * - `instanceId`: optional; restricts results to that connection's instance (absent = all)
 *
 * When `type` is omitted the response contains `{ missingTotal, cutoffTotal }`.
 * When `type` is present the response merges records from both services, adds `source`
 * ("sonarr" | "radarr") and `mediaType` ("episode" | "movie") to each record, and returns
 * the requested page slice.
 *
 * @returns Count totals or a paginated records payload. On failure returns a 500 JSON error object.
 */
async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('activity.view');
  if (capError) return capError;

  try {
    const { searchParams } = new URL(request.url);
    const typeParam = searchParams.get('type');
    const type = typeParam === null ? null : normalizeWantedType(typeParam);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);

    const isWantedSource = (value: string): value is WantedSource =>
      value === 'sonarr' || value === 'radarr' || value === 'lidarr';

    // `sources` (CSV) is the current contract; fall back to the legacy single
    // `source` so a stale client/cache keeps working during rollout.
    const sourcesParam = searchParams.get('sources');
    const legacySource = searchParams.get('source');
    let sources: WantedSource[] | undefined;
    if (sourcesParam !== null) {
      const parsed = sourcesParam.split(',').map((t) => t.trim()).filter(isWantedSource);
      sources = parsed.length > 0 ? parsed : undefined; // empty after validation = all
    } else if (legacySource !== null && isWantedSource(legacySource)) {
      sources = [legacySource];
    }

    const instanceIdParam = searchParams.get('instanceId')?.trim();
    const instanceId = instanceIdParam ? instanceIdParam : undefined;

    const filter: WantedFilter = { sources, instanceId };

    if (typeParam !== null && type === null) {
      return NextResponse.json({ error: 'Unknown wanted type' }, { status: 400 });
    }

    if (!type) {
      return NextResponse.json(await fetchWantedCounts(filter), { headers: WANTED_CACHE_HEADERS });
    }

    const wantedPage = await fetchWantedPage(type, page, pageSize, filter);

    return NextResponse.json({
      page: wantedPage.page,
      pageSize: wantedPage.pageSize,
      totalRecords: wantedPage.totalRecords,
      records: wantedPage.records,
    }, { headers: WANTED_CACHE_HEADERS });
  } catch (error) {
    console.error('Failed to fetch wanted:', error);
    return NextResponse.json(
      { error: 'Failed to fetch wanted' },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler, 'api/activity/wanted');
