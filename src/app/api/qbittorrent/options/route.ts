import { NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';

/** What the torrent settings pages offer: qBittorrent's tags, and whether its queueing is on. */
async function getHandler() {
  const auth = await requireUserCapability('torrents.view');
  if (!auth.ok) return auth.response;
  const startedAt = performance.now();

  try {
    const client = await getQBittorrentClient();
    const [tags, queueingEnabled] = await Promise.all([client.getTags(), client.isQueueingEnabled()]);
    logApiDuration('/api/qbittorrent/options', startedAt, { method: 'GET' });
    return NextResponse.json({ tags, queueingEnabled });
  } catch (error) {
    console.error('Failed to fetch qBittorrent options:', error);
    logApiDuration('/api/qbittorrent/options', startedAt, { method: 'GET', failed: true });
    return NextResponse.json({ error: 'Failed to fetch qBittorrent options' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/qbittorrent/options');
