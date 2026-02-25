import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import type { SonarrLookupResult } from '@/types';

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const term = searchParams.get('term');
    if (!term) {
      return NextResponse.json({ error: 'Missing search term' }, { status: 400 });
    }
    const client = await getSonarrClient();
    const results = await client.lookupSeries(term);
    const annotatedResults: SonarrLookupResult[] = results.map((show) => ({
      ...show,
      library: (typeof show.id === 'number' && show.id > 0)
        ? { exists: true, type: 'series', id: show.id }
        : { exists: false },
    }));
    return NextResponse.json(annotatedResults);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to lookup series';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
