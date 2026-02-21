import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const client = await getJellyfinClient();
    const items = await client.getRecentlyAdded({ limit });
    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch recently added';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
