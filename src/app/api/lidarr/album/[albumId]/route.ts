import { NextRequest, NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { invalidateTaggedLibrary } from '@/lib/cache/tagged-library';

async function getHandler(
  request: NextRequest,
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
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getLidarrClient(instanceId);
    const album = await client.getAlbumById(id);
    return NextResponse.json(album);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch album');
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
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getLidarrClient(instanceId);
    const result = await client.updateAlbum(body);
    return NextResponse.json(result);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to update album');
  }
}

async function deleteHandler(
  request: NextRequest,
  { params }: { params: Promise<{ albumId: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('music.delete');
  if (capError) return capError;

  try {
    const { albumId } = await params;
    const id = Number(albumId);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid album id' }, { status: 400 });
    }
    const deleteFiles = request.nextUrl.searchParams.get('deleteFiles') === 'true';
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getLidarrClient(instanceId);
    await client.deleteAlbum(id, deleteFiles);
    await invalidateTaggedLibrary('lidarr', instanceId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to delete album');
  }
}

export const GET = withApiLogging(getHandler, 'api/lidarr/album/[albumId]');
export const PUT = withApiLogging(putHandler, 'api/lidarr/album/[albumId]');
export const DELETE = withApiLogging(deleteHandler, 'api/lidarr/album/[albumId]');
