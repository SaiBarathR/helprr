import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient, getRadarrClient, getLidarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { deleteCachedJson } from '@/lib/cache/json-cache';
import { QUEUE_CACHE_SCOPE, QUEUE_DEFAULT_PAGE, QUEUE_DEFAULT_PAGE_SIZE, queueCacheSeed } from '@/lib/activity-queue';

async function deleteHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('activity.manage');
  if (capError) return capError;

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

    if (source === 'sonarr') {
      const sonarr = await getSonarrClient(instanceId);
      await sonarr.deleteQueueItem(queueId, { removeFromClient, blocklist, changeCategory, skipRedownload });
    } else if (source === 'lidarr') {
      const lidarr = await getLidarrClient(instanceId);
      await lidarr.deleteQueueItem(queueId, { removeFromClient, blocklist, changeCategory, skipRedownload });
    } else {
      const radarr = await getRadarrClient(instanceId);
      await radarr.deleteQueueItem(queueId, { removeFromClient, blocklist, changeCategory, skipRedownload });
    }

    // Bust the queue cache (the default page the activity page reads) so the
    // client's reconcile refetch can't resurrect the removed row for the TTL.
    await deleteCachedJson(QUEUE_CACHE_SCOPE, queueCacheSeed(QUEUE_DEFAULT_PAGE, QUEUE_DEFAULT_PAGE_SIZE));

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
