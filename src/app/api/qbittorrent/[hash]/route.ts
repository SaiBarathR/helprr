import { NextRequest, NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { logApiDuration } from '@/lib/server-perf';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;
  const startedAt = performance.now();
  let action: unknown;

  try {
    const { hash } = await params;
    const body = await request.json();
    action = body?.action;
    const client = await getQBittorrentClient();

    switch (action) {
      case 'pause':
      case 'stop':
        await client.pauseTorrent(hash);
        break;
      case 'resume':
      case 'start':
        await client.resumeTorrent(hash);
        break;
      case 'delete':
        await client.deleteTorrent(hash, body.deleteFiles ?? false);
        break;
      case 'forceStart':
        await client.forceStartTorrent(hash);
        break;
      case 'setDownloadLimit':
        await client.setTorrentDownloadLimit(hash, body.limit ?? 0);
        break;
      case 'setUploadLimit':
        await client.setTorrentUploadLimit(hash, body.limit ?? 0);
        break;
      case 'toggleSequentialDownload':
        await client.toggleSequentialDownload(hash);
        break;
      case 'toggleFirstLastPiecePrio':
        await client.toggleFirstLastPiecePrio(hash);
        break;
      case 'setCategory':
        await client.setCategory(hash, body.category ?? '');
        break;
      case 'setShareLimits':
        await client.setShareLimits(hash, body.ratioLimit ?? -2, body.seedingTimeLimit ?? -2, body.inactiveSeedingTimeLimit ?? -2);
        break;
      case 'recheck':
        await client.recheckTorrent(hash);
        break;
      case 'reannounce':
        await client.reannounceTorrent(hash);
        break;
      case 'setAutoManagement':
        await client.setAutoManagement(hash, body.enable ?? false);
        break;
      case 'rename':
        await client.renameTorrent(hash, body.name ?? '');
        break;
      default:
        logApiDuration('/api/qbittorrent/[hash]', startedAt, { method: 'POST', action, invalidAction: true });
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    logApiDuration('/api/qbittorrent/[hash]', startedAt, { method: 'POST', action });
    return NextResponse.json({ success: true });
  } catch (error) {
    logApiDuration('/api/qbittorrent/[hash]', startedAt, { method: 'POST', action, failed: true });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    );
  }
}
