import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';
import { SonarrClient } from '@/lib/sonarr-client';
import { resolveConnection } from '@/lib/arr-instances';
import { getConnectionHeaders } from '@/lib/service-connection-secrets';
import { requireAuth, requireUserCapability } from '@/lib/auth';
import { guardBulkEdit } from '@/lib/library-edit-guard';
import { parseBulkEditBody, parseBulkDeleteBody, resolveTagIds, readJsonBody } from '@/lib/bulk-editor';
import { invalidateTaggedLibrary } from '@/lib/cache/tagged-library';
import { invalidateReferenceLabels } from '@/lib/cache/reference-labels';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { runWithOperationAudit } from '@/lib/file-audit';

// Bulk monitor/tag across many series via Sonarr's native /series/editor endpoint.
async function putHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const json = await readJsonBody(request);
    if (!json.ok) return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
    const parsed = parseBulkEditBody(json.body);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const guardError = await guardBulkEdit(
      { monitoring: parsed.monitored !== undefined, tags: parsed.tags !== undefined },
      { monitoring: 'series.editMonitoring', tags: 'series.editTags' }
    );
    if (guardError) return guardError;

    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    // Resolve the connection once so we can reuse its id for cache invalidation without a
    // second lookup — and so the only throwing call (the DB resolve) runs before any write.
    const conn = await resolveConnection('SONARR', instanceId);
    const client = new SonarrClient(conn.url, conn.apiKey, getConnectionHeaders(conn));
    const tagResult = parsed.tags
      ? await resolveTagIds(client, parsed.tags, parsed.applyTags ?? 'add')
      : undefined;
    const result = await client.seriesEditor({
      seriesIds: parsed.ids,
      monitored: parsed.monitored,
      tags: tagResult?.ids,
      applyTags: parsed.applyTags,
    });
    await invalidateTaggedLibrary('sonarr', instanceId);
    // Only drop the label cache when a brand-new tag was actually created — otherwise the next
    // list read would refetch reference data for nothing.
    if (tagResult?.createdAny) await invalidateReferenceLabels('sonarr', conn.id);
    return NextResponse.json(result);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to update series');
  }
}

async function deleteHandler(request: NextRequest) {
  const auth = await requireUserCapability('series.delete');
  if (!auth.ok) return auth.response;

  try {
    const json = await readJsonBody(request);
    if (!json.ok) return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
    const parsed = parseBulkDeleteBody(json.body);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getSonarrClient(instanceId);
    await runWithOperationAudit({
      user: auth.user,
      service: 'SONARR',
      instanceId,
      operation: 'DELETE_MEDIA',
      targetType: 'series',
      targetId: parsed.ids.length === 1 ? parsed.ids[0] : null,
      targetTitle: `${parsed.ids.length} ${parsed.ids.length === 1 ? 'series' : 'series'}`,
      itemCount: parsed.ids.length,
      filesDeleted: parsed.deleteFiles,
      details: { targetIds: parsed.ids, deleteFiles: parsed.deleteFiles, bulk: true },
    }, () => client.deleteSeriesBulk(parsed.ids, parsed.deleteFiles));
    await invalidateTaggedLibrary('sonarr', instanceId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to delete series');
  }
}

export const PUT = withApiLogging(putHandler, 'api/sonarr/editor');
export const DELETE = withApiLogging(deleteHandler, 'api/sonarr/editor');
