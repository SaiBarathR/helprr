import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { guardBulkEdit } from '@/lib/library-edit-guard';
import { parseBulkEditBody, parseBulkDeleteBody, resolveTagIds } from '@/lib/bulk-editor';
import { withApiLogging } from '@/lib/api-logger';

// Bulk monitor/tag across many movies via Radarr's native /movie/editor endpoint.
async function putHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const parsed = parseBulkEditBody(await request.json());
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const guardError = await guardBulkEdit(
      { monitoring: parsed.monitored !== undefined, tags: parsed.tags !== undefined },
      { monitoring: 'movies.editMonitoring', tags: 'movies.editTags' }
    );
    if (guardError) return guardError;

    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getRadarrClient(instanceId);
    const tagIds = parsed.tags
      ? await resolveTagIds(client, parsed.tags, parsed.applyTags ?? 'add')
      : undefined;
    const result = await client.movieEditor({
      movieIds: parsed.ids,
      monitored: parsed.monitored,
      tags: tagIds,
      applyTags: parsed.applyTags,
    });
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
    const parsed = parseBulkDeleteBody(await request.json());
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getRadarrClient(instanceId);
    await client.deleteMoviesBulk(parsed.ids, parsed.deleteFiles);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete movies';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const PUT = withApiLogging(putHandler, 'api/radarr/editor');
export const DELETE = withApiLogging(deleteHandler, 'api/radarr/editor');
