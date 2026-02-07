import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const includeEpisodeFile = searchParams.get('includeEpisodeFile') === 'true';
    const client = await getSonarrClient();
    const episodes = await client.getEpisodes(Number(id), includeEpisodeFile);
    return NextResponse.json(episodes);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch episodes';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
