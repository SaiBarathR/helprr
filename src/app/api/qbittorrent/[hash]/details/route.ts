import { NextRequest, NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { logApiDuration } from '@/lib/server-perf';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;
  const startedAt = performance.now();

  try {
    const { hash } = await params;
    const client = await getQBittorrentClient();

    const [properties, files, trackers] = await Promise.all([
      client.getTorrentProperties(hash),
      client.getTorrentFiles(hash),
      client.getTorrentTrackers(hash),
    ]);

    logApiDuration('/api/qbittorrent/[hash]/details', startedAt, {
      method: 'GET',
      fileCount: files.length,
      trackerCount: trackers.length,
    });
    return NextResponse.json({ properties, files, trackers });
  } catch (error) {
    logApiDuration('/api/qbittorrent/[hash]/details', startedAt, { method: 'GET', failed: true });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch torrent details' },
      { status: 500 }
    );
  }
}
