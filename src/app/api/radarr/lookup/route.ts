import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import type { RadarrLookupResult } from '@/types';

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const term = searchParams.get('term');
    if (!term) {
      return NextResponse.json({ error: 'Missing search term' }, { status: 400 });
    }
    const client = await getRadarrClient();
    const results = await client.lookupMovie(term);
    const annotatedResults: RadarrLookupResult[] = results.map((movie) => ({
      ...movie,
      library: (typeof movie.id === 'number' && movie.id > 0)
        ? { exists: true, type: 'movie', id: movie.id }
        : { exists: false },
    }));
    return NextResponse.json(annotatedResults);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to lookup movie';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
