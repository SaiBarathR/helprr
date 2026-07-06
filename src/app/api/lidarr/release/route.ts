import { NextRequest, NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

function toPositiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

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

    const params: { albumId?: number; artistId?: number } = {};
    if (albumId) {
      const parsed = toPositiveInt(albumId);
      if (parsed === null) {
        return NextResponse.json({ error: 'albumId must be a positive integer' }, { status: 400 });
      }
      params.albumId = parsed;
    } else {
      const parsed = toPositiveInt(artistId);
      if (parsed === null) {
        return NextResponse.json({ error: 'artistId must be a positive integer' }, { status: 400 });
      }
      params.artistId = parsed;
    }

    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getLidarrClient(instanceId);
    const releases = await client.getReleases(params);
    return NextResponse.json(releases);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to search releases');
  }
}

async function postHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('activity.manage');
  if (capError) return capError;

  try {
    const body = await request.json();
    const { guid, indexerId, downloadClientId } = body;

    if (!guid || typeof guid !== 'string') {
      return NextResponse.json({ error: 'guid is required' }, { status: 400 });
    }
    const parsedIndexerId = toPositiveInt(indexerId);
    if (parsedIndexerId === null) {
      return NextResponse.json({ error: 'indexerId must be a positive integer' }, { status: 400 });
    }

    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getLidarrClient(instanceId);
    await client.grabRelease(guid, parsedIndexerId, downloadClientId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to grab release');
  }
}

export const GET = withApiLogging(getHandler, 'api/lidarr/release');
export const POST = withApiLogging(postHandler, 'api/lidarr/release');
