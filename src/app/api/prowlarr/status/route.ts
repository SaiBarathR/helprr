import { NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';

export async function GET() {
  try {
    const client = await getProwlarrClient();
    const statuses = await client.getIndexerStatuses();
    return NextResponse.json(statuses);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch indexer statuses';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
