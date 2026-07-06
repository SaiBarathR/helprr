import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('activity.manage');
  if (capError) return capError;

  try {
    const { searchParams } = new URL(request.url);
    const episodeId = searchParams.get('episodeId');
    const seriesId = searchParams.get('seriesId');
    const seasonNumber = searchParams.get('seasonNumber');

    if (!episodeId && !seriesId) {
      return NextResponse.json({ error: 'episodeId or seriesId is required' }, { status: 400 });
    }

    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getSonarrClient(instanceId);
    const params: { episodeId?: number; seriesId?: number; seasonNumber?: number } = {};
    if (episodeId) {
      params.episodeId = Number(episodeId);
    } else {
      params.seriesId = Number(seriesId);
      if (seasonNumber !== null) {
        params.seasonNumber = Number(seasonNumber);
      }
    }

    const releases = await client.getReleases(params);
    return NextResponse.json(releases);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to search releases');
  }
}

/**
 * Initiates a grab of a Sonarr release using parameters supplied in the request body.
 *
 * Expects a JSON body with `guid` (release identifier) and `indexerId` (indexer identifier); `downloadClientId` may be provided to select a specific download client.
 *
 * @param request - HTTP request whose JSON body must contain:
 *   - `guid`: the release GUID to grab
 *   - `indexerId`: the indexer ID to use for the grab
 *   - `downloadClientId` (optional): the download client ID to route the grab through
 * @returns A NextResponse with `{ success: true }` on success, or `{ error: string }` on failure. Responses use status 400 for missing required fields and 500 for server errors.
 */
async function postHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('activity.manage');
  if (capError) return capError;

  try {
    const body = await request.json();
    const { guid, indexerId, downloadClientId } = body;

    if (!guid || indexerId === undefined) {
      return NextResponse.json({ error: 'guid and indexerId are required' }, { status: 400 });
    }

    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getSonarrClient(instanceId);
    await client.grabRelease(guid, indexerId, downloadClientId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to grab release');
  }
}

export const GET = withApiLogging(getHandler, 'api/sonarr/release');
export const POST = withApiLogging(postHandler, 'api/sonarr/release');
