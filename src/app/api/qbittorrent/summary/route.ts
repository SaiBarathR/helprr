import { NextRequest, NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import type { QBittorrentSummaryResponse } from '@/types';
import { logApiDuration } from '@/lib/server-perf';

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const startedAt = performance.now();

  try {
    const client = await getQBittorrentClient();
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter') || undefined;
    const category = searchParams.get('category') || undefined;
    const sort = searchParams.get('sort') || undefined;
    const reverse = searchParams.get('reverse') === 'true' ? true : undefined;

    const [torrents, transferInfo] = await Promise.all([
      client.getTorrents(filter, category, sort, reverse),
      client.getTransferInfo().catch(() => null),
    ]);

    const payload: QBittorrentSummaryResponse = {
      torrents,
      transferInfo,
    };

    logApiDuration('/api/qbittorrent/summary', startedAt, {
      torrentCount: torrents.length,
      filter: filter || 'all',
    });

    return NextResponse.json(payload);
  } catch (error) {
    console.error('Failed to fetch qBittorrent summary:', error);
    logApiDuration('/api/qbittorrent/summary', startedAt, { failed: true });
    return NextResponse.json(
      { error: 'Failed to fetch qBittorrent summary' },
      { status: 500 }
    );
  }
}
