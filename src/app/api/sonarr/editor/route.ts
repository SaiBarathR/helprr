import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { guardBulkEdit } from '@/lib/library-edit-guard';
import { parseBulkEditBody, parseBulkDeleteBody, resolveTagIds } from '@/lib/bulk-editor';
import { withApiLogging } from '@/lib/api-logger';

// Bulk monitor/tag across many series via Sonarr's native /series/editor endpoint.
async function putHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const parsed = parseBulkEditBody(await request.json());
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const guardError = await guardBulkEdit(
      { monitoring: parsed.monitored !== undefined, tags: parsed.tags !== undefined },
      { monitoring: 'series.editMonitoring', tags: 'series.editTags' }
    );
    if (guardError) return guardError;

    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getSonarrClient(instanceId);
    const tagIds = parsed.tags
      ? await resolveTagIds(client, parsed.tags, parsed.applyTags ?? 'add')
      : undefined;
    const result = await client.seriesEditor({
      seriesIds: parsed.ids,
      monitored: parsed.monitored,
      tags: tagIds,
      applyTags: parsed.applyTags,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update series';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function deleteHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('series.delete');
  if (capError) return capError;

  try {
    const parsed = parseBulkDeleteBody(await request.json());
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getSonarrClient(instanceId);
    await client.deleteSeriesBulk(parsed.ids, parsed.deleteFiles);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete series';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const PUT = withApiLogging(putHandler, 'api/sonarr/editor');
export const DELETE = withApiLogging(deleteHandler, 'api/sonarr/editor');
