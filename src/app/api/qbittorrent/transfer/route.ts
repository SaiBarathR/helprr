import { NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { logApiDuration } from '@/lib/server-perf';

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;
  const startedAt = performance.now();

  try {
    const client = await getQBittorrentClient();
    const info = await client.getTransferInfo();
    logApiDuration('/api/qbittorrent/transfer', startedAt, { method: 'GET' });
    return NextResponse.json(info);
  } catch (error) {
    console.error('Failed to fetch transfer info:', error);
    logApiDuration('/api/qbittorrent/transfer', startedAt, { method: 'GET', failed: true });
    return NextResponse.json(
      { error: 'Failed to fetch transfer info' },
      { status: 500 }
    );
  }
}
