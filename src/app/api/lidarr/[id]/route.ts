import { NextRequest, NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability, getCurrentUser } from '@/lib/auth';
import { diffArtistEdit, guardLibraryEdit } from '@/lib/library-edit-guard';
import { withApiLogging } from '@/lib/api-logger';

function parsePositiveId(id: string): { value: number } | { error: NextResponse } {
  const parsed = Number(id);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { error: NextResponse.json({ error: 'Invalid artist id' }, { status: 400 }) };
  }
  return { value: parsed };
}

async function getHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const parsed = parsePositiveId(id);
    if ('error' in parsed) return parsed.error;
    const client = await getLidarrClient();
    const artist = await client.getArtistById(parsed.value);
    return NextResponse.json(artist);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch artist';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function putHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const parsed = parsePositiveId(id);
    if ('error' in parsed) return parsed.error;
    const pathId = parsed.value;
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }
    if ('id' in body && Number((body as { id?: unknown }).id) !== pathId) {
      return NextResponse.json({ error: 'Path id and body id must match' }, { status: 400 });
    }
    const moveFiles = new URL(request.url).searchParams.get('moveFiles') === 'true';
    const client = await getLidarrClient();

    // Admins edit freely; members are diffed against the live artist and 403'd for
    // changing monitoring / tags / root folder without the matching capability.
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') {
      const current = await client.getArtistById(pathId);
      const guardError = await guardLibraryEdit(diffArtistEdit(current, body), {
        tags: 'music.editTags',
        path: 'music.changePath',
        monitoring: 'music.editMonitoring',
      });
      if (guardError) return guardError;
    }

    const result = await client.updateArtist(body, moveFiles);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update artist';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

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
    const parsed = parsePositiveId(id);
    if ('error' in parsed) return parsed.error;
    const { searchParams } = new URL(request.url);
    const deleteFiles = searchParams.get('deleteFiles') === 'true';
    const client = await getLidarrClient();
    await client.deleteArtist(parsed.value, deleteFiles);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete artist';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/lidarr/[id]');
export const PUT = withApiLogging(putHandler, 'api/lidarr/[id]');
export const DELETE = withApiLogging(deleteHandler, 'api/lidarr/[id]');
