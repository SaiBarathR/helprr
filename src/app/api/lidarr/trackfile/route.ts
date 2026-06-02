import { NextRequest, NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const artistIdParam = searchParams.get('artistId');
    const albumIdParam = searchParams.get('albumId');
    if (!artistIdParam && !albumIdParam) {
      return NextResponse.json({ error: 'artistId or albumId is required' }, { status: 400 });
    }
    const params: { artistId?: number; albumId?: number } = {};
    if (albumIdParam) params.albumId = Number(albumIdParam);
    else if (artistIdParam) params.artistId = Number(artistIdParam);

    const client = await getLidarrClient();
    const files = await client.getTrackFiles(params);
    return NextResponse.json(files);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch track files';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/lidarr/trackfile');
