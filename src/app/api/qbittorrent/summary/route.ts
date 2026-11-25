import { etagJson } from '@/lib/etag-json';
import { matchesTorrentFilter, projectTorrentsForSummary, sumTransferInfo, torrentCounters } from '@/lib/qbittorrent-summary';
import { NextRequest, NextResponse } from 'next/server';
import { getQBittorrentClient, getQBittorrentClients } from '@/lib/service-helpers';
import { qbittorrentInstanceParam } from '@/lib/server/qbittorrent-instance';
import type { QBittorrentClient } from '@/lib/qbittorrent-client';
import { requireUserCapability } from '@/lib/auth';
import type { QBittorrentSummaryResponse } from '@/types';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';
import { getQbitCacheVersion } from '@/lib/cache/qbittorrent-version';
import { torrentDeltaHistory } from '@/lib/cache/qbittorrent-delta';
import { QBITTORRENT_SYNC_MAX_AGE_MS, qbittorrentSyncFor, speedLimitsModeFrom, transferInfoFrom } from '@/lib/qbittorrent-sync';
import type { TorrentsFilterPreference } from '@/lib/store';

// The summary is identical for every authorized user, and every open torrents
// page polls it every ~5s: it is built from the one merged sync/maindata state
// (src/lib/qbittorrent-sync.ts), read again at most once per 2 s window however
// many tabs poll, and only as what changed. The version stamp is bumped on
// mutations and forces a fresh read, so the client's fast post-action reconcile
// never reads a pre-action snapshot.
// no-cache (not max-age): a browser HTTP cache can't be busted by the version
// bump, so it would happily serve a pre-action body to the reconcile refetch.
const SUMMARY_CACHE_HEADERS = {
  'Cache-Control': 'private, no-cache',
  'Vary': 'Cookie',
} as const;

async function loadSummary(client: QBittorrentClient, version: number, filter?: string): Promise<QBittorrentSummaryResponse> {
  const { torrents, serverState } = await qbittorrentSyncFor(client).read(QBITTORRENT_SYNC_MAX_AGE_MS, version);
  // Field by field: the merged rows carry the magnet and tracker URL, and
  // server_state the last external IPv4 and IPv6 address (the owner's public IP).
  const projected = projectTorrentsForSummary(torrents);
  // The page's own filter, so the slimmed list is exactly what the page shows
  // for that filter (it filters again on its side).
  const rows = filter ? projected.filter((torrent) => matchesTorrentFilter(torrent, filter as TorrentsFilterPreference)) : projected;
  return {
    torrents: rows,
    transferInfo: transferInfoFrom(serverState),
    speedLimitsMode: speedLimitsModeFrom(serverState),
  };
}

async function getHandler(request: NextRequest) {
  const auth = await requireUserCapability('torrents.view');
  if (!auth.ok) return auth.response;

  const startedAt = performance.now();

  try {
    const { searchParams } = new URL(request.url);
    // The one parameter the page sends (with one status filter picked). The
    // list is no longer sorted or narrowed by category upstream: the page does
    // both itself.
    const filter = searchParams.get('filter') || undefined;
    const view = searchParams.get('view');

    // The dashboard's totals: every qBittorrent's counters and speeds added
    // up. One that doesn't answer is left out, unless none answers.
    if (view === 'counters' && searchParams.get('instanceId') === 'all') {
      const instances = await getQBittorrentClients();
      const read = await Promise.allSettled(instances.map(async ({ client }) => loadSummary(client, await getQbitCacheVersion(client.instanceId))));
      const payloads = read.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
      if (payloads.length === 0) {
        if (instances.length === 0) await getQBittorrentClient(); // throws "not configured"
        throw read.find((result) => result.status === 'rejected')?.reason ?? new Error('No qBittorrent answered');
      }
      const torrents = payloads.flatMap((payload) => payload.torrents);
      logApiDuration('/api/qbittorrent/summary', startedAt, { torrentCount: torrents.length, filter: 'all', instances: payloads.length });
      return etagJson(request, {
        ...torrentCounters(torrents),
        transferInfo: sumTransferInfo(payloads.flatMap((payload) => (payload.transferInfo ? [payload.transferInfo] : []))),
        // Alternative speed mode is per qBittorrent: "on" only when all are.
        speedLimitsMode: payloads.every((payload) => payload.speedLimitsMode === 1) ? 1 : 0,
      }, SUMMARY_CACHE_HEADERS);
    }

    const instance = await qbittorrentInstanceParam(searchParams.get('instanceId'));
    if (!instance.ok) return instance.response;
    const client = await getQBittorrentClient(instance.instanceId);
    const version = await getQbitCacheVersion(client.instanceId);
    const seed = JSON.stringify([version, filter ?? '']);
    const payload = await loadSummary(client, version, filter);

    logApiDuration('/api/qbittorrent/summary', startedAt, {
      torrentCount: payload.torrents.length,
      filter: filter || 'all',
    });

    if (view === 'delta') {
      // A cursor is for one user, filter, version and qBittorrent.
      const scope = JSON.stringify([auth.user.id, client.instanceId ?? '', seed]);
      return etagJson(request, torrentDeltaHistory.response(scope, searchParams.get('cursor') || undefined, payload), SUMMARY_CACHE_HEADERS);
    }
    return etagJson(request, view === 'counters' ? { ...torrentCounters(payload.torrents), transferInfo: payload.transferInfo, speedLimitsMode: payload.speedLimitsMode } : payload, SUMMARY_CACHE_HEADERS);
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
