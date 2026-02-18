import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate') ?? undefined;
    const client = await getProwlarrClient();
    const stats = await client.getIndexerStats(startDate ? { startDate } : {});
    return NextResponse.json(stats);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch indexer stats';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
