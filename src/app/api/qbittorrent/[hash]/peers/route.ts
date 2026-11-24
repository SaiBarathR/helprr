import { NextRequest, NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { peerDeltaHistory } from '@/lib/cache/qbittorrent-peer-delta';
import { parsePeerAddresses, peersForViewer, seesPeerAddresses } from '@/lib/qbittorrent-peers';

// A v1 info hash (SHA-1) or a v2 one (SHA-256), in hex: not qBittorrent's `all` or a `|` list.
const SINGLE_TORRENT_HASH = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;

const CURSOR = /^[a-f0-9]{64}$/;

/**
 * One torrent's peers, or what changed since the list the page's `cursor`
 * names (src/lib/cache/qbittorrent-peer-delta.ts). Under torrents.view; the
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
    const cursorParam = request.nextUrl.searchParams.get('cursor');
    const cursor = cursorParam && CURSOR.test(cursorParam) ? cursorParam : undefined;
    const seesAddress = seesPeerAddresses(auth.user);
    const client = await getQBittorrentClient();
    const [sync, listed] = await Promise.all([
      client.getTorrentPeers(hash, request.signal),
      // Whether it is private, for the page's first request: it decides who may add peers (below).
      cursor ? null : client.getTorrents(undefined, undefined, undefined, undefined, hash, request.signal).catch(() => null),
    ]);
    // The history is per user and torrent, and per view, so a cursor never crosses into another's list.
    const scope = `${auth.user.id}:${hash.toLowerCase()}:${seesAddress ? 'addresses' : 'no-addresses'}`;
    const delta = peerDeltaHistory.response(scope, cursor, peersForViewer(hash, sync, seesAddress));
    if (!cursor) {
      const torrent = listed?.find((entry) => entry.hash.toLowerCase() === hash.toLowerCase());
      delta.private = typeof torrent?.private === 'boolean' ? torrent.private : null;
    }

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
 * settings (a private torrent's: an admin's only, see below). Nothing is
 * deleted or banned, so it is logged, not operation-audited.
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
    // A private torrent is shared only with its tracker's peers: one added by
    // hand gets the content (private trackers ban for that), which is why
    // qBittorrent offers no Add Peers for one. As for its trackers, it is an
    // admin's call; when qBittorrent doesn't say (4.x), it counts as private.
    if (auth.user.role !== 'admin') {
      const [info] = await client.getTorrents(undefined, undefined, undefined, undefined, hash, request.signal);
      if (!info) return refuse(404, 'Torrent not found', 'missing');
      if (info.private !== false) return refuse(403, 'Only an admin can add peers to a private torrent', 'private');
    }
    const result = await client.addPeers(hash, parsed.peers);
    if (result === 'missing') return refuse(404, 'Torrent not found', 'missing');
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
