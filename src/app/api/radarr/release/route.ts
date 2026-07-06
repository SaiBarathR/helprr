import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('activity.manage');
  if (capError) return capError;

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
 * Trigger grabbing a Radarr release using identifiers supplied in the request body.
 *
 * Expects the request body to be JSON with `guid` (string) and `indexerId` (number) — `downloadClientId` (number) may be provided to select a download client.
 *
 * @param request - The incoming HTTP request whose JSON body contains `{ guid, indexerId, downloadClientId? }`
 * @returns A JSON response: `{ success: true }` on success; otherwise `{ error: string }` with status `400` for missing/invalid input or `500` for internal failures.
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
    const client = await getRadarrClient(instanceId);
    await client.grabRelease(guid, indexerId, downloadClientId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to grab release');
  }
}

export const GET = withApiLogging(getHandler, 'api/radarr/release');
export const POST = withApiLogging(postHandler, 'api/radarr/release');
