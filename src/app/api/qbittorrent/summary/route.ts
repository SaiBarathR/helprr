import { NextRequest, NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import type { QBittorrentSummaryResponse } from '@/types';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';
import { getCachedJson, setCachedJson } from '@/lib/cache/json-cache';
import { getQbitCacheVersion } from '@/lib/cache/qbittorrent-version';

// The summary is identical for every authorized user, and every open torrents
// page polls it every ~5s — a tiny cache window + in-flight dedupe collapses
// that multi-client fan-out into one upstream hit per window (mirrors
// api/activity/queue). The version stamp in the seed is bumped on mutations so
// the client's fast post-action reconcile never reads a pre-action snapshot.
const SUMMARY_CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=2',
  'Vary': 'Cookie',
} as const;
const SUMMARY_CACHE_SCOPE = 'qbittorrent-summary';
const SUMMARY_CACHE_TTL_SECONDS = 2;

const inflightSummary = new Map<string, Promise<QBittorrentSummaryResponse>>();

async function loadSummary(
  filter?: string,
  category?: string,
  sort?: string,
  reverse?: boolean,
): Promise<QBittorrentSummaryResponse> {
  const client = await getQBittorrentClient();
  const [torrents, transferInfo, speedLimitsMode] = await Promise.all([
    client.getTorrents(filter, category, sort, reverse),
    client.getTransferInfo().catch(() => null),
    client.getSpeedLimitsMode().catch(() => 0),
  ]);
  return { torrents, transferInfo, speedLimitsMode };
}

async function getSummaryCached(
  seed: string,
  filter?: string,
  category?: string,
  sort?: string,
  reverse?: boolean,
): Promise<{ payload: QBittorrentSummaryResponse; cached: boolean }> {
  const cached = await getCachedJson<QBittorrentSummaryResponse>(SUMMARY_CACHE_SCOPE, seed);
  if (cached) return { payload: cached, cached: true };

  // Collapse concurrent identical requests into one upstream fan-out.
  const existing = inflightSummary.get(seed);
  if (existing) return { payload: await existing, cached: false };

  const promise = (async () => {
    const result = await loadSummary(filter, category, sort, reverse);
    // Only cache a complete snapshot; a null transferInfo means one upstream
    // call failed and shouldn't be served to every client for the whole TTL.
    if (result.transferInfo !== null) {
      await setCachedJson(SUMMARY_CACHE_SCOPE, seed, result, SUMMARY_CACHE_TTL_SECONDS);
    }
    return result;
  })().finally(() => inflightSummary.delete(seed));
  inflightSummary.set(seed, promise);
  return { payload: await promise, cached: false };
}

async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('torrents.view');
  if (capError) return capError;

  const startedAt = performance.now();

  try {
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter') || undefined;
    const category = searchParams.get('category') || undefined;
    const sort = searchParams.get('sort') || undefined;
    const reverse = searchParams.get('reverse') === 'true' ? true : undefined;

    const version = await getQbitCacheVersion();
    const seed = `${version}:${filter ?? ''}:${category ?? ''}:${sort ?? ''}:${reverse ? '1' : '0'}`;
    const { payload, cached } = await getSummaryCached(seed, filter, category, sort, reverse);

    logApiDuration('/api/qbittorrent/summary', startedAt, {
      torrentCount: payload.torrents.length,
      filter: filter || 'all',
      cached,
    });

    return NextResponse.json(payload, { headers: SUMMARY_CACHE_HEADERS });
  } catch (error) {
    console.error('Failed to fetch qBittorrent summary:', error);
    logApiDuration('/api/qbittorrent/summary', startedAt, { failed: true });
    return NextResponse.json(
      { error: 'Failed to fetch qBittorrent summary' },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler, 'api/qbittorrent/summary');
