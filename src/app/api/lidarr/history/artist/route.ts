import { NextRequest, NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('music.view');
  if (capError) return capError;

  try {
    const { searchParams } = new URL(request.url);
    const artistId = Number(searchParams.get('artistId'));
    if (!Number.isFinite(artistId) || artistId <= 0) {
      return NextResponse.json({ error: 'artistId is required' }, { status: 400 });
    }
    const albumIdParam = searchParams.get('albumId');
    let albumId: number | undefined;
    if (albumIdParam) {
      const parsed = Number(albumIdParam);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return NextResponse.json({ error: 'albumId must be a positive integer' }, { status: 400 });
      }
      albumId = parsed;
    }
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getLidarrClient(instanceId);
    const history = await client.getArtistHistory(artistId, albumId);
    return NextResponse.json(history);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch artist history';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/lidarr/history/artist');
