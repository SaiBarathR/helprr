import { NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';

export async function GET() {
  try {
    const client = await getProwlarrClient();
    const schemas = await client.getIndexerSchemas();
    return NextResponse.json(schemas);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch indexer schemas';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
