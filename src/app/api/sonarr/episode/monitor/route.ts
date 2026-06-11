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

    if (!episodeIds || typeof monitored !== 'boolean') {
      return NextResponse.json(
        { error: 'Missing episodeIds or monitored field' },
        { status: 400 }
      );
    }

    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getSonarrClient(instanceId);
    // setEpisodeMonitored accepts a single ID; iterate for multiple
    const results = [];
    for (const id of episodeIds) {
      const result = await client.setEpisodeMonitored(id, monitored);
      results.push(...result);
    }

    return NextResponse.json(results);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update episode monitoring';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const PUT = withApiLogging(putHandler, 'api/sonarr/episode/monitor');
