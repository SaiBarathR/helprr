import { NextRequest, NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { parsePeerAddresses, peersForViewer, seesPeerAddresses } from '@/lib/qbittorrent-peers';

// A v1 info hash (SHA-1) or a v2 one (SHA-256), in hex: not qBittorrent's `all` or a `|` list.
const SINGLE_TORRENT_HASH = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;

/**
 * One torrent's peers, since `rid` when the page has one (qBittorrent sends a
 * full list when it doesn't know that rid any more). Under torrents.view; the
 * addresses only for an admin (src/lib/qbittorrent-peers.ts).
 */
async function getHandler(
  request: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const auth = await requireUserCapability('torrents.view');
  if (!auth.ok) return auth.response;
  const startedAt = performance.now();

  try {
    const { hash } = await params;
    if (!SINGLE_TORRENT_HASH.test(hash)) {
      return NextResponse.json({ error: 'Invalid torrent hash' }, { status: 400 });
    }
    const ridParam = request.nextUrl.searchParams.get('rid') ?? '0';
    const rid = /^\d{1,7}$/.test(ridParam) ? Number(ridParam) : 0;
    const client = await getQBittorrentClient();
    const sync = await client.getTorrentPeers(hash, rid, request.signal);
    const delta = peersForViewer(hash, sync, seesPeerAddresses(auth.user));

    logApiDuration('/api/qbittorrent/[hash]/peers', startedAt, {
      method: 'GET',
      fullUpdate: delta.fullUpdate,
      peerCount: Object.keys(delta.peers).length,
    });
    return NextResponse.json(delta);
  } catch (error) {
    logApiDuration('/api/qbittorrent/[hash]/peers', startedAt, { method: 'GET', failed: true });
    return upstreamErrorResponse(error, 'Failed to fetch peers');
  }
}

/**
 * Add peers to one torrent by `ip:port`, under torrents.manage like its other
 * settings. Nothing is deleted or banned, so it is logged, not operation-audited.
 */
async function postHandler(
  request: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const auth = await requireUserCapability('torrents.manage');
  if (!auth.ok) return auth.response;
  const startedAt = performance.now();

  const refuse = (status: number, error: string, reason: string) => {
    logApiDuration('/api/qbittorrent/[hash]/peers', startedAt, { method: 'POST', refused: reason });
    return NextResponse.json({ error }, { status });
  };

  try {
    const { hash } = await params;
    if (!SINGLE_TORRENT_HASH.test(hash)) return refuse(400, 'Invalid torrent hash', 'hash');
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return refuse(400, 'malformed JSON', 'json');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return refuse(400, 'malformed JSON', 'json');
    const parsed = parsePeerAddresses((body as Record<string, unknown>).peers);
    if (!parsed.ok) return refuse(400, parsed.error, 'peers');

    const client = await getQBittorrentClient();
    const result = await client.addPeers(hash, parsed.peers);
    logApiDuration('/api/qbittorrent/[hash]/peers', startedAt, {
      method: 'POST',
      peerCount: parsed.peers.length,
      added: result?.added,
      failed: result?.failed,
    });
    return NextResponse.json({ requested: parsed.peers.length, added: result?.added ?? null, failed: result?.failed ?? null });
  } catch (error) {
    logApiDuration('/api/qbittorrent/[hash]/peers', startedAt, { method: 'POST', failed: true });
    return upstreamErrorResponse(error, 'Failed to add peers');
  }
}

export const GET = withApiLogging(getHandler, 'api/qbittorrent/[hash]/peers');
// The addresses are personal data: never in the failed-request body log.
export const POST = withApiLogging(postHandler, 'api/qbittorrent/[hash]/peers', { logBodies: false });
