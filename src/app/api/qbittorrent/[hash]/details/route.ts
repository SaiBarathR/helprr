import { NextRequest, NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('torrents.view');
  if (capError) return capError;
  const startedAt = performance.now();

  try {
    const { hash } = await params;
    const client = await getQBittorrentClient();

    const [properties, files, trackers] = await Promise.all([
      client.getTorrentProperties(hash),
      client.getTorrentFiles(hash),
      client.getTorrentTrackers(hash),
    ]);

    logApiDuration('/api/qbittorrent/[hash]/details', startedAt, {
      method: 'GET',
      fileCount: files.length,
      trackerCount: trackers.length,
    });
    return NextResponse.json({ properties, files, trackers });
  } catch (error) {
    logApiDuration('/api/qbittorrent/[hash]/details', startedAt, { method: 'GET', failed: true });
    return upstreamErrorResponse(error, 'Failed to fetch torrent details');
  }
}

export const GET = withApiLogging(getHandler, 'api/qbittorrent/[hash]/details');
