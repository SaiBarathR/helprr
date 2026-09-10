import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { diffMovieEdit, type LibraryEditCaps, type LibraryEditDiff } from '@/lib/library-edit-guard';
import { can, type PermissionUser } from '@/lib/permissions';
import type { Capability } from '@/lib/capabilities';
import { invalidateTaggedLibrary } from '@/lib/cache/tagged-library';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { runWithOperationAudit } from '@/lib/file-audit';

function parsePositiveId(id: string): { value: number } | { error: NextResponse } {
  const parsed = Number(id);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { error: NextResponse.json({ error: 'Invalid movie id' }, { status: 400 }) };
  }
  return { value: parsed };
}

function guardResolvedLibraryEdit(
  user: PermissionUser,
  diff: LibraryEditDiff,
  caps: LibraryEditCaps
): NextResponse | null {
  if (!diff.tags && !diff.path && !diff.monitoring && !diff.other) return null;
  if (user.role === 'admin') return null;

  if (diff.other) {
    return NextResponse.json(
      { error: 'Forbidden: only an admin can change these fields' },
      { status: 403 }
    );
  }

  const missing: Capability[] = [];
  if (diff.tags && !can(user, caps.tags)) missing.push(caps.tags);
  if (diff.path && !can(user, caps.path)) missing.push(caps.path);
  if (diff.monitoring && !can(user, caps.monitoring)) missing.push(caps.monitoring);

  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Forbidden: you cannot change ${missing.join(', ')}` },
      { status: 403 }
    );
  }
  return null;
}

async function getHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireUserCapability('movies.view');
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const parsed = parsePositiveId(id);
    if ('error' in parsed) return parsed.error;
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getRadarrClient(instanceId);
    const movie = await client.getMovieById(parsed.value);
    return NextResponse.json(movie);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch movie');
  }
}

async function putHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireUserCapability('movies.view');
  if (!auth.ok) return auth.response;

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
    if (auth.user.role !== 'admin') {
      const current = await client.getMovieById(pathId);
      const guardError = guardResolvedLibraryEdit(auth.user, diffMovieEdit(current, body), {
        tags: 'movies.editTags',
        path: 'movies.changePath',
        monitoring: 'movies.editMonitoring',
      });
      if (guardError) return guardError;
    }

    const result = await client.updateMovie(body, moveFiles);
    await invalidateTaggedLibrary('radarr', instanceId);
    return NextResponse.json(result);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to update movie');
  }
}

async function deleteHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireUserCapability('movies.delete');
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const parsed = parsePositiveId(id);
    if ('error' in parsed) return parsed.error;
    const { searchParams } = new URL(request.url);
    const deleteFiles = searchParams.get('deleteFiles') === 'true';
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getRadarrClient(instanceId);
    const movie = await client.getMovieById(parsed.value).catch(() => null);
    await runWithOperationAudit({
      user: auth.user,
      service: 'RADARR',
      instanceId,
      operation: 'DELETE_MEDIA',
      targetType: 'movie',
      targetId: parsed.value,
      targetTitle: movie?.title ?? `Movie #${parsed.value}`,
      itemCount: 1,
      filesDeleted: deleteFiles,
      details: { targetIds: [parsed.value], deleteFiles },
    }, () => client.deleteMovie(parsed.value, deleteFiles));
    await invalidateTaggedLibrary('radarr', instanceId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to delete movie');
  }
}

export const GET = withApiLogging(getHandler, 'api/radarr/[id]');
export const PUT = withApiLogging(putHandler, 'api/radarr/[id]');
export const DELETE = withApiLogging(deleteHandler, 'api/radarr/[id]');
