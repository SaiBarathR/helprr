import { NextRequest, NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(
  request: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const auth = await requireUserCapability('torrents.view');
  if (!auth.ok) return auth.response;
  const startedAt = performance.now();

  try {
    const { hash } = await params;
    const client = await getQBittorrentClient();

    const [properties, files, trackers] = await Promise.all([
      client.getTorrentProperties(hash, request.signal),
      client.getTorrentFiles(hash, request.signal),
      client.getTorrentTrackers(hash, request.signal),
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
