import { NextRequest, NextResponse } from 'next/server';
import { isAxiosError } from 'axios';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { qbittorrentInstanceOf } from '@/lib/server/qbittorrent-instance';
import { requireAdmin } from '@/lib/auth';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { parseTorrentInfoHash, TorrentParseError } from '@/lib/torrent-metainfo';
import { torrentExportDisposition } from '@/lib/torrent-export-name';

// A v1 info hash (SHA-1) or a v2 one (SHA-256), in hex: not qBittorrent's `all` or a `|` list.
const SINGLE_TORRENT_HASH = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
// The add route's bound on a .torrent; real ones are kilobytes to a few MB.
const MAX_EXPORT_BYTES = 25 * 1024 * 1024;

/**
 * The torrent's .torrent file, as a download named after the torrent. Admins
 * only: the file carries the full announce URLs, a private tracker's passkey
 * among them, which anyone else is never shown (see qbittorrent-tracker-links).
 * Nothing is cached: no-store here, and the service worker leaves /api reads
 * to the network.
 */
async function getHandler(
  request: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const instance = await qbittorrentInstanceOf(request);
  if (!instance.ok) return instance.response;
  const startedAt = performance.now();

  try {
    const { hash } = await params;
    if (!SINGLE_TORRENT_HASH.test(hash)) {
      return NextResponse.json({ error: 'Invalid torrent hash' }, { status: 400 });
    }
    const client = await getQBittorrentClient(instance.instanceId);

    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = await client.exportTorrent(hash, MAX_EXPORT_BYTES, request.signal);
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 409) {
        logApiDuration('/api/qbittorrent/[hash]/export', startedAt, { method: 'GET', noMetadata: true });
        return NextResponse.json(
          { error: 'qBittorrent has no .torrent file for it until its metadata has downloaded' },
          { status: 409 },
        );
      }
      throw error;
    }
    // Whatever came back is handed over as a .torrent only if it is one.
    try {
      parseTorrentInfoHash(bytes);
    } catch (error) {
      if (!(error instanceof TorrentParseError)) throw error;
      logApiDuration('/api/qbittorrent/[hash]/export', startedAt, { method: 'GET', notTorrent: true });
      return NextResponse.json({ error: 'qBittorrent did not give a .torrent file' }, { status: 502 });
    }

    // The name as qBittorrent lists it (a rename included); the hash without one.
    const listed = await client.getTorrents(undefined, undefined, undefined, undefined, hash, request.signal).catch(() => []);
    const name = listed.find((entry) => entry.hash.toLowerCase() === hash.toLowerCase())?.name;

    logApiDuration('/api/qbittorrent/[hash]/export', startedAt, { method: 'GET', bytes: bytes.byteLength });
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': 'application/x-bittorrent',
        'Content-Disposition': torrentExportDisposition(name, hash),
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    logApiDuration('/api/qbittorrent/[hash]/export', startedAt, { method: 'GET', failed: true });
    return upstreamErrorResponse(error, 'Failed to export the torrent');
  }
}

export const GET = withApiLogging(getHandler, 'api/qbittorrent/[hash]/export');
