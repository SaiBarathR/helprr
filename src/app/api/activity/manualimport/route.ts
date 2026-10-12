import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient, getRadarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { recordOperationAudit } from '@/lib/file-audit';
import { coercePositiveInt, sanitizeTitle } from '@/lib/manage-files-guard';

// One download's files; far above any real pack, and bounds a hostile body.
const MAX_FILES = 1000;

interface SubmittedFile extends Record<string, unknown> {
  path: string;
  downloadId: string;
}

function isSubmittedFile(value: unknown): value is SubmittedFile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const file = value as Record<string, unknown>;
  return typeof file.path === 'string' && file.path !== ''
    && typeof file.downloadId === 'string' && file.downloadId !== '';
}

/**
 * Retrieve manual import data for a download from Sonarr or Radarr.
 *
 * Reads `downloadId` and `source` from the request query string, validates them,
 * and returns the manual import data from the corresponding service.
 *
 * @param request - Incoming HTTP request; expects query params:
 *   - `downloadId`: identifier of the download to look up (required)
 *   - `source`: either `"sonarr"` or `"radarr"` (required)
 * @returns The JSON HTTP response containing the manual import data on success;
 *   a JSON error message with status 400 when parameters are invalid;
 *   or a JSON error message with status 500 on internal failure.
 */
async function getHandler(request: NextRequest) {
  const auth = await requireUserCapability('activity.manage');
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const downloadId = searchParams.get('downloadId');
    const source = searchParams.get('source') as 'sonarr' | 'radarr';
    const instanceId = searchParams.get('instanceId') ?? undefined;

    if (!downloadId) {
      return NextResponse.json(
        { error: 'downloadId is required' },
        { status: 400 }
      );
    }

    if (!source || !['sonarr', 'radarr'].includes(source)) {
      return NextResponse.json(
        { error: 'source parameter is required and must be "sonarr" or "radarr"' },
        { status: 400 }
      );
    }

    if (source === 'sonarr') {
      const sonarr = await getSonarrClient(instanceId);
      const result = await sonarr.getManualImport(downloadId);
      return NextResponse.json(result);
    } else {
      const radarr = await getRadarrClient(instanceId);
      const result = await radarr.getManualImport(downloadId);
      return NextResponse.json(result);
    }
  } catch (error) {
    console.error('Failed to get manual import:', error);
    return NextResponse.json(
      { error: 'Failed to get manual import data' },
      { status: 500 }
    );
  }
}

// ── POST /api/activity/manualimport ─────────────────────────────────────────
// Body: { source, files, instanceId?, title? }
// Imports a download's files into the library. The *arr's ManualImport command
// moves whatever path it is handed, so the paths are checked here first, and
// the attempt is written to the operation audit whether or not it is queued.
async function postHandler(request: NextRequest) {
  const auth = await requireUserCapability('activity.manage');
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const { source, files } = body;
    const instanceId = new URL(request.url).searchParams.get('instanceId')
      ?? (typeof body.instanceId === 'string' ? body.instanceId : undefined);

    if (!source || !['sonarr', 'radarr'].includes(source)) {
      return NextResponse.json(
        { error: 'source is required and must be "sonarr" or "radarr"' },
        { status: 400 }
      );
    }

    if (!files || !Array.isArray(files)) {
      return NextResponse.json(
        { error: 'files array is required' },
        { status: 400 }
      );
    }

    if (files.length === 0 || files.length > MAX_FILES || !files.every(isSubmittedFile)) {
      return NextResponse.json(
        { error: `files must be 1 to ${MAX_FILES} objects, each with a path and a downloadId` },
        { status: 400 }
      );
    }
    const downloadId = files[0].downloadId;
    if (files.some((file) => file.downloadId !== downloadId)) {
      return NextResponse.json({ error: 'files must belong to one download' }, { status: 400 });
    }

    const isSonarr = source === 'sonarr';
    const client = isSonarr ? await getSonarrClient(instanceId) : await getRadarrClient(instanceId);

    // Path guard: ask the *arr again which files this download holds, and take
    // only those. Without it a request could name any file the *arr can reach
    // and have it moved into the library.
    const listed = new Set((await client.getManualImport(downloadId)).map((file) => file.path));
    if (files.some((file) => !listed.has(file.path))) {
      return NextResponse.json(
        { error: 'Some files are no longer part of this download. Reload and try again.' },
        { status: 409 }
      );
    }

    let command: { id?: number } | null = null;
    let errorMessage: string | null = null;
    try {
      command = await client.submitManualImport(files);
    } catch (error) {
      errorMessage = (error instanceof Error && error.message) || 'Failed to submit import';
    }
    // Queued means the *arr answered with a command to follow.
    const queued = command?.id != null && !errorMessage;

    // A pack can span several series, so the row names one only when all files agree.
    const mediaIds = [...new Set(files.map((file) => coercePositiveInt(isSonarr ? file.seriesId : file.movieId)))];
    await recordOperationAudit({
      user: auth.user,
      service: isSonarr ? 'SONARR' : 'RADARR',
      instanceId,
      operation: 'IMPORT',
      targetType: isSonarr ? 'series' : 'movie',
      targetId: mediaIds.length === 1 ? mediaIds[0] : null,
      targetTitle: sanitizeTitle(body.title) ?? `Download ${downloadId.slice(0, 40)}`,
      itemCount: files.length,
      details: {
        origin: 'activity',
        downloadId,
        paths: files.map((file) => file.path),
        mediaIds: mediaIds.filter((id) => id !== null),
        commandId: command?.id ?? null,
      },
      success: queued,
      errorMessage,
    });

    if (!queued) {
      console.error('Failed to submit manual import:', errorMessage ?? 'no command was returned');
      return NextResponse.json(
        { error: 'Failed to submit manual import' },
        { status: 500 }
      );
    }
    return NextResponse.json(command);
  } catch (error) {
    console.error('Failed to submit manual import:', error);
    return NextResponse.json(
      { error: 'Failed to submit manual import' },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler, 'api/activity/manualimport');
export const POST = withApiLogging(postHandler, 'api/activity/manualimport');
