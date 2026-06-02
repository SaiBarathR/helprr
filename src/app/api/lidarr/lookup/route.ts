import { NextRequest, NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import type { LidarrArtistLookupResult } from '@/types';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const term = searchParams.get('term');
    const type = searchParams.get('type'); // 'album' to search albums; default = artist
    if (!term) {
      return NextResponse.json({ error: 'Missing search term' }, { status: 400 });
    }
    const client = await getLidarrClient();

    if (type === 'album') {
      const results = await client.lookupAlbum(term);
      return NextResponse.json(results);
    }

    const results = await client.lookupArtist(term);
    const annotated: LidarrArtistLookupResult[] = results.map((artist) => ({
      ...artist,
      library: (typeof artist.id === 'number' && artist.id > 0)
        ? { exists: true, id: artist.id }
        : { exists: false },
    }));
    return NextResponse.json(annotated);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to lookup music';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/lidarr/lookup');
