import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability, getCurrentUser } from '@/lib/auth';
import { diffMovieEdit, guardLibraryEdit } from '@/lib/library-edit-guard';
import { withApiLogging } from '@/lib/api-logger';

function parsePositiveId(id: string): { value: number } | { error: NextResponse } {
  const parsed = Number(id);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { error: NextResponse.json({ error: 'Invalid movie id' }, { status: 400 }) };
  }
  return { value: parsed };
}

async function getHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('movies.view');
  if (capError) return capError;

  try {
    const { id } = await params;
    const parsed = parsePositiveId(id);
    if ('error' in parsed) return parsed.error;
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getRadarrClient(instanceId);
    const movie = await client.getMovieById(parsed.value);
    return NextResponse.json(movie);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch movie';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function putHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('movies.view');
  if (capError) return capError;

  try {
    const { id } = await params;
    const parsed = parsePositiveId(id);
    if ('error' in parsed) return parsed.error;
    const pathId = parsed.value;
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }
    if ('id' in body && Number(body.id) !== pathId) {
      return NextResponse.json(
        { error: 'Path id and body id must match' },
        { status: 400 }
      );
    }
    const moveFiles = new URL(request.url).searchParams.get('moveFiles') === 'true';
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getRadarrClient(instanceId);

    // Admins edit freely; only members are diffed against the live movie and 403'd
    // for changing monitoring / tags / root folder without the matching capability.
    // Skipping the fetch for admins avoids an extra upstream round-trip and keeps a
    // transient detail-fetch error from failing an otherwise-valid admin edit.
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') {
      const current = await client.getMovieById(pathId);
      const guardError = await guardLibraryEdit(diffMovieEdit(current, body), {
        tags: 'movies.editTags',
        path: 'movies.changePath',
        monitoring: 'movies.editMonitoring',
      });
      if (guardError) return guardError;
    }

    const result = await client.updateMovie(body, moveFiles);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update movie';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function deleteHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('movies.delete');
  if (capError) return capError;

  try {
    const { id } = await params;
    const parsed = parsePositiveId(id);
    if ('error' in parsed) return parsed.error;
    const { searchParams } = new URL(request.url);
    const deleteFiles = searchParams.get('deleteFiles') === 'true';
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getRadarrClient(instanceId);
    await client.deleteMovie(parsed.value, deleteFiles);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete movie';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/radarr/[id]');
export const PUT = withApiLogging(putHandler, 'api/radarr/[id]');
export const DELETE = withApiLogging(deleteHandler, 'api/radarr/[id]');
