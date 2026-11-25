import { NextRequest, NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { qbittorrentInstanceOf } from '@/lib/server/qbittorrent-instance';
import { requireAdmin, requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { bumpQbitCacheVersion } from '@/lib/cache/qbittorrent-version';
import { recordSettingsUpdated } from '@/lib/security-audit';
import { QUEUE_SEEDING_KEYS, parseQueueSeedingPatch } from '@/lib/qbittorrent-queue-seeding';

// qBittorrent's queueing and global seeding limits (QBT-25). Everyone who sees
// torrents may read them (they explain why a torrent is queued or stopped);
// only admins change them, as they apply to every torrent on the server.
async function getHandler(request: NextRequest) {
  const auth = await requireUserCapability('torrents.view');
  if (!auth.ok) return auth.response;
  const instance = await qbittorrentInstanceOf(request);
  if (!instance.ok) return instance.response;
  try {
    const client = await getQBittorrentClient(instance.instanceId);
    const preferences = await client.getQueueSeedingPreferences();
    // Rebuilt from the allow-list here too, whatever the client handed back.
    return NextResponse.json(Object.fromEntries(QUEUE_SEEDING_KEYS.map((key) => [key, preferences[key]])));
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch qBittorrent queueing and seeding settings');
  }
}

async function patchHandler(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const instance = await qbittorrentInstanceOf(request);
  if (!instance.ok) return instance.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = parseQueueSeedingPatch(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  let client;
  try {
    client = await getQBittorrentClient(instance.instanceId);
    await client.setQueueSeedingPreferences(parsed.patch);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to update qBittorrent queueing and seeding settings');
  }
  // Queue positions and stopped torrents show in the list.
  await bumpQbitCacheVersion(client.instanceId);
  await recordSettingsUpdated(request, auth.user, 'qBittorrent queueing and seeding', Object.keys(parsed.patch));
  return NextResponse.json({ success: true });
}

export const GET = withApiLogging(getHandler, 'api/qbittorrent/queue-seeding');
export const PATCH = withApiLogging(patchHandler, 'api/qbittorrent/queue-seeding');
