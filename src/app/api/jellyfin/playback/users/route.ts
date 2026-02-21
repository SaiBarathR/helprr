import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30', 10);
    const endDate = searchParams.get('endDate') || undefined;
    const client = await getJellyfinClient();
    const users = await client.getPlaybackUserActivity(days, endDate);
    return NextResponse.json({ users: users ?? [], pluginAvailable: users !== null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch playback user activity';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
