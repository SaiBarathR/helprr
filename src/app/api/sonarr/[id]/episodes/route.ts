import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const includeEpisodeFile = searchParams.get('includeEpisodeFile') === 'true';
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getSonarrClient(instanceId);
    const episodes = await client.getEpisodes(Number(id), includeEpisodeFile);
    return NextResponse.json(episodes);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch episodes');
  }
}

export const GET = withApiLogging(getHandler, 'api/sonarr/[id]/episodes');
