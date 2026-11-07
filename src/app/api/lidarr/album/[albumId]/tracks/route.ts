import { NextRequest, NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

function parsePositiveId(id: string): { value: number } | { error: NextResponse } {
  const parsed = Number(id);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { error: NextResponse.json({ error: 'Invalid album id' }, { status: 400 }) };
  }
  return { value: parsed };
}

async function getHandler(
  request: NextRequest,
  { params }: { params: Promise<{ albumId: string }> }
) {
  const auth = await requireUserCapability('music.view');
  if (!auth.ok) return auth.response;

  try {
    const { albumId } = await params;
    const parsed = parsePositiveId(albumId);
    if ('error' in parsed) return parsed.error;
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    // ?albumReleaseId= lists that release's tracks instead of the album's chosen
    // release: manual import picks tracks on the release Lidarr matched.
    const releaseParam = request.nextUrl.searchParams.get('albumReleaseId');
    const client = await getLidarrClient(instanceId);
    if (releaseParam !== null) {
      const release = parsePositiveId(releaseParam);
      if ('error' in release) return NextResponse.json({ error: 'Invalid release id' }, { status: 400 });
      return NextResponse.json(await client.getReleaseTracks(release.value));
    }
    const tracks = await client.getTracks(parsed.value);
    return NextResponse.json(tracks);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch tracks');
  }
}

export const GET = withApiLogging(getHandler, 'api/lidarr/album/[albumId]/tracks');
