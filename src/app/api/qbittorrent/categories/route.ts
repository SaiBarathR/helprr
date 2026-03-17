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
