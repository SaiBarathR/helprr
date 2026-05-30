import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { diffSeriesEdit, guardLibraryEdit } from '@/lib/library-edit-guard';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const client = await getSonarrClient();
    const series = await client.getSeriesById(Number(id));
    return NextResponse.json(series);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch series';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function putHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const body = await request.json();
    const moveFiles = new URL(request.url).searchParams.get('moveFiles') === 'true';
    const client = await getSonarrClient();

    // Diff the submitted body against the live series and 403 if a member is
    // changing monitoring / tags / root folder without the matching capability.
    const current = await client.getSeriesById(Number((body as { id?: unknown })?.id));
    const guardError = await guardLibraryEdit(diffSeriesEdit(current, body), {
      tags: 'series.editTags',
      path: 'series.changePath',
      monitoring: 'series.editMonitoring',
    });
    if (guardError) return guardError;

    const result = await client.updateSeries(body, moveFiles);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update series';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function deleteHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('series.delete');
  if (capError) return capError;

  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const deleteFiles = searchParams.get('deleteFiles') === 'true';
    const client = await getSonarrClient();
    await client.deleteSeries(Number(id), deleteFiles);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete series';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/sonarr/[id]');
export const PUT = withApiLogging(putHandler, 'api/sonarr/[id]');
export const DELETE = withApiLogging(deleteHandler, 'api/sonarr/[id]');
