import { NextRequest, NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

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
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete track file';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const DELETE = withApiLogging(deleteHandler, 'api/lidarr/trackfile/[id]');
