import { NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';

export async function GET() {
  try {
    const client = await getJellyfinClient();
    const counts = await client.getItemCounts();
    return NextResponse.json({ counts });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch item counts';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
