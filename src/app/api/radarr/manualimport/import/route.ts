import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { withApiLogging } from '@/lib/api-logger';
import { readJsonBody } from '@/lib/bulk-editor';
import { coercePositiveInt, sanitizeTitle, hasValidQuality } from '@/lib/manage-files-guard';
import { recordFileAudit } from '@/lib/file-audit';
import type { ArrLanguage, ArrQualityModel } from '@/types';

interface ImportFile {
  path: string;
  quality?: ArrQualityModel;
  languages?: ArrLanguage[];
  releaseGroup?: string;
  indexerFlags?: number;
}

function parseFiles(value: unknown): ImportFile[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: ImportFile[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.path !== 'string' || !o.path) return null;
    const f: ImportFile = { path: o.path };
    if (o.quality !== undefined) f.quality = o.quality as ArrQualityModel;
    if (o.languages !== undefined) f.languages = o.languages as ArrLanguage[];
    if (o.releaseGroup !== undefined) f.releaseGroup = String(o.releaseGroup);
    if (o.indexerFlags !== undefined) {
      const n = Number(o.indexerFlags);
      if (Number.isInteger(n) && n >= 0) f.indexerFlags = n;
    }
    out.push(f);
  }
  return out;
}

// POST /api/radarr/manualimport/import
// Body: { movieId, files: ImportFile[], mediaTitle? }
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('movies.manageFiles');
  if (!auth.ok) return auth.response;
  if (!can(auth.user, 'activity.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const json = await readJsonBody(request);
  if (!json.ok) return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  const body = (json.body ?? {}) as Record<string, unknown>;

  const movieId = coercePositiveInt(body.movieId);
  const files = parseFiles(body.files);
  if (!movieId || !files) {
    return NextResponse.json(
      { error: 'movieId and a non-empty files[] (each with a path) are required' },
      { status: 400 }
    );
  }
  const mediaTitle = sanitizeTitle(body.mediaTitle) ?? `Movie #${movieId}`;
  const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;

  const client = await getRadarrClient(instanceId);

  // Path guard: re-scan the movie's importable files (movieId-only branch) and
  // ensure every submitted path belongs to it.
  const scanned = await client.scanManualImport({ movieId });
  const validPaths = new Set(scanned.map((s) => s.path));
  const stray = files.filter((f) => !validPaths.has(f.path));
  if (stray.length) {
    return NextResponse.json(
      { error: `Path(s) not in the movie folder: ${stray.map((f) => f.path).join(', ')}` },
      { status: 400 }
    );
  }

  // The Manage UI only routes a file through ManualImport when it is loose; an
  // unchanged imported movie file is committed via PUT /moviefile/bulk instead.
  // Backfill quality/languages/releaseGroup/movieFileId from the scan: Radarr
  // requires a non-null Quality on the new MovieFile (a missing Quality fails a
  // NOT NULL constraint and leaves the file unlinked). The scan always carries one.
  const scanByPath = new Map(scanned.map((s) => [s.path, s]));
  const payload = files.map((f) => {
    const s = scanByPath.get(f.path);
    return {
      path: f.path,
      movieId,
      quality: hasValidQuality(f.quality) ? f.quality : s?.quality,
      languages: f.languages ?? s?.languages,
      releaseGroup: f.releaseGroup ?? s?.releaseGroup,
      indexerFlags: f.indexerFlags ?? s?.indexerFlags,
      movieFileId: s?.movieFileId ?? undefined,
    };
  });

  let commandId: number | null = null;
  let errorMessage: string | null = null;
  try {
    const command = await client.submitManualImport(payload, 'auto');
    commandId = command?.id ?? null;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Failed to submit import';
  }

  await recordFileAudit({
    user: auth.user,
    service: 'RADARR',
    instanceId,
    operation: 'IMPORT',
    mediaType: 'movie',
    mediaId: movieId,
    mediaTitle,
    fileCount: files.length,
    details: { paths: files.map((f) => f.path), importMode: 'auto', commandId },
    success: commandId != null && !errorMessage,
    errorMessage,
  });

  if (commandId == null) {
    return NextResponse.json({ error: errorMessage ?? 'Import was not queued' }, { status: 500 });
  }
  return NextResponse.json({ commandId });
}

export const POST = withApiLogging(postHandler, 'api/radarr/manualimport/import');
