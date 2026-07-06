import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';
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
import type { EpisodeFileEdit, EpisodeFileResource } from '@/types';
import { upstreamErrorResponse } from '@/lib/api-error';

// ── GET /api/sonarr/episodefile?seriesId= ───────────────────────────────────
// Lists the episode files for a series (the Manage Episodes data source).
async function getHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('series.view');
  if (capError) return capError;

  try {
    const seriesId = coercePositiveInt(request.nextUrl.searchParams.get('seriesId'));
    if (!seriesId) {
      return NextResponse.json({ error: 'A valid seriesId is required' }, { status: 400 });
    }
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getSonarrClient(instanceId);
    const files = await client.getEpisodeFiles(seriesId);
    return NextResponse.json(files);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch episode files');
  }
}

// Build the *arr resource from a validated edit, including ONLY the fields the
// caller actually set. The bulk endpoint applies non-null fields only, so this
// keeps an edit surgical (and prevents tampering with path/relativePath etc.).
function buildResource(edit: EpisodeFileEdit): Partial<EpisodeFileResource> {
  const r: Partial<EpisodeFileResource> = { id: edit.id };
  if (edit.quality !== undefined) r.quality = edit.quality;
  if (edit.languages !== undefined) r.languages = edit.languages;
  if (edit.releaseGroup !== undefined) r.releaseGroup = edit.releaseGroup;
  if (edit.indexerFlags !== undefined) r.indexerFlags = edit.indexerFlags;
  if (edit.releaseType !== undefined) r.releaseType = edit.releaseType;
  return r;
}

function parseEdits(value: unknown): EpisodeFileEdit[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const edits: EpisodeFileEdit[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const id = coercePositiveInt(o.id);
    if (!id) return null;
    const edit: EpisodeFileEdit = { id };
    if (o.quality !== undefined) edit.quality = o.quality as EpisodeFileEdit['quality'];
    if (o.languages !== undefined) edit.languages = o.languages as EpisodeFileEdit['languages'];
    if (o.releaseGroup !== undefined) edit.releaseGroup = String(o.releaseGroup);
    if (o.indexerFlags !== undefined) {
      const n = Number(o.indexerFlags);
      if (!Number.isInteger(n) || n < 0) return null;
      edit.indexerFlags = n;
    }
    if (o.releaseType !== undefined) edit.releaseType = o.releaseType as EpisodeFileEdit['releaseType'];
    edits.push(edit);
  }
  return edits;
}

// ── PUT /api/sonarr/episodefile ─────────────────────────────────────────────
// Bulk metadata edit. Body: { seriesId, edits: EpisodeFileEdit[], mediaTitle? }
async function putHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('series.manageFiles');
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  const body = (json.body ?? {}) as Record<string, unknown>;

  const seriesId = coercePositiveInt(body.seriesId);
  const edits = parseEdits(body.edits);
  if (!seriesId || !edits) {
    return NextResponse.json(
      { error: 'seriesId and a non-empty edits[] (each with a valid id) are required' },
      { status: 400 }
    );
  }
  const mediaTitle = sanitizeTitle(body.mediaTitle) ?? `Series #${seriesId}`;
  const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;

  const client = await getSonarrClient(instanceId);

  // Ownership: every edited id must belong to this series.
  const existing = await client.getEpisodeFiles(seriesId);
  const owned = checkOwnership(edits.map((e) => e.id), existing);
  if (!owned.ok) {
    return NextResponse.json(
      { error: `Episode file id(s) not in series ${seriesId}: ${owned.missing.join(', ')}` },
      { status: 400 }
    );
  }

  const changedFields = [
    ...new Set(edits.flatMap((e) => Object.keys(e).filter((k) => k !== 'id'))),
  ];

  let success = false;
  let errorMessage: string | null = null;
  let result: EpisodeFileResource[] | undefined;
  try {
    result = await client.bulkEditEpisodeFiles(edits.map(buildResource));
    success = true;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Failed to edit episode files';
  }

  await recordFileAudit({
    user: auth.user,
    service: 'SONARR',
    instanceId,
    operation: 'EDIT',
    mediaType: 'series',
    mediaId: seriesId,
    mediaTitle,
    fileCount: edits.length,
    details: { episodeFileIds: edits.map((e) => e.id), fields: changedFields },
    success,
    errorMessage,
  });

  if (!success) {
    console.error('[api] Failed to edit episode files:', errorMessage);
    return NextResponse.json({ error: 'Failed to edit episode files' }, { status: 500 });
  }
  // File metadata feeds the cached library rows (per-episode quality rollups).
  await invalidateTaggedLibrary('sonarr', instanceId);
  return NextResponse.json(result);
}

// ── DELETE /api/sonarr/episodefile ──────────────────────────────────────────
// Bulk delete. Body: { seriesId, episodeFileIds: number[], mediaTitle? }
async function deleteHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('series.delete');
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  const body = (json.body ?? {}) as Record<string, unknown>;

  const seriesId = coercePositiveInt(body.seriesId);
  const ids = coercePositiveIntArray(body.episodeFileIds);
  if (!seriesId || !ids) {
    return NextResponse.json(
      { error: 'seriesId and a non-empty episodeFileIds[] are required' },
      { status: 400 }
    );
  }
  const mediaTitle = sanitizeTitle(body.mediaTitle) ?? `Series #${seriesId}`;
  const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;

  const client = await getSonarrClient(instanceId);

  // Ownership: every id must belong to this series (upstream bulk delete does
  // NOT scope by series — this is the guard against cross-series id injection).
  const existing = await client.getEpisodeFiles(seriesId);
  const owned = checkOwnership(ids, existing);
  if (!owned.ok) {
    return NextResponse.json(
      { error: `Episode file id(s) not in series ${seriesId}: ${owned.missing.join(', ')}` },
      { status: 400 }
    );
  }

  const totalBytes = owned.matched.reduce((s, f) => s + (f.size ?? 0), 0);
  const paths = owned.matched.map((f) => f.relativePath ?? f.path ?? String(f.id));

  // Best-effort: record whether this delete was recoverable (recycle bin) or
  // permanent at the time it happened.
  let recycleBinConfigured: boolean | null = null;
  try {
    const cfg = await client.getMediaManagementConfig();
    recycleBinConfigured = !!cfg.recycleBin?.trim();
  } catch {
    /* leave null = unknown */
  }

  let success = false;
  let errorMessage: string | null = null;
  try {
    await client.deleteEpisodeFilesBulk(ids);
    success = true;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Failed to delete episode files';
  }

  await recordFileAudit({
    user: auth.user,
    service: 'SONARR',
    instanceId,
    operation: 'DELETE',
    mediaType: 'series',
    mediaId: seriesId,
    mediaTitle,
    fileCount: ids.length,
    details: { episodeFileIds: ids, paths, totalBytes, recycleBinConfigured },
    success,
    errorMessage,
  });

  if (!success) {
    console.error('[api] Failed to delete episode files:', errorMessage);
    return NextResponse.json({ error: 'Failed to delete episode files' }, { status: 500 });
  }
  // Deleting files changes the series statistics (episodeFileCount, sizeOnDisk).
  await invalidateTaggedLibrary('sonarr', instanceId);
  return NextResponse.json({ success: true, deleted: ids.length });
}

export const GET = withApiLogging(getHandler, 'api/sonarr/episodefile');
export const PUT = withApiLogging(putHandler, 'api/sonarr/episodefile');
export const DELETE = withApiLogging(deleteHandler, 'api/sonarr/episodefile');
