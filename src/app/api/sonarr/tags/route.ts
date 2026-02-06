import { NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';

export async function GET() {
  try {
    const client = await getSonarrClient();
    const tags = await client.getTags();
    return NextResponse.json(tags);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch tags';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
