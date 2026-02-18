import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';

export async function GET() {
  try {
    const client = await getProwlarrClient();
    const indexers = await client.getIndexers();
    return NextResponse.json(indexers);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch indexers';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const client = await getProwlarrClient();

    if (body.action === 'testall') {
      const result = await client.testAllIndexers();
      return NextResponse.json(result);
    }

    // Otherwise treat as add indexer
    const indexer = await client.addIndexer(body);
    return NextResponse.json(indexer);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to perform action';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
