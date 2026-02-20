import { NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const client = await getJellyfinClient();
    const item = await client.getItem(id);
    return NextResponse.json({ item });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch Jellyfin item';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
