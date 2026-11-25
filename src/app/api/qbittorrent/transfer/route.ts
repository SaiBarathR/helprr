import { NextRequest, NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';
import { normalizeTransferInfo } from '@/lib/qbittorrent-summary';
import { qbittorrentInstanceOf } from '@/lib/server/qbittorrent-instance';

async function getHandler(request: NextRequest) {
  const auth = await requireUserCapability('torrents.view');
  if (!auth.ok) return auth.response;
  const instance = await qbittorrentInstanceOf(request);
  if (!instance.ok) return instance.response;
  const startedAt = performance.now();

  try {
    const client = await getQBittorrentClient(instance.instanceId);
    const info = await client.getTransferInfo();
    logApiDuration('/api/qbittorrent/transfer', startedAt, { method: 'GET' });
    // Without qBittorrent's last external addresses (the owner's public IP).
    return NextResponse.json(normalizeTransferInfo(info));
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
