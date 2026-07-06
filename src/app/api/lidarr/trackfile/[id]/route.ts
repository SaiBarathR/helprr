import { NextRequest, NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { invalidateTaggedLibrary } from '@/lib/cache/tagged-library';
import { upstreamErrorResponse } from '@/lib/api-error';

async function deleteHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('music.delete');
  if (capError) return capError;

  try {
    const { id } = await params;
    const trackFileId = Number(id);
    if (!Number.isFinite(trackFileId) || trackFileId <= 0) {
      return NextResponse.json({ error: 'Invalid track file id' }, { status: 400 });
    }

    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getLidarrClient(instanceId);
    await client.deleteTrackFile(trackFileId);
    // Deleting a file changes the artist statistics in the cached library list.
    await invalidateTaggedLibrary('lidarr', instanceId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to delete track file');
  }
}

export const DELETE = withApiLogging(deleteHandler, 'api/lidarr/trackfile/[id]');
