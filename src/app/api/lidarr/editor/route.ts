import { NextRequest, NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { LidarrClient } from '@/lib/lidarr-client';
import { resolveConnection } from '@/lib/arr-instances';
import { getConnectionHeaders } from '@/lib/service-connection-secrets';
import { getCurrentUser, requireAuth, requireUserCapability } from '@/lib/auth';
import { guardBulkEdit } from '@/lib/library-edit-guard';
import {
  changesAdminOnlyFields,
  parseBulkEditBody,
  parseBulkDeleteBody,
  resolveTagIds,
  readJsonBody,
  validateInstanceSettings,
} from '@/lib/bulk-editor';
import { invalidateTaggedLibrary } from '@/lib/cache/tagged-library';
import { invalidateReferenceLabels } from '@/lib/cache/reference-labels';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { runWithOperationAudit } from '@/lib/file-audit';

// Bulk monitor/tag/settings across many artists via Lidarr's native /artist/editor endpoint.
async function putHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const json = await readJsonBody(request);
    if (!json.ok) return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
    const parsed = parseBulkEditBody(json.body, 'lidarr');
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const guardError = await guardBulkEdit(
      {
        monitoring: parsed.monitored !== undefined,
        tags: parsed.tags !== undefined,
        path: parsed.rootFolderPath !== undefined,
        other: changesAdminOnlyFields(parsed),
      },
      { monitoring: 'music.editMonitoring', tags: 'music.editTags', path: 'music.changePath' }
    );
    if (guardError) return guardError;

    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    // Resolve the connection once so we can reuse its id for cache invalidation without a
    // second lookup — and so the only throwing call (the DB resolve) runs before any write.
    const conn = await resolveConnection('LIDARR', instanceId);
    const client = new LidarrClient(conn.url, conn.apiKey, getConnectionHeaders(conn));
    // Profile ids and root folders are per-instance: check them against this instance
    // before anything is written (tags included).
    const invalid = await validateInstanceSettings(client, parsed);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
    const tagResult = parsed.tags
      ? await resolveTagIds(client, parsed.tags, parsed.applyTags ?? 'add')
      : undefined;
    const edit = () => client.artistEditor({
      artistIds: parsed.ids,
      monitored: parsed.monitored,
      tags: tagResult?.ids,
      applyTags: parsed.applyTags,
      qualityProfileId: parsed.qualityProfileId,
      rootFolderPath: parsed.rootFolderPath,
      moveFiles: parsed.moveFiles,
      metadataProfileId: parsed.metadataProfileId,
      monitorNewItems: parsed.monitorNewItems,
    });
    // A root-folder change rewrites every item's path and, with moveFiles, moves its
    // files on disk, so it goes through the operation audit like the other file ops.
    const result = parsed.rootFolderPath !== undefined
      ? await runWithOperationAudit({
          user: await getCurrentUser(),
          // The resolved connection, so a request that names no instance still records
          // which instance's files were moved.
          instanceId: conn.id,
          service: 'LIDARR',
          operation: 'MOVE_MEDIA',
          targetType: 'artist',
          targetId: parsed.ids.length === 1 ? parsed.ids[0] : null,
          targetTitle: `${parsed.ids.length} artist${parsed.ids.length === 1 ? '' : 's'}`,
          itemCount: parsed.ids.length,
          details: {
            targetIds: parsed.ids,
            rootFolderPath: parsed.rootFolderPath,
            moveFiles: parsed.moveFiles === true,
            bulk: true,
          },
        }, edit)
      : await edit();
    await invalidateTaggedLibrary('lidarr', instanceId);
    // Only drop the label cache when a brand-new tag was actually created — otherwise the next
    // list read would refetch reference data for nothing.
    if (tagResult?.createdAny) await invalidateReferenceLabels('lidarr', conn.id);
    return NextResponse.json(result);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to update artists');
  }
}

async function deleteHandler(request: NextRequest) {
  const auth = await requireUserCapability('music.delete');
  if (!auth.ok) return auth.response;

  try {
    const json = await readJsonBody(request);
    if (!json.ok) return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
    const parsed = parseBulkDeleteBody(json.body);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getLidarrClient(instanceId);
    await runWithOperationAudit({
      user: auth.user,
      service: 'LIDARR',
      instanceId,
      operation: 'DELETE_MEDIA',
      targetType: 'artist',
      targetId: parsed.ids.length === 1 ? parsed.ids[0] : null,
      targetTitle: `${parsed.ids.length} ${parsed.ids.length === 1 ? 'artist' : 'artists'}`,
      itemCount: parsed.ids.length,
      filesDeleted: parsed.deleteFiles,
      details: { targetIds: parsed.ids, deleteFiles: parsed.deleteFiles, bulk: true },
    }, () => client.deleteArtistsBulk(parsed.ids, parsed.deleteFiles));
    await invalidateTaggedLibrary('lidarr', instanceId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to delete artists');
  }
}

export const PUT = withApiLogging(putHandler, 'api/lidarr/editor');
export const DELETE = withApiLogging(deleteHandler, 'api/lidarr/editor');
