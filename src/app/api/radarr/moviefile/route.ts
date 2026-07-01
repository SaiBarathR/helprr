import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
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
import type { MovieFileEdit, MovieFileResource } from '@/types';

// ── GET /api/radarr/moviefile?movieId= ──────────────────────────────────────
async function getHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('movies.view');
  if (capError) return capError;

  try {
    const movieId = coercePositiveInt(request.nextUrl.searchParams.get('movieId'));
    if (!movieId) {
      return NextResponse.json({ error: 'A valid movieId is required' }, { status: 400 });
    }
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getRadarrClient(instanceId);
    const files = await client.getMovieFiles(movieId);
    return NextResponse.json(files);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch movie files';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function buildResource(edit: MovieFileEdit): Partial<MovieFileResource> {
  const r: Partial<MovieFileResource> = { id: edit.id };
  if (edit.quality !== undefined) r.quality = edit.quality;
  if (edit.languages !== undefined) r.languages = edit.languages;
  if (edit.releaseGroup !== undefined) r.releaseGroup = edit.releaseGroup;
  if (edit.indexerFlags !== undefined) r.indexerFlags = edit.indexerFlags;
  if (edit.edition !== undefined) r.edition = edit.edition;
  return r;
}

function parseEdits(value: unknown): MovieFileEdit[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const edits: MovieFileEdit[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const id = coercePositiveInt(o.id);
    if (!id) return null;
    const edit: MovieFileEdit = { id };
    if (o.quality !== undefined) edit.quality = o.quality as MovieFileEdit['quality'];
    if (o.languages !== undefined) edit.languages = o.languages as MovieFileEdit['languages'];
    if (o.releaseGroup !== undefined) edit.releaseGroup = String(o.releaseGroup);
    if (o.indexerFlags !== undefined) {
      const n = Number(o.indexerFlags);
      if (!Number.isInteger(n) || n < 0) return null;
      edit.indexerFlags = n;
    }
    if (o.edition !== undefined) edit.edition = String(o.edition);
    edits.push(edit);
  }
  return edits;
}

// ── PUT /api/radarr/moviefile ───────────────────────────────────────────────
// Bulk metadata edit. Body: { movieId, edits: MovieFileEdit[], mediaTitle? }
async function putHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('movies.manageFiles');
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  const body = (json.body ?? {}) as Record<string, unknown>;

  const movieId = coercePositiveInt(body.movieId);
  const edits = parseEdits(body.edits);
  if (!movieId || !edits) {
    return NextResponse.json(
      { error: 'movieId and a non-empty edits[] (each with a valid id) are required' },
      { status: 400 }
    );
  }
  const mediaTitle = sanitizeTitle(body.mediaTitle) ?? `Movie #${movieId}`;
  const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;

  const client = await getRadarrClient(instanceId);

  const existing = await client.getMovieFiles(movieId);
  const owned = checkOwnership(edits.map((e) => e.id), existing);
  if (!owned.ok) {
    return NextResponse.json(
      { error: `Movie file id(s) not in movie ${movieId}: ${owned.missing.join(', ')}` },
      { status: 400 }
    );
  }

  const changedFields = [
    ...new Set(edits.flatMap((e) => Object.keys(e).filter((k) => k !== 'id'))),
  ];

  let success = false;
  let errorMessage: string | null = null;
  let result: MovieFileResource[] | undefined;
  try {
    result = await client.bulkEditMovieFiles(edits.map(buildResource));
    success = true;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Failed to edit movie files';
  }

  await recordFileAudit({
    user: auth.user,
    service: 'RADARR',
    instanceId,
    operation: 'EDIT',
    mediaType: 'movie',
    mediaId: movieId,
    mediaTitle,
    fileCount: edits.length,
    details: { movieFileIds: edits.map((e) => e.id), fields: changedFields },
    success,
    errorMessage,
  });

  if (!success) return NextResponse.json({ error: errorMessage }, { status: 500 });
  // File metadata (quality/languages/…) is embedded in the cached library rows.
  await invalidateTaggedLibrary('radarr', instanceId);
  return NextResponse.json(result);
}

// ── DELETE /api/radarr/moviefile ────────────────────────────────────────────
// Bulk delete. Body: { movieId, movieFileIds: number[], mediaTitle? }
async function deleteHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('movies.delete');
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  const body = (json.body ?? {}) as Record<string, unknown>;

  const movieId = coercePositiveInt(body.movieId);
  const ids = coercePositiveIntArray(body.movieFileIds);
  if (!movieId || !ids) {
    return NextResponse.json(
      { error: 'movieId and a non-empty movieFileIds[] are required' },
      { status: 400 }
    );
  }
  const mediaTitle = sanitizeTitle(body.mediaTitle) ?? `Movie #${movieId}`;
  const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;

  const client = await getRadarrClient(instanceId);

  const existing = await client.getMovieFiles(movieId);
  const owned = checkOwnership(ids, existing);
  if (!owned.ok) {
    return NextResponse.json(
      { error: `Movie file id(s) not in movie ${movieId}: ${owned.missing.join(', ')}` },
      { status: 400 }
    );
  }

  const totalBytes = owned.matched.reduce((s, f) => s + (f.size ?? 0), 0);
  const paths = owned.matched.map((f) => f.relativePath ?? f.path ?? String(f.id));

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
    await client.deleteMovieFilesBulk(ids);
    success = true;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Failed to delete movie files';
  }

  await recordFileAudit({
    user: auth.user,
    service: 'RADARR',
    instanceId,
    operation: 'DELETE',
    mediaType: 'movie',
    mediaId: movieId,
    mediaTitle,
    fileCount: ids.length,
    details: { movieFileIds: ids, paths, totalBytes, recycleBinConfigured },
    success,
    errorMessage,
  });

  if (!success) return NextResponse.json({ error: errorMessage }, { status: 500 });
  // Deleting files flips the movie's hasFile in the cached library list.
  await invalidateTaggedLibrary('radarr', instanceId);
  return NextResponse.json({ success: true, deleted: ids.length });
}

export const GET = withApiLogging(getHandler, 'api/radarr/moviefile');
export const PUT = withApiLogging(putHandler, 'api/radarr/moviefile');
export const DELETE = withApiLogging(deleteHandler, 'api/radarr/moviefile');
