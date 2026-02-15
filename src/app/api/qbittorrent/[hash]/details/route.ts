import { NextRequest, NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  try {
    const { hash } = await params;
    const client = await getQBittorrentClient();

    const [properties, files, trackers] = await Promise.all([
      client.getTorrentProperties(hash),
      client.getTorrentFiles(hash),
      client.getTorrentTrackers(hash),
    ]);

    return NextResponse.json({ properties, files, trackers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch torrent details' },
      { status: 500 }
    );
  }
}
