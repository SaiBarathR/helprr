import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { coercePositiveInt } from '@/lib/manage-files-guard';
import type { ExtraFileResource } from '@/types';

const EXTRA_TYPES = new Set(['subtitle', 'metadata', 'other']);

/** One extra file rebuilt from the fields the page shows; anything else Radarr adds stays out. */
function toExtraFile(raw: unknown): ExtraFileResource | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = coercePositiveInt(o.id);
  if (!id || typeof o.relativePath !== 'string') return null;
  const file: ExtraFileResource = {
    id,
    relativePath: o.relativePath,
    type: typeof o.type === 'string' && EXTRA_TYPES.has(o.type) ? o.type as ExtraFileResource['type'] : 'other',
  };
  const movieFileId = coercePositiveInt(o.movieFileId);
  if (movieFileId) file.movieFileId = movieFileId;
  if (typeof o.extension === 'string') file.extension = o.extension;
  if (typeof o.title === 'string' && o.title) file.title = o.title;
  if (Array.isArray(o.languageTags)) {
    const tags = o.languageTags.filter((tag): tag is string => typeof tag === 'string');
    if (tags.length > 0) file.languageTags = tags;
  }
  return file;
}

// ── GET /api/radarr/extrafile?movieId= ──────────────────────────────────────
// The subtitles, .nfo and images next to a movie's file. Paths are relative to
// the movie folder. Sonarr has no such endpoint (v4 answers 404), so series have no twin.
async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('movies.view');
  if (!auth.ok) return auth.response;

  try {
    const movieId = coercePositiveInt(request.nextUrl.searchParams.get('movieId'));
    if (!movieId) {
      return NextResponse.json({ error: 'A valid movieId is required' }, { status: 400 });
    }
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getRadarrClient(instanceId);
    const files = await client.getExtraFiles(movieId);
    return NextResponse.json(
      (Array.isArray(files) ? files : []).map(toExtraFile).filter((f): f is ExtraFileResource => f !== null),
    );
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch extra files');
  }
}

export const GET = withApiLogging(getHandler, 'api/radarr/extrafile');
