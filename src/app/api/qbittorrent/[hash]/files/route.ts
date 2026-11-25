import { NextRequest, NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { qbittorrentInstanceOf } from '@/lib/server/qbittorrent-instance';
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
  const instance = await qbittorrentInstanceOf(request);
  if (!instance.ok) return instance.response;
  const startedAt = performance.now();

  try {
    const { hash } = await params;
    const client = await getQBittorrentClient(instance.instanceId);
    const files = await client.getTorrentFiles(hash);

    logApiDuration('/api/qbittorrent/[hash]/files', startedAt, {
      method: 'GET',
      fileCount: files.length,
    });
    return NextResponse.json({ files });
  } catch (error) {
    logApiDuration('/api/qbittorrent/[hash]/files', startedAt, { method: 'GET', failed: true });
    return upstreamErrorResponse(error, 'Failed to fetch torrent files');
  }
}

export const GET = withApiLogging(getHandler, 'api/qbittorrent/[hash]/files');
