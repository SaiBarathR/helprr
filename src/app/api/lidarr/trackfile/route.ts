import { NextRequest, NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability, requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { readJsonBody } from '@/lib/bulk-editor';
import {
  coercePositiveInt,
  coercePositiveIntArray,
  sanitizeTitle,
  checkOwnership,
} from '@/lib/manage-files-guard';
import { recordFileAudit } from '@/lib/file-audit';
import { invalidateTaggedLibrary } from '@/lib/cache/tagged-library';
import { upstreamErrorResponse } from '@/lib/api-error';

function isPositiveIntParam(value: string): boolean {
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}

async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('music.view');
  if (capError) return capError;

  try {
    const { searchParams } = new URL(request.url);
    const artistIdParam = searchParams.get('artistId');
    const albumIdParam = searchParams.get('albumId');
    if (!artistIdParam && !albumIdParam) {
      return NextResponse.json({ error: 'artistId or albumId is required' }, { status: 400 });
    }
    const params: { artistId?: number; albumId?: number } = {};
    if (albumIdParam) {
      if (!isPositiveIntParam(albumIdParam)) {
        return NextResponse.json({ error: 'albumId must be a positive integer' }, { status: 400 });
      }
      params.albumId = Number(albumIdParam);
    } else if (artistIdParam) {
      if (!isPositiveIntParam(artistIdParam)) {
        return NextResponse.json({ error: 'artistId must be a positive integer' }, { status: 400 });
      }
      params.artistId = Number(artistIdParam);
    }

    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getLidarrClient(instanceId);
    const files = await client.getTrackFiles(params);
    return NextResponse.json(files);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch track files');
  }
}

// ── DELETE /api/lidarr/trackfile ────────────────────────────────────────────
// Bulk delete. Body: { artistId, trackFileIds: number[], mediaTitle? }
// Mirrors the Sonarr/Radarr bulk file routes: ownership validation (every id
// must belong to the stated artist) + a file audit record.
async function deleteHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('music.delete');
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  const body = (json.body ?? {}) as Record<string, unknown>;

  const artistId = coercePositiveInt(body.artistId);
  const ids = coercePositiveIntArray(body.trackFileIds);
  if (!artistId || !ids) {
    return NextResponse.json(
      { error: 'artistId and a non-empty trackFileIds[] are required' },
      { status: 400 }
    );
  }
  const mediaTitle = sanitizeTitle(body.mediaTitle) ?? `Artist #${artistId}`;
  const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;

  const client = await getLidarrClient(instanceId);

  // Ownership: every id must belong to this artist (upstream bulk delete does
  // NOT scope by artist — this is the guard against cross-artist id injection).
  const existing = await client.getTrackFiles({ artistId });
  const owned = checkOwnership(ids, existing);
  if (!owned.ok) {
    return NextResponse.json(
      { error: `Track file id(s) not in artist ${artistId}: ${owned.missing.join(', ')}` },
      { status: 400 }
    );
  }

  const totalBytes = owned.matched.reduce((s, f) => s + (f.size ?? 0), 0);
  const paths = owned.matched.map((f) => f.path ?? String(f.id));

  let success = false;
  let errorMessage: string | null = null;
  let caughtError: unknown;
  try {
    await client.deleteTrackFilesBulk(ids);
    success = true;
  } catch (error) {
    caughtError = error;
    errorMessage = error instanceof Error ? error.message : 'Failed to delete track files';
  }

  await recordFileAudit({
    user: auth.user,
    service: 'LIDARR',
    instanceId,
    operation: 'DELETE',
    mediaType: 'artist',
    mediaId: artistId,
    mediaTitle,
    fileCount: ids.length,
    details: { trackFileIds: ids, paths, totalBytes },
    success,
    errorMessage,
  });

  if (!success) return upstreamErrorResponse(caughtError, 'Failed to delete track files');
  // Deleting files changes the artist statistics in the cached library list.
  await invalidateTaggedLibrary('lidarr', instanceId);
  return NextResponse.json({ success: true, deleted: ids.length });
}

export const GET = withApiLogging(getHandler, 'api/lidarr/trackfile');
export const DELETE = withApiLogging(deleteHandler, 'api/lidarr/trackfile');
