import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { RadarrClient } from '@/lib/radarr-client';
import { resolveConnection } from '@/lib/arr-instances';
import { requireAuth, requireCapability } from '@/lib/auth';
import { guardBulkEdit } from '@/lib/library-edit-guard';
import { parseBulkEditBody, parseBulkDeleteBody, resolveTagIds, readJsonBody } from '@/lib/bulk-editor';
import { invalidateTaggedLibrary } from '@/lib/cache/tagged-library';
import { invalidateReferenceLabels } from '@/lib/cache/reference-labels';
import { withApiLogging } from '@/lib/api-logger';

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
    const client = new RadarrClient(conn.url, conn.apiKey);
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
    const message = error instanceof Error ? error.message : 'Failed to update movies';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function deleteHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('movies.delete');
  if (capError) return capError;

  try {
    const json = await readJsonBody(request);
    if (!json.ok) return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
    const parsed = parseBulkDeleteBody(json.body);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getRadarrClient(instanceId);
    await client.deleteMoviesBulk(parsed.ids, parsed.deleteFiles);
    await invalidateTaggedLibrary('radarr', instanceId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete movies';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const PUT = withApiLogging(putHandler, 'api/radarr/editor');
export const DELETE = withApiLogging(deleteHandler, 'api/radarr/editor');
