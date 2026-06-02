import { NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function putHandler(request: Request) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('music.editMonitoring');
  if (capError) return capError;

  try {
    const body = await request.json();
    const { albumIds, monitored } = body;

    if (!Array.isArray(albumIds) || typeof monitored !== 'boolean') {
      return NextResponse.json(
        { error: 'Missing albumIds or monitored field' },
        { status: 400 }
      );
    }

    const client = await getLidarrClient();
    await client.setAlbumsMonitored(albumIds.map(Number), monitored);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update album monitoring';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const PUT = withApiLogging(putHandler, 'api/lidarr/album/monitor');
