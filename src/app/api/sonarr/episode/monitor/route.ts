import { NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { episodeIds, monitored } = body;

    if (!episodeIds || typeof monitored !== 'boolean') {
      return NextResponse.json(
        { error: 'Missing episodeIds or monitored field' },
        { status: 400 }
      );
    }

    const client = await getSonarrClient();
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
