import { NextRequest, NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const artistId = Number(searchParams.get('artistId'));
    if (!Number.isFinite(artistId) || artistId <= 0) {
      return NextResponse.json({ error: 'artistId is required' }, { status: 400 });
    }
    const albumIdParam = searchParams.get('albumId');
    const albumId = albumIdParam ? Number(albumIdParam) : undefined;
    const client = await getLidarrClient();
    const history = await client.getArtistHistory(artistId, albumId);
    return NextResponse.json(history);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch artist history';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/lidarr/history/artist');
