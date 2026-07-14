import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { RadarrClient } from '@/lib/radarr-client';
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

// Bulk monitor/tag across many movies via Radarr's native /movie/editor endpoint.
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
      { monitoring: 'movies.editMonitoring', tags: 'movies.editTags' }
    );
    if (guardError) return guardError;

    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    // Resolve the connection once so we can reuse its id for cache invalidation without a
    // second lookup — and so the only throwing call (the DB resolve) runs before any write.
    const conn = await resolveConnection('RADARR', instanceId);
    const client = new RadarrClient(conn.url, conn.apiKey, getConnectionHeaders(conn));
    const tagResult = parsed.tags
      ? await resolveTagIds(client, parsed.tags, parsed.applyTags ?? 'add')
      : undefined;
    const result = await client.movieEditor({
      movieIds: parsed.ids,
      monitored: parsed.monitored,
      tags: tagResult?.ids,
      applyTags: parsed.applyTags,
    });
    await invalidateTaggedLibrary('radarr', instanceId);
    // Only drop the label cache when a brand-new tag was actually created — otherwise the next
    // list read would refetch reference data for nothing.
    if (tagResult?.createdAny) await invalidateReferenceLabels('radarr', conn.id);
    return NextResponse.json(result);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to update movies');
  }
}

async function deleteHandler(request: NextRequest) {
  const auth = await requireUserCapability('movies.delete');
  if (!auth.ok) return auth.response;

  try {
    const json = await readJsonBody(request);
    if (!json.ok) return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
    const parsed = parseBulkDeleteBody(json.body);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getRadarrClient(instanceId);
    await runWithOperationAudit({
      user: auth.user,
      service: 'RADARR',
      instanceId,
      operation: 'DELETE_MEDIA',
      targetType: 'movie',
      targetId: parsed.ids.length === 1 ? parsed.ids[0] : null,
      targetTitle: `${parsed.ids.length} ${parsed.ids.length === 1 ? 'movie' : 'movies'}`,
      itemCount: parsed.ids.length,
      filesDeleted: parsed.deleteFiles,
      details: { targetIds: parsed.ids, deleteFiles: parsed.deleteFiles, bulk: true },
    }, () => client.deleteMoviesBulk(parsed.ids, parsed.deleteFiles));
    await invalidateTaggedLibrary('radarr', instanceId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to delete movies');
  }
}

export const PUT = withApiLogging(putHandler, 'api/radarr/editor');
export const DELETE = withApiLogging(deleteHandler, 'api/radarr/editor');
