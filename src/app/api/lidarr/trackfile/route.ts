import { NextRequest, NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

function isPositiveIntParam(value: string): boolean {
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}

async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('music.view');
  if (capError) return capError;

  try {
    const { searchParams } = new URL(request.url);
    const artistIdParam = searchParams.get('artistId');
    const albumIdParam = searchParams.get('albumId');
    if (!artistIdParam && !albumIdParam) {
      return NextResponse.json({ error: 'artistId or albumId is required' }, { status: 400 });
    }
    const params: { artistId?: number; albumId?: number } = {};
    if (albumIdParam) {
      if (!isPositiveIntParam(albumIdParam)) {
        return NextResponse.json({ error: 'albumId must be a positive integer' }, { status: 400 });
      }
      params.albumId = Number(albumIdParam);
    } else if (artistIdParam) {
      if (!isPositiveIntParam(artistIdParam)) {
        return NextResponse.json({ error: 'artistId must be a positive integer' }, { status: 400 });
      }
      params.artistId = Number(artistIdParam);
    }

    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getLidarrClient(instanceId);
    const files = await client.getTrackFiles(params);
    return NextResponse.json(files);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch track files';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/lidarr/trackfile');
