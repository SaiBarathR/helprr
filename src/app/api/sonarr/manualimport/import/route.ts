import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { withApiLogging } from '@/lib/api-logger';
import { readJsonBody } from '@/lib/bulk-editor';
import {
  coercePositiveInt,
  coercePositiveIntArray,
  sanitizeTitle,
  checkOwnership,
  hasValidQuality,
} from '@/lib/manage-files-guard';
import { recordFileAudit } from '@/lib/file-audit';
import type { ArrLanguage, ArrQualityModel, ReleaseType } from '@/types';

interface ImportFile {
  path: string;
  episodeIds: number[];
  seasonNumber?: number;
  quality?: ArrQualityModel;
  languages?: ArrLanguage[];
  releaseGroup?: string;
  indexerFlags?: number;
  releaseType?: ReleaseType;
}

function parseFiles(value: unknown): ImportFile[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: ImportFile[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.path !== 'string' || !o.path) return null;
    const episodeIds = coercePositiveIntArray(o.episodeIds);
    if (!episodeIds) return null; // an episode import must map to ≥1 episode
    const f: ImportFile = { path: o.path, episodeIds };
    if (o.seasonNumber !== undefined) {
      const n = Number(o.seasonNumber);
      if (Number.isInteger(n)) f.seasonNumber = n;
    }
    if (o.quality !== undefined) f.quality = o.quality as ArrQualityModel;
    if (o.languages !== undefined) f.languages = o.languages as ArrLanguage[];
    if (o.releaseGroup !== undefined) f.releaseGroup = String(o.releaseGroup);
    if (o.indexerFlags !== undefined) {
      const n = Number(o.indexerFlags);
      if (Number.isInteger(n) && n >= 0) f.indexerFlags = n;
    }
    if (o.releaseType !== undefined) f.releaseType = o.releaseType as ReleaseType;
    out.push(f);
  }
  return out;
}

// POST /api/sonarr/manualimport/import
// Body: { seriesId, files: ImportFile[], mediaTitle? }
// Imports (moves + renames per naming config) loose/scanned files into the series.
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('series.manageFiles');
  if (!auth.ok) return auth.response;
  // Import physically moves files — additionally gate on activity.manage,
  // matching the existing manual-import permission.
  if (!can(auth.user, 'activity.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const json = await readJsonBody(request);
  if (!json.ok) return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  const body = (json.body ?? {}) as Record<string, unknown>;

  const seriesId = coercePositiveInt(body.seriesId);
  const files = parseFiles(body.files);
  if (!seriesId || !files) {
    return NextResponse.json(
      { error: 'seriesId and a non-empty files[] (each with a path and episodeIds[]) are required' },
      { status: 400 }
    );
  }
  const mediaTitle = sanitizeTitle(body.mediaTitle) ?? `Series #${seriesId}`;
  const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;

  const client = await getSonarrClient(instanceId);

  // Path guard: resolve the series folder SERVER-SIDE and re-scan it, then ensure
  // every submitted path is a file in that folder. A client can't move arbitrary
  // paths — only files that genuinely belong to this series.
  const series = await client.getSeriesById(seriesId);
  if (!series?.path) {
    return NextResponse.json({ error: 'Series folder is not available' }, { status: 409 });
  }
  const scanned = await client.scanManualImport({
    folder: series.path,
    seriesId,
    filterExistingFiles: false,
  });
  const validPaths = new Set(scanned.map((s) => s.path));
  const stray = files.filter((f) => !validPaths.has(f.path));
  if (stray.length) {
    return NextResponse.json(
      { error: `Path(s) not in the series folder: ${stray.map((f) => f.path).join(', ')}` },
      { status: 400 }
    );
  }

  // Episode-mapping guard: the path guard proves only the file's folder, not the
  // episode mapping. Ensure every submitted episodeId belongs to THIS series so a
  // crafted request can't re-point a file onto another series' episodes.
  const episodes = await client.getEpisodes(seriesId);
  const requestedEpisodeIds = [...new Set(files.flatMap((f) => f.episodeIds))];
  const ownedEps = checkOwnership(requestedEpisodeIds, episodes);
  if (!ownedEps.ok) {
    return NextResponse.json(
      { error: `Episode id(s) not in series ${seriesId}: ${ownedEps.missing.join(', ')}` },
      { status: 400 }
    );
  }

  // The Manage UI only routes a file through ManualImport when it is loose OR is an
  // already-imported file being RE-MAPPED to different episodes (the override branch
  // re-points the DB mapping; the physical file is untouched). Unchanged imported
  // files are committed via PUT /episodefile/bulk instead, never here.
  //
  // Backfill quality/languages/releaseGroup/episodeFileId from the scan: the *arr
  // requires a non-null Quality on the new EpisodeFile (a missing Quality fails a
  // NOT NULL constraint, which deletes the old record and leaves the file unlinked).
  // The scan always carries a parsed Quality, so this guarantees a valid import.
  const scanByPath = new Map(scanned.map((s) => [s.path, s]));
  const payload = files.map((f) => {
    const s = scanByPath.get(f.path);
    return {
      path: f.path,
      seriesId,
      episodeIds: f.episodeIds,
      seasonNumber: f.seasonNumber,
      quality: hasValidQuality(f.quality) ? f.quality : s?.quality,
      languages: f.languages ?? s?.languages,
      releaseGroup: f.releaseGroup ?? s?.releaseGroup,
      indexerFlags: f.indexerFlags ?? s?.indexerFlags,
      releaseType: f.releaseType ?? s?.releaseType,
      episodeFileId: s?.episodeFileId ?? undefined,
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
    service: 'SONARR',
    instanceId,
    operation: 'IMPORT',
    mediaType: 'series',
    mediaId: seriesId,
    mediaTitle,
    fileCount: files.length,
    details: {
      paths: files.map((f) => f.path),
      episodeIds: files.flatMap((f) => f.episodeIds),
      importMode: 'auto',
      commandId,
    },
    success: commandId != null && !errorMessage,
    errorMessage,
  });

  if (commandId == null) {
    console.error('[api] Failed to submit import:', errorMessage);
    return NextResponse.json({ error: 'Import was not queued' }, { status: 500 });
  }
  return NextResponse.json({ commandId });
}

export const POST = withApiLogging(postHandler, 'api/sonarr/manualimport/import');
