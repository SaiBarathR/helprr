import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient, getRadarrClient } from '@/lib/service-helpers';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source') as 'sonarr' | 'radarr';
    const removeFromClient = searchParams.get('removeFromClient') === 'true';
    const blocklist = searchParams.get('blocklist') === 'true';

    if (!source || !['sonarr', 'radarr'].includes(source)) {
      return NextResponse.json(
        { error: 'source parameter is required and must be "sonarr" or "radarr"' },
        { status: 400 }
      );
    }

    const queueId = parseInt(id, 10);
    if (isNaN(queueId)) {
      return NextResponse.json(
        { error: 'Invalid queue item ID' },
        { status: 400 }
      );
    }

    if (source === 'sonarr') {
      const sonarr = await getSonarrClient();
      await sonarr.deleteQueueItem(queueId, { removeFromClient, blocklist });
    } else {
      const radarr = await getRadarrClient();
      await radarr.deleteQueueItem(queueId, { removeFromClient, blocklist });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete queue item:', error);
    return NextResponse.json(
      { error: 'Failed to delete queue item' },
      { status: 500 }
    );
  }
}
