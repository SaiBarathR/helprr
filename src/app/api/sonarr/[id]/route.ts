import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { diffSeriesEdit, type LibraryEditCaps, type LibraryEditDiff } from '@/lib/library-edit-guard';
import { can, type PermissionUser } from '@/lib/permissions';
import type { Capability } from '@/lib/capabilities';
import { invalidateTaggedLibrary } from '@/lib/cache/tagged-library';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { runWithOperationAudit } from '@/lib/file-audit';

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
) {
  const auth = await requireUserCapability('series.view');
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getSonarrClient(instanceId);
    const series = await client.getSeriesById(Number(id));
    return NextResponse.json(series);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch series');
  }
}

async function putHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUserCapability('series.view');
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const pathId = Number(id);
    if (!Number.isInteger(pathId) || pathId <= 0) {
      return NextResponse.json({ error: 'Invalid series id' }, { status: 400 });
    }
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }
    if ('id' in body && Number((body as { id?: unknown }).id) !== pathId) {
      return NextResponse.json({ error: 'Path id and body id must match' }, { status: 400 });
    }
    const moveFiles = new URL(request.url).searchParams.get('moveFiles') === 'true';
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getSonarrClient(instanceId);

    // Admins edit freely; only members are diffed against the live series and 403'd
    // for changing monitoring / tags / root folder without the matching capability.
    // Skipping the fetch for admins avoids an extra upstream round-trip and keeps a
    // transient detail-fetch error from failing an otherwise-valid admin edit.
    if (auth.user.role !== 'admin') {
      const current = await client.getSeriesById(pathId);
      const guardError = guardResolvedLibraryEdit(auth.user, diffSeriesEdit(current, body), {
        tags: 'series.editTags',
        path: 'series.changePath',
        monitoring: 'series.editMonitoring',
      });
      if (guardError) return guardError;
    }

    const result = await client.updateSeries(body, moveFiles);
    await invalidateTaggedLibrary('sonarr', instanceId);
    return NextResponse.json(result);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to update series');
  }
}

async function deleteHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUserCapability('series.delete');
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const seriesId = Number(id);
    if (!Number.isInteger(seriesId) || seriesId <= 0) {
      return NextResponse.json({ error: 'Invalid series id' }, { status: 400 });
    }
    const { searchParams } = new URL(request.url);
    const deleteFiles = searchParams.get('deleteFiles') === 'true';
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getSonarrClient(instanceId);
    const series = await client.getSeriesById(seriesId).catch(() => null);
    await runWithOperationAudit({
      user: auth.user,
      service: 'SONARR',
      instanceId,
      operation: 'DELETE_MEDIA',
      targetType: 'series',
      targetId: seriesId,
      targetTitle: series?.title ?? `Series #${seriesId}`,
      itemCount: 1,
      filesDeleted: deleteFiles,
      details: { targetIds: [seriesId], deleteFiles },
    }, () => client.deleteSeries(seriesId, deleteFiles));
    await invalidateTaggedLibrary('sonarr', instanceId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to delete series');
  }
}

export const GET = withApiLogging(getHandler, 'api/sonarr/[id]');
export const PUT = withApiLogging(putHandler, 'api/sonarr/[id]');
export const DELETE = withApiLogging(deleteHandler, 'api/sonarr/[id]');
