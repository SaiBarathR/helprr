import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const client = await getRadarrClient();
    const movie = await client.getMovieById(Number(id));
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

  try {
    const { id } = await params;
    const pathId = Number(id);
    if (!Number.isInteger(pathId) || pathId <= 0) {
      return NextResponse.json({ error: 'Invalid movie id' }, { status: 400 });
    }
    const body = await request.json();
    if (body && typeof body === 'object' && 'id' in body && Number(body.id) !== pathId) {
      return NextResponse.json(
        { error: 'Path id and body id must match' },
        { status: 400 }
      );
    }
    const moveFiles = new URL(request.url).searchParams.get('moveFiles') === 'true';
    const client = await getRadarrClient();
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

  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const deleteFiles = searchParams.get('deleteFiles') === 'true';
    const client = await getRadarrClient();
    await client.deleteMovie(Number(id), deleteFiles);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete movie';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/radarr/[id]');
export const PUT = withApiLogging(putHandler, 'api/radarr/[id]');
export const DELETE = withApiLogging(deleteHandler, 'api/radarr/[id]');
