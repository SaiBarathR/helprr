import { NextRequest, NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { hash } = await params;
    const body = await request.json();
    const client = await getQBittorrentClient();

    switch (body.action) {
      case 'pause':
        await client.pauseTorrent(hash);
        break;
      case 'resume':
        await client.resumeTorrent(hash);
        break;
      case 'delete':
        await client.deleteTorrent(hash, body.deleteFiles ?? false);
        break;
      case 'forceStart':
        await client.forceStartTorrent(hash);
        break;
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    );
  }
}
