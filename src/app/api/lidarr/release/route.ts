import { NextRequest, NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('activity.manage');
  if (capError) return capError;

  try {
    const { searchParams } = new URL(request.url);
    const albumId = searchParams.get('albumId');
    const artistId = searchParams.get('artistId');

    if (!albumId && !artistId) {
      return NextResponse.json({ error: 'albumId or artistId is required' }, { status: 400 });
    }

    const client = await getLidarrClient();
    const params: { albumId?: number; artistId?: number } = {};
    if (albumId) params.albumId = Number(albumId);
    else params.artistId = Number(artistId);

    const releases = await client.getReleases(params);
    return NextResponse.json(releases);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to search releases';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function postHandler(request: Request) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('activity.manage');
  if (capError) return capError;

  try {
    const body = await request.json();
    const { guid, indexerId, downloadClientId } = body;

    if (!guid || indexerId === undefined) {
      return NextResponse.json({ error: 'guid and indexerId are required' }, { status: 400 });
    }

    const client = await getLidarrClient();
    await client.grabRelease(guid, indexerId, downloadClientId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to grab release';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/lidarr/release');
export const POST = withApiLogging(postHandler, 'api/lidarr/release');
