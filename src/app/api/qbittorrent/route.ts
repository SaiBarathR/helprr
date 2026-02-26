import { NextRequest, NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
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
    const torrents = await client.getTorrents(filter, category, sort, reverse);
    logApiDuration('/api/qbittorrent', startedAt, {
      method: 'GET',
      torrentCount: torrents.length,
      filter: filter || 'all',
    });
    return NextResponse.json(torrents);
  } catch (error) {
    console.error('Failed to fetch torrents:', error);
    logApiDuration('/api/qbittorrent', startedAt, { method: 'GET', failed: true });
    return NextResponse.json(
      { error: 'Failed to fetch torrents' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const startedAt = performance.now();

  try {
    const client = await getQBittorrentClient();
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      if (!file) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 });
      }
      const buffer = new Uint8Array(await file.arrayBuffer());
      const category = formData.get('category') as string | null;
      const savepath = formData.get('savepath') as string | null;
      const paused = formData.get('paused') === 'true';
      await client.addTorrentFile(buffer, file.name, {
        category: category || undefined,
        savepath: savepath || undefined,
        paused,
      });
      logApiDuration('/api/qbittorrent', startedAt, { method: 'POST', mode: 'file' });
      return NextResponse.json({ success: true });
    }

    const body = await request.json();
    if (!body.urls) {
      return NextResponse.json({ error: 'urls (magnet link) is required' }, { status: 400 });
    }
    await client.addMagnet(body.urls, {
      category: body.category,
      savepath: body.savepath,
      paused: body.paused,
    });
    logApiDuration('/api/qbittorrent', startedAt, { method: 'POST', mode: 'magnet' });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to add torrent:', error);
    logApiDuration('/api/qbittorrent', startedAt, { method: 'POST', failed: true });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add torrent' },
      { status: 500 }
    );
  }
}
