import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient, getRadarrClient, getLidarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

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
      await sonarr.deleteQueueItem(queueId, { removeFromClient, blocklist });
    } else if (source === 'lidarr') {
      const lidarr = await getLidarrClient(instanceId);
      await lidarr.deleteQueueItem(queueId, { removeFromClient, blocklist });
    } else {
      const radarr = await getRadarrClient(instanceId);
      await radarr.deleteQueueItem(queueId, { removeFromClient, blocklist });
    }

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
