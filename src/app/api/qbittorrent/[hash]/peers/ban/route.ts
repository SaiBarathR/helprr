import { NextRequest, NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { qbittorrentInstanceOf } from '@/lib/server/qbittorrent-instance';
import { requireAdmin } from '@/lib/auth';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { recordSettingsUpdated } from '@/lib/security-audit';
import { findPeerAddress } from '@/lib/qbittorrent-peers';

// A v1 info hash (SHA-1) or a v2 one (SHA-256), in hex: not qBittorrent's `all` or a `|` list.
const SINGLE_TORRENT_HASH = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const PEER_KEY = /^[A-Za-z0-9_-]{22}$/;

/*
 * Ban one peer of a torrent. qBittorrent bans its IP for every torrent and
 * keeps it in its banned IP list (Options > Connection > IP Filtering) until
 * someone removes it there, so this is an admin's, like qBittorrent's other
 * global settings. The browser names the peer by the key the peers list gave
 * it, and the address banned is the one qBittorrent lists under that key now,
 * never one the browser typed. Recorded in the security audit as a change of
 * qBittorrent's banned IP list (who, when, which torrent; never the address).
 */
async function postHandler(
  request: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const instance = await qbittorrentInstanceOf(request);
  if (!instance.ok) return instance.response;
  const startedAt = performance.now();

  const refuse = (status: number, error: string, reason: string) => {
    logApiDuration('/api/qbittorrent/[hash]/peers/ban', startedAt, { method: 'POST', refused: reason });
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
    const key = body && typeof body === 'object' ? (body as Record<string, unknown>).key : undefined;
    if (typeof key !== 'string' || !PEER_KEY.test(key)) return refuse(400, 'Name the peer to ban', 'key');

    const client = await getQBittorrentClient(instance.instanceId);
    const address = findPeerAddress(hash, await client.getTorrentPeers(hash, request.signal), key);
    if (!address) return refuse(409, 'That peer is no longer connected', 'gone');

    await client.banPeers([address]);
    await recordSettingsUpdated(request, auth.user, 'qBittorrent banned peers', ['banned_IPs'], hash.toLowerCase());
    logApiDuration('/api/qbittorrent/[hash]/peers/ban', startedAt, { method: 'POST', peerCount: 1 });
    return NextResponse.json({ banned: true });
  } catch (error) {
    logApiDuration('/api/qbittorrent/[hash]/peers/ban', startedAt, { method: 'POST', failed: true });
    return upstreamErrorResponse(error, 'Failed to ban the peer');
  }
}

export const POST = withApiLogging(postHandler, 'api/qbittorrent/[hash]/peers/ban');
