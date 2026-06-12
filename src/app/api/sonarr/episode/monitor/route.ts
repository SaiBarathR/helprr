import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function putHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('series.editMonitoring');
  if (capError) return capError;

  try {
    const body = await request.json();
    const { episodeIds, monitored } = body;

    if (
      !Array.isArray(episodeIds) ||
      episodeIds.length === 0 ||
      !episodeIds.every((id) => Number.isInteger(id) && id > 0) ||
      typeof monitored !== 'boolean'
    ) {
      return NextResponse.json(
        { error: 'episodeIds must be a non-empty array of positive integers and monitored a boolean' },
        { status: 400 }
      );
    }

    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getSonarrClient(instanceId);
    // Sonarr's /episode/monitor endpoint accepts all IDs in one call.
    const results = await client.setEpisodesMonitored(episodeIds, monitored);

    return NextResponse.json(results);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update episode monitoring';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const PUT = withApiLogging(putHandler, 'api/sonarr/episode/monitor');
