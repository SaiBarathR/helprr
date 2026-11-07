import { NextRequest, NextResponse } from 'next/server';
import { isAxiosError } from 'axios';
import { getSonarrClient, getRadarrClient, getLidarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { recordOperationAudit } from '@/lib/file-audit';
import { checkOwnership, coercePositiveInt, coercePositiveIntArray, hasValidQuality, sanitizeTitle } from '@/lib/manage-files-guard';
import type { LidarrClient } from '@/lib/lidarr-client';
import type { ArrQualityModel, ManualImportItem } from '@/types';

// One download's files; far above any real pack, and bounds a hostile body.
const MAX_FILES = 1000;

type Source = 'sonarr' | 'radarr' | 'lidarr';
const SOURCES: readonly string[] = ['sonarr', 'radarr', 'lidarr'];

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

// A Lidarr file names its artist, album, release and tracks. Lidarr's import
// trusts these ids as given, so they are taken only as positive integers here
// and checked against Lidarr's own album before anything is moved.
interface LidarrImportFile {
  path: string;
  downloadId: string;
  artistId: number;
  albumId: number;
  albumReleaseId: number;
  trackIds: number[];
  quality?: ArrQualityModel;
  releaseGroup?: string;
  indexerFlags?: number;
  disableReleaseSwitching?: boolean;
}

function parseLidarrFile(file: SubmittedFile): LidarrImportFile | null {
  const artistId = coercePositiveInt(file.artistId);
  const albumId = coercePositiveInt(file.albumId);
  const albumReleaseId = coercePositiveInt(file.albumReleaseId);
  const trackIds = coercePositiveIntArray(file.trackIds);
  if (!artistId || !albumId || !albumReleaseId || !trackIds) return null;
  const parsed: LidarrImportFile = { path: file.path, downloadId: file.downloadId, artistId, albumId, albumReleaseId, trackIds };
  if (file.quality !== undefined) parsed.quality = file.quality as ArrQualityModel;
  if (typeof file.releaseGroup === 'string') parsed.releaseGroup = file.releaseGroup;
  if (Number.isInteger(file.indexerFlags) && (file.indexerFlags as number) >= 0) parsed.indexerFlags = file.indexerFlags as number;
  if (typeof file.disableReleaseSwitching === 'boolean') parsed.disableReleaseSwitching = file.disableReleaseSwitching;
  return parsed;
}

/**
 * Why the files can't go where they say, or null when they can: each album must
 * be the named artist's, on one of its releases, and the tracks that release's.
 * Without it a request could file a download under any album.
 */
async function lidarrOwnershipError(client: LidarrClient, files: LidarrImportFile[]): Promise<string | null> {
  const albumIds = [...new Set(files.map((file) => file.albumId))];
  // A few albums at a time, so a discography doesn't fire every read at once.
  for (let i = 0; i < albumIds.length; i += 5) {
    const batch = albumIds.slice(i, i + 5);
    const albums = await Promise.all(batch.map((id) => client.getAlbumById(id).catch((error) => {
      if (isAxiosError(error) && error.response?.status === 404) return id;
      throw error;
    })));
    for (const [index, album] of albums.entries()) {
      if (typeof album === 'number') return `Lidarr no longer has album ${album}`;
      // Files are matched on album.id below; another album's answer would skip their checks.
      if (album.id !== batch[index]) return `Lidarr answered album ${batch[index]} with another album`;
      const albumFiles = files.filter((file) => file.albumId === album.id);
      if (albumFiles.some((file) => file.artistId !== album.artistId)) {
        return `Album ${album.id} is not by the artist given for its files`;
      }
      // Lidarr imports an album on one release; files on another would end up on tracks it doesn't use.
      const releaseIds = [...new Set(albumFiles.map((file) => file.albumReleaseId))];
      if (releaseIds.length > 1) return `Files of album ${album.id} must be on one release`;
      for (const releaseId of releaseIds) {
        if (!(album.releases ?? []).some((release) => release.id === releaseId)) {
          return `Release ${releaseId} is not a release of album ${album.id}`;
        }
        const tracks = await client.getReleaseTracks(releaseId);
        const requested = [...new Set(albumFiles.filter((file) => file.albumReleaseId === releaseId).flatMap((file) => file.trackIds))];
        const owned = checkOwnership(requested, tracks);
        if (!owned.ok) return `Track id(s) not on release ${releaseId}: ${owned.missing.join(', ')}`;
      }
    }
  }
  return null;
}

/**
 * Retrieve manual import data for a download from Sonarr, Radarr or Lidarr.
 *
 * Reads `downloadId` and `source` from the request query string, validates them,
 * and returns the manual import data from the corresponding service.
 *
 * @param request - Incoming HTTP request; expects query params:
 *   - `downloadId`: identifier of the download to look up (required)
 *   - `source`: `"sonarr"`, `"radarr"` or `"lidarr"` (required)
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
    const source = searchParams.get('source') as Source;
    const instanceId = searchParams.get('instanceId') ?? undefined;

    if (!downloadId) {
      return NextResponse.json(
        { error: 'downloadId is required' },
        { status: 400 }
      );
    }

    if (!source || !SOURCES.includes(source)) {
      return NextResponse.json(
        { error: 'source parameter is required and must be "sonarr", "radarr" or "lidarr"' },
        { status: 400 }
      );
    }

    if (source === 'lidarr') {
      const lidarr = await getLidarrClient(instanceId);
      return NextResponse.json(await lidarr.getManualImport(downloadId));
    } else if (source === 'sonarr') {
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

    if (!source || !SOURCES.includes(source)) {
      return NextResponse.json(
        { error: 'source is required and must be "sonarr", "radarr" or "lidarr"' },
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
    if (new Set(files.map((file) => file.path)).size !== files.length) {
      return NextResponse.json({ error: 'Each file can be imported once' }, { status: 400 });
    }

    const isSonarr = source === 'sonarr';
    const isLidarr = source === 'lidarr';
    const lidarrFiles = isLidarr ? files.map(parseLidarrFile) : [];
    if (lidarrFiles.some((file) => file === null)) {
      return NextResponse.json(
        { error: 'Each file needs an artistId, albumId, albumReleaseId and trackIds' },
        { status: 400 }
      );
    }
    const lidarr = isLidarr ? await getLidarrClient(instanceId) : null;
    const client = lidarr ?? (isSonarr ? await getSonarrClient(instanceId) : await getRadarrClient(instanceId));

    // Path guard: ask the *arr again which files this download holds, and take
    // only those. Without it a request could name any file the *arr can reach
    // and have it moved into the library.
    const scanned: ManualImportItem[] = await client.getManualImport(downloadId);
    const listed = new Set(scanned.map((file) => file.path));
    if (files.some((file) => !listed.has(file.path))) {
      return NextResponse.json(
        { error: 'Some files are no longer part of this download. Reload and try again.' },
        { status: 409 }
      );
    }

    if (lidarr) {
      const ownershipError = await lidarrOwnershipError(lidarr, lidarrFiles as LidarrImportFile[]);
      if (ownershipError) return NextResponse.json({ error: ownershipError }, { status: 400 });
    }

    let command: { id?: number } | null = null;
    let errorMessage: string | null = null;
    const startedAt = new Date();
    try {
      if (lidarr) {
        // Only the fields Lidarr's import reads. Lidarr needs a quality on every
        // file; the scan always has one, so it fills a missing one in.
        const qualityByPath = new Map(scanned.map((file) => [file.path, file.quality]));
        command = await lidarr.submitManualImport((lidarrFiles as LidarrImportFile[]).map((file) => ({
          ...file,
          quality: hasValidQuality(file.quality) ? file.quality : qualityByPath.get(file.path),
        })), 'auto');
      } else {
        command = await client.submitManualImport(files);
      }
    } catch (error) {
      errorMessage = (error instanceof Error && error.message) || 'Failed to submit import';
    }
    // Queued means the *arr answered with a command to follow.
    const queued = command?.id != null && !errorMessage;

    // A pack can span several series (or albums), so the row names one only when all files agree.
    const mediaIds = [...new Set(files.map((file) => coercePositiveInt(isLidarr ? file.albumId : isSonarr ? file.seriesId : file.movieId)))];
    await recordOperationAudit({
      user: auth.user,
      startedAt,
      service: isLidarr ? 'LIDARR' : isSonarr ? 'SONARR' : 'RADARR',
      instanceId,
      operation: 'IMPORT',
      targetType: isLidarr ? 'album' : isSonarr ? 'series' : 'movie',
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
