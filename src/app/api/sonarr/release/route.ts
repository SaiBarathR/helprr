import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { grabErrorResponse, parseSonarrGrab } from '@/lib/arr-grab';

async function getHandler(request: NextRequest) {
  const auth = await requireUserCapability('activity.manage');
  if (!auth.ok) return auth.response;

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
 * Grabs a release from the last interactive search. The body is one of the
 * shapes `parseSonarrGrab` accepts: plain `{ guid, indexerId }`, with the
 * searched episode (`episodeId`) or season (`seriesId`, `seasonNumber`) for a
 * release Sonarr couldn't match, or a Manual grab (`shouldOverride`), each with
 * an optional `downloadClientId`. 400 for anything else; known Sonarr refusals
 * come back in Helprr's words with a `code` (see `grabErrorResponse`).
 */
async function postHandler(request: NextRequest) {
  const auth = await requireUserCapability('activity.manage');
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = parseSonarrGrab(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getSonarrClient(instanceId);
    await client.grabRelease(parsed.request);
    return NextResponse.json({ success: true });
  } catch (error) {
    return grabErrorResponse(error, 'sonarr');
  }
}

export const GET = withApiLogging(getHandler, 'api/sonarr/release');
export const POST = withApiLogging(postHandler, 'api/sonarr/release');
