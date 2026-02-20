import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { normalizePlaybackPayload } from '@/app/api/jellyfin/playback/shared';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const payload = normalizePlaybackPayload(body);

    if (!payload.ItemId) {
      return NextResponse.json({ error: 'ItemId is required' }, { status: 400 });
    }

    if (payload.Failed == null) {
      payload.Failed = false;
    }

    const client = await getJellyfinClient();
    await client.reportPlaybackStop(payload);

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to report playback stop';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
