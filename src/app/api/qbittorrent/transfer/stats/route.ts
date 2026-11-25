import { NextRequest, NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';
import { getQbitCacheVersion } from '@/lib/cache/qbittorrent-version';
import { QBITTORRENT_SYNC_MAX_AGE_MS, qbittorrentSyncFor, serverStatsFrom } from '@/lib/qbittorrent-sync';
import { qbittorrentInstanceOf } from '@/lib/server/qbittorrent-instance';

// The stats are in sync/maindata's server_state, which the torrents summary
// and the poll keep merged (src/lib/qbittorrent-sync.ts): reading them costs
// at most one small incremental read per window, shared with every open page.
async function getHandler(request: NextRequest) {
  const auth = await requireUserCapability('torrents.view');
  if (!auth.ok) return auth.response;
  const instance = await qbittorrentInstanceOf(request);
  if (!instance.ok) return instance.response;
  const startedAt = performance.now();

  try {
    const client = await getQBittorrentClient(instance.instanceId);
    // Bumped by every torrent action, so a delete's freed space shows on the next read.
    const { serverState } = await qbittorrentSyncFor(client).read(QBITTORRENT_SYNC_MAX_AGE_MS, await getQbitCacheVersion(client.instanceId));
    const stats = serverStatsFrom(serverState);
    logApiDuration('/api/qbittorrent/transfer/stats', startedAt, { method: 'GET' });
    return NextResponse.json(stats);
  } catch (error) {
    console.error('Failed to fetch qBittorrent stats:', error);
    logApiDuration('/api/qbittorrent/transfer/stats', startedAt, { method: 'GET', failed: true });
    return NextResponse.json({ error: 'Failed to fetch qBittorrent stats' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/qbittorrent/transfer/stats');
