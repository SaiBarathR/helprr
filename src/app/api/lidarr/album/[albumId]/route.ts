import { NextRequest, NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ albumId: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('music.view');
  if (capError) return capError;

  try {
    const { albumId } = await params;
    const id = Number(albumId);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid album id' }, { status: 400 });
    }
    const client = await getLidarrClient();
    const album = await client.getAlbumById(id);
    return NextResponse.json(album);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch album';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function putHandler(
  request: NextRequest,
  { params }: { params: Promise<{ albumId: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;
  // Album PUT is used to toggle monitoring / pick the release; gate on monitoring.
  const capError = await requireCapability('music.editMonitoring');
  if (capError) return capError;

  try {
    const { albumId } = await params;
    const pathId = Number(albumId);
    if (!Number.isInteger(pathId) || pathId <= 0) {
      return NextResponse.json({ error: 'Invalid album id' }, { status: 400 });
    }
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }
    if ('id' in body && Number((body as { id?: unknown }).id) !== pathId) {
      return NextResponse.json({ error: 'Path id and body id must match' }, { status: 400 });
    }
    const client = await getLidarrClient();
    const result = await client.updateAlbum(body);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update album';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/lidarr/album/[albumId]');
export const PUT = withApiLogging(putHandler, 'api/lidarr/album/[albumId]');
