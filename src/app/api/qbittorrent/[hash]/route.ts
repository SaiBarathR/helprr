import { NextRequest, NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireAuth, requireUserCapability } from '@/lib/auth';
import type { Capability } from '@/lib/capabilities';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';
import { bumpQbitCacheVersion } from '@/lib/cache/qbittorrent-version';
import { upstreamErrorResponse } from '@/lib/api-error';
import { runWithOperationAudit, snapshotTorrentDeleteTargets } from '@/lib/file-audit';

// Per-action capability: delete is the most destructive, bandwidth-limit changes
// are their own grant, everything else is general torrent management.
function actionCapability(action: unknown): Capability | null {
  switch (action) {
    case 'delete':
      return 'torrents.delete';
    case 'setDownloadLimit':
    case 'setUploadLimit':
    case 'setShareLimits':
      return 'torrents.bandwidth';
    case 'pause':
    case 'stop':
    case 'resume':
    case 'start':
    case 'forceStart':
    case 'toggleSequentialDownload':
    case 'toggleFirstLastPiecePrio':
    case 'setCategory':
    case 'recheck':
    case 'reannounce':
    case 'setAutoManagement':
    case 'rename':
      return 'torrents.manage';
    default:
      return null; // unknown/unmapped action → rejected up front (deny-by-default)
  }
}

async function postHandler(
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

    // Deny-by-default: an action with no capability mapping is rejected here
    // rather than reaching the dispatch switch, so a new action added below
    // without a matching capability entry can never run unchecked.
    const requiredCap = actionCapability(action);
    if (!requiredCap) {
      logApiDuration('/api/qbittorrent/[hash]', startedAt, { method: 'POST', action, invalidAction: true });
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
    const auth = await requireUserCapability(requiredCap);
    if (!auth.ok) return auth.response;

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
      case 'delete': {
        const deleteFiles = body.deleteFiles === true;
        const snapshot = await snapshotTorrentDeleteTargets(client, hash);
        await runWithOperationAudit({
          user: auth.user,
          service: 'QBITTORRENT',
          operation: 'DELETE_TORRENT',
          targetType: 'torrent',
          targetTitle: snapshot.targetTitle,
          itemCount: snapshot.itemCount,
          filesDeleted: deleteFiles,
          details: { ...snapshot.details, deleteFiles },
        }, () => client.deleteTorrent(hash, deleteFiles));
        break;
      }
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

    // Bust the summary cache so post-action refetches see post-action state.
    await bumpQbitCacheVersion();
    logApiDuration('/api/qbittorrent/[hash]', startedAt, { method: 'POST', action });
    return NextResponse.json({ success: true });
  } catch (error) {
    logApiDuration('/api/qbittorrent/[hash]', startedAt, { method: 'POST', action, failed: true });
    return upstreamErrorResponse(error, 'Failed');
  }
}

export const POST = withApiLogging(postHandler, 'api/qbittorrent/[hash]');
