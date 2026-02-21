import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30', 10);
    const d = new Date();
    const endDate = searchParams.get('endDate') ||
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const client = await getJellyfinClient();
    const movies = await client.getMoviesReport(days, endDate);
    return NextResponse.json({ movies: movies ?? [], pluginAvailable: movies !== null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch movies report';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
