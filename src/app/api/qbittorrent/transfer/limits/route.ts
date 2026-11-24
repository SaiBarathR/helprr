import { NextRequest, NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';
import { bumpQbitCacheVersion } from '@/lib/cache/qbittorrent-version';
import { upstreamErrorResponse } from '@/lib/api-error';
import type { SpeedLimitPreference, SpeedLimits } from '@/lib/qbittorrent-client';

// Each limit action names the one qBittorrent preference it may write, so the
// request body is never forwarded: setPreferences also takes the Web UI
// password and the program run on completion.
const LIMIT_ACTIONS = new Map<unknown, SpeedLimitPreference>([
  ['setDownloadLimit', 'dl_limit'],
  ['setUploadLimit', 'up_limit'],
  ['setAltDownloadLimit', 'alt_dl_limit'],
  ['setAltUploadLimit', 'alt_up_limit'],
]);

// Bytes per second; 0 is unlimited. qBittorrent keeps a limit in a 32-bit int.
const MAX_LIMIT = 2_147_483_647;

function parseLimit(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_LIMIT ? value : null;
}

async function getHandler() {
  const auth = await requireUserCapability('torrents.view');
  if (!auth.ok) return auth.response;
  const startedAt = performance.now();

  try {
    const client = await getQBittorrentClient();
    const [limits, speedLimitsMode] = await Promise.all([
      client.getSpeedLimits(),
      client.getSpeedLimitsMode(),
    ]);

    logApiDuration('/api/qbittorrent/transfer/limits', startedAt, { method: 'GET' });
    return NextResponse.json({
      downloadLimit: limits.dl_limit,
      uploadLimit: limits.up_limit,
      altDownloadLimit: limits.alt_dl_limit,
      altUploadLimit: limits.alt_up_limit,
      speedLimitsMode,
    });
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
  const auth = await requireUserCapability('torrents.bandwidth');
  if (!auth.ok) return auth.response;
  const startedAt = performance.now();

  let body: { action?: unknown; limit?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const action = body?.action;
  const preference = LIMIT_ACTIONS.get(action);
  let update: Partial<SpeedLimits> | null = null;
  if (preference) {
    const limit = parseLimit(body?.limit);
    if (limit === null) {
      return NextResponse.json({ error: 'Limit must be a whole number of bytes per second, 0 for unlimited' }, { status: 400 });
    }
    update = { [preference]: limit };
  } else if (action !== 'toggleSpeedLimitsMode') {
    logApiDuration('/api/qbittorrent/transfer/limits', startedAt, { method: 'POST', action, invalidAction: true });
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  try {
    const client = await getQBittorrentClient();
    if (update) {
      await client.setSpeedLimits(update);
    } else {
      await client.toggleSpeedLimitsMode();
    }

    // Bust the summary cache so the client's reconcile refetch sees the new mode/limits.
    await bumpQbitCacheVersion();
    logApiDuration('/api/qbittorrent/transfer/limits', startedAt, { method: 'POST', action });
    return NextResponse.json({ success: true });
  } catch (error) {
    logApiDuration('/api/qbittorrent/transfer/limits', startedAt, { method: 'POST', failed: true });
    return upstreamErrorResponse(error, 'Failed');
  }
}

export const GET = withApiLogging(getHandler, 'api/qbittorrent/transfer/limits');
export const POST = withApiLogging(postHandler, 'api/qbittorrent/transfer/limits');
