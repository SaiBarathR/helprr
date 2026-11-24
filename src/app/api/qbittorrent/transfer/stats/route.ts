import { NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';
import { getCachedJson, setCachedJson } from '@/lib/cache/json-cache';
import { getQbitCacheVersion } from '@/lib/cache/qbittorrent-version';
import type { QBittorrentServerStats } from '@/types';

// The stats come from a full sync/maindata, which lists every torrent: on a
// large library that is megabytes per read. They change slowly and are the same
// for every user, so one read serves every open settings page for a while.
const STATS_CACHE_SCOPE = 'qbittorrent-server-stats';
const STATS_CACHE_TTL_SECONDS = 15;

const inflight = new Map<string, Promise<QBittorrentServerStats>>();

async function loadStats(seed: string): Promise<{ stats: QBittorrentServerStats; cached: boolean }> {
  const cached = await getCachedJson<QBittorrentServerStats>(STATS_CACHE_SCOPE, seed);
  if (cached) return { stats: cached, cached: true };

  const existing = inflight.get(seed);
  if (existing) return { stats: await existing, cached: false };

  const promise = (async () => {
    const client = await getQBittorrentClient();
    const stats = await client.getServerStats();
    await setCachedJson(STATS_CACHE_SCOPE, seed, stats, STATS_CACHE_TTL_SECONDS);
    return stats;
  })().finally(() => inflight.delete(seed));
  inflight.set(seed, promise);
  return { stats: await promise, cached: false };
}

async function getHandler() {
  const auth = await requireUserCapability('torrents.view');
  if (!auth.ok) return auth.response;
  const startedAt = performance.now();

  try {
    // Bumped by every torrent action, so a delete's freed space shows on the next read.
    const { stats, cached } = await loadStats(String(await getQbitCacheVersion()));
    logApiDuration('/api/qbittorrent/transfer/stats', startedAt, { method: 'GET', cached });
    return NextResponse.json(stats);
  } catch (error) {
    console.error('Failed to fetch qBittorrent stats:', error);
    logApiDuration('/api/qbittorrent/transfer/stats', startedAt, { method: 'GET', failed: true });
    return NextResponse.json({ error: 'Failed to fetch qBittorrent stats' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/qbittorrent/transfer/stats');
