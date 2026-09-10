import { NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler() {
  const auth = await requireUserCapability('torrents.view');
  if (!auth.ok) return auth.response;
  const startedAt = performance.now();

  try {
    const client = await getQBittorrentClient();
    const info = await client.getTransferInfo();
    logApiDuration('/api/qbittorrent/transfer', startedAt, { method: 'GET' });
    return NextResponse.json(info);
  } catch (error) {
    console.error('Failed to fetch transfer info:', error);
    logApiDuration('/api/qbittorrent/transfer', startedAt, { method: 'GET', failed: true });
    return NextResponse.json(
      { error: 'Failed to fetch transfer info' },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler, 'api/qbittorrent/transfer');
