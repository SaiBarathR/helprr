import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUserAllCapabilities } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { withApiLogging } from '@/lib/api-logger';
import { cancelManualDownload, ManualDownloadCancelError } from '@/lib/manual-downloads/cancel';
import { TORRENT_DELETE_REFUSALS, TorrentDeleteUnconfirmedError } from '@/lib/file-audit';

/**
 * Cancel a manual download: remove it from its Arr instance's queue and, when
 * asked, its torrent and data (torrents.delete) or the title it added
 * (movies.delete / series.delete, only while it has no files).
 */
async function postHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUserAllCapabilities(['activity.manage']);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const options = {
    removeFromClient: body?.removeFromClient === true,
    blocklist: body?.blocklist === true,
    removeTitle: body?.removeTitle === true,
  };
  const download = await prisma.manualDownload.findUnique({ where: { id } });
  if (!download) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // Destructive choices need their own capabilities.
  if (options.removeFromClient && !can(auth.user, 'torrents.delete')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (options.removeTitle && !can(auth.user, download.service === 'RADARR' ? 'movies.delete' : 'series.delete')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const message = await cancelManualDownload(download, options, { id: auth.user.id, username: auth.user.username });
    return NextResponse.json({ ok: true, message });
  } catch (error) {
    if (error instanceof ManualDownloadCancelError) return NextResponse.json({ error: error.message }, { status: 409 });
    // qBittorrent acknowledged the delete but still lists the torrent: say so, as the torrent page does.
    if (error instanceof TorrentDeleteUnconfirmedError) {
      return NextResponse.json({ error: TORRENT_DELETE_REFUSALS.unconfirmed.error }, { status: TORRENT_DELETE_REFUSALS.unconfirmed.status });
    }
    console.error('[manual-downloads] cancel failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'The download could not be cancelled.' }, { status: 502 });
  }
}

export const POST = withApiLogging(postHandler, 'api/manual-downloads/[id]/cancel');
