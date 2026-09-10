import { NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler() {
  const auth = await requireUserCapability('torrents.view');
  if (!auth.ok) return auth.response;
  const startedAt = performance.now();

  try {
    const client = await getQBittorrentClient();
    const categories = await client.getCategories();
    logApiDuration('/api/qbittorrent/categories', startedAt, { method: 'GET' });
    return NextResponse.json(categories);
  } catch (error) {
    console.error('Failed to fetch categories:', error);
    logApiDuration('/api/qbittorrent/categories', startedAt, { method: 'GET', failed: true });
    return NextResponse.json(
      { error: 'Failed to fetch categories' },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler, 'api/qbittorrent/categories');
