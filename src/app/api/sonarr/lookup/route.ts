import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const term = searchParams.get('term');
    if (!term) {
      return NextResponse.json({ error: 'Missing search term' }, { status: 400 });
    }
    const client = await getSonarrClient();
    const results = await client.lookupSeries(term);
    return NextResponse.json(results);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to lookup series';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
