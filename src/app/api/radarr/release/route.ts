import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { grabErrorResponse, parseRadarrGrab } from '@/lib/arr-grab';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('activity.manage');
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const movieId = searchParams.get('movieId');

    if (!movieId || !/^\d+$/.test(movieId)) {
      return NextResponse.json(
        { error: 'movieId must be a positive integer' },
        { status: 400 }
      );
    }
    const movieIdNum = Number(movieId);
    if (!Number.isInteger(movieIdNum) || movieIdNum <= 0) {
      return NextResponse.json(
        { error: 'movieId must be a positive integer' },
        { status: 400 }
      );
    }

    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getRadarrClient(instanceId);
    const releases = await client.getReleases(movieIdNum);
    return NextResponse.json(releases);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to search releases');
  }
}

/**
 * Grabs a release from the last interactive search. The body is one of the
 * shapes `parseRadarrGrab` accepts: plain `{ guid, indexerId }`, with the
 * searched movie (`movieId`) for a release Radarr couldn't match, or a Manual
 * grab (`shouldOverride`), each with
 * an optional `downloadClientId`. 400 for anything else; known Radarr refusals
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
  const parsed = parseRadarrGrab(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getRadarrClient(instanceId);
    await client.grabRelease(parsed.request);
    return NextResponse.json({ success: true });
  } catch (error) {
    return grabErrorResponse(error, 'radarr');
  }
}

export const GET = withApiLogging(getHandler, 'api/radarr/release');
export const POST = withApiLogging(postHandler, 'api/radarr/release');
