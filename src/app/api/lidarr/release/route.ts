import { NextRequest, NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireUserAllCapabilities } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { parseLidarrGrab } from '@/lib/arr-grab';
import { arrReleaseScope, resolveReleaseToken, withReleaseTokens } from '@/lib/release-tokens';

function toPositiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function getHandler(request: NextRequest) {
  // Lidarr's items are music: managing them also needs music.view, as in Activity.
  const auth = await requireUserAllCapabilities(['activity.manage', 'music.view']);
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const albumId = searchParams.get('albumId');
    const artistId = searchParams.get('artistId');

    if (!albumId && !artistId) {
      return NextResponse.json({ error: 'albumId or artistId is required' }, { status: 400 });
    }

    const params: { albumId?: number; artistId?: number } = {};
    if (albumId) {
      const parsed = toPositiveInt(albumId);
      if (parsed === null) {
        return NextResponse.json({ error: 'albumId must be a positive integer' }, { status: 400 });
      }
      params.albumId = parsed;
    } else {
      const parsed = toPositiveInt(artistId);
      if (parsed === null) {
        return NextResponse.json({ error: 'artistId must be a positive integer' }, { status: 400 });
      }
      params.artistId = parsed;
    }

    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getLidarrClient(instanceId);
    const releases = await client.getReleases(params);
    // The browser gets a token per release, not its guid: a guid can be a download link with a passkey.
    return NextResponse.json(await withReleaseTokens(await arrReleaseScope('lidarr', instanceId), auth.user.id, releases));
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to search releases');
  }
}

async function postHandler(request: NextRequest) {
  // Lidarr's items are music: managing them also needs music.view, as in Activity.
  const auth = await requireUserAllCapabilities(['activity.manage', 'music.view']);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  // The same checks as Sonarr's and Radarr's grabs: a bounded token, ids that are whole numbers.
  const parsed = parseLidarrGrab(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    // A token from this user's search here (release-tokens); gone after 30 minutes, like the *arr's own cache.
    const release = await resolveReleaseToken(await arrReleaseScope('lidarr', instanceId), auth.user.id, parsed.request.guid);
    if (!release) return NextResponse.json({ error: 'This result has expired. Search again.', code: 'expired' }, { status: 410 });
    const client = await getLidarrClient(instanceId);
    await client.grabRelease(release.guid, release.indexerId, parsed.request.downloadClientId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to grab release');
  }
}

export const GET = withApiLogging(getHandler, 'api/lidarr/release');
export const POST = withApiLogging(postHandler, 'api/lidarr/release');
