import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient, getRadarrClient, getLidarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { bumpQueueCacheVersion } from '@/lib/activity-queue';
import { runWithOperationAudit } from '@/lib/file-audit';

async function deleteHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUserCapability('activity.manage');
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source') as 'sonarr' | 'radarr' | 'lidarr';
    const instanceId = searchParams.get('instanceId') ?? undefined;
    const removeFromClient = searchParams.get('removeFromClient') === 'true';
    const blocklist = searchParams.get('blocklist') === 'true';
    const changeCategory = searchParams.get('changeCategory') === 'true';
    const skipRedownload = searchParams.get('skipRedownload') === 'true';

    if (!source || !['sonarr', 'radarr', 'lidarr'].includes(source)) {
      return NextResponse.json(
        { error: 'source parameter is required and must be "sonarr", "radarr" or "lidarr"' },
        { status: 400 }
      );
    }

    const queueId = parseInt(id, 10);
    if (isNaN(queueId)) {
      return NextResponse.json(
        { error: 'Invalid queue item ID' },
        { status: 400 }
      );
    }

    const client = source === 'sonarr'
      ? await getSonarrClient(instanceId)
      : source === 'lidarr'
        ? await getLidarrClient(instanceId)
        : await getRadarrClient(instanceId);
    const service = source === 'sonarr' ? 'SONARR' : source === 'lidarr' ? 'LIDARR' : 'RADARR';
    const options = { removeFromClient, blocklist, changeCategory, skipRedownload };
    await runWithOperationAudit({
      user: auth.user,
      service,
      instanceId,
      operation: 'REMOVE_QUEUE',
      targetType: 'queue',
      targetId: queueId,
      targetTitle: `${source === 'sonarr' ? 'Sonarr' : source === 'lidarr' ? 'Lidarr' : 'Radarr'} queue item #${queueId}`,
      itemCount: 1,
      filesDeleted: removeFromClient,
      details: { queueId, source, ...options },
    }, () => client.deleteQueueItem(queueId, options));

    // Bump the queue cache version: every cached page seed and any in-flight
    // load become unreachable, so no refetch can resurrect the removed row.
    await bumpQueueCacheVersion();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete queue item:', error);
    return NextResponse.json(
      { error: 'Failed to delete queue item' },
      { status: 500 }
    );
  }
}

export const DELETE = withApiLogging(deleteHandler, 'api/activity/queue/[id]');
