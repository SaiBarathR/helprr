import { NextRequest, NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';
import { bumpQbitCacheVersion } from '@/lib/cache/qbittorrent-version';

async function getHandler() {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('torrents.view');
  if (capError) return capError;
  const startedAt = performance.now();

  try {
    const client = await getQBittorrentClient();
    const [downloadLimit, uploadLimit, speedLimitsMode] = await Promise.all([
      client.getGlobalDownloadLimit(),
      client.getGlobalUploadLimit(),
      client.getSpeedLimitsMode(),
    ]);

    logApiDuration('/api/qbittorrent/transfer/limits', startedAt, { method: 'GET' });
    return NextResponse.json({ downloadLimit, uploadLimit, speedLimitsMode });
  } catch (error) {
    console.error('Failed to fetch transfer limits:', error);
    logApiDuration('/api/qbittorrent/transfer/limits', startedAt, { method: 'GET', failed: true });
    return NextResponse.json(
      { error: 'Failed to fetch transfer limits' },
      { status: 500 }
    );
  }
}

async function postHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('torrents.bandwidth');
  if (capError) return capError;
  const startedAt = performance.now();

  try {
    const client = await getQBittorrentClient();
    const body = await request.json();
    const { action, limit } = body;

    switch (action) {
      case 'setDownloadLimit':
        await client.setGlobalDownloadLimit(limit ?? 0);
        break;
      case 'setUploadLimit':
        await client.setGlobalUploadLimit(limit ?? 0);
        break;
      case 'toggleSpeedLimitsMode':
        await client.toggleSpeedLimitsMode();
        break;
      default:
        logApiDuration('/api/qbittorrent/transfer/limits', startedAt, { method: 'POST', action, invalidAction: true });
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    // Bust the summary cache so the client's reconcile refetch sees the new mode/limits.
    await bumpQbitCacheVersion();
    logApiDuration('/api/qbittorrent/transfer/limits', startedAt, { method: 'POST', action });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to set transfer limits:', error);
    logApiDuration('/api/qbittorrent/transfer/limits', startedAt, { method: 'POST', failed: true });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler, 'api/qbittorrent/transfer/limits');
export const POST = withApiLogging(postHandler, 'api/qbittorrent/transfer/limits');
