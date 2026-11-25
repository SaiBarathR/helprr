import { NextRequest, NextResponse } from 'next/server';
import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * A .torrent carries the full announce URLs, a private tracker's passkey
 * among them, so the export is an admin's only. It is a download named after
 * the torrent, never cached, from the qBittorrent the request names.
 */

const HASH = 'aaaabbbbccccddddeeeeffff0000111122223333';
const ANNOUNCE = 'http://tracker.example/announce?passkey=K';
const TORRENT = new TextEncoder().encode(`d8:announce${ANNOUNCE.length}:${ANNOUNCE}4:infod6:lengthi1e4:name1:aee`);

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getQBittorrentClient: vi.fn(),
  listConnections: vi.fn(),
  client: { exportTorrent: vi.fn(), getTorrents: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/service-helpers', () => ({ getQBittorrentClient: mocks.getQBittorrentClient }));
vi.mock('@/lib/arr-instances', () => ({ listConnections: mocks.listConnections }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/server-perf', () => ({ logApiDuration: vi.fn() }));

import { GET } from '@/app/api/qbittorrent/[hash]/export/route';

const exportOf = (hash = HASH, query = '') =>
  GET(new NextRequest(`http://localhost/api/qbittorrent/${hash}/export${query}`), { params: Promise.resolve({ hash }) });

function upstream(status: number) {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('upstream', String(status), config, null, { status, statusText: '', data: '', headers: {}, config });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ ok: true, user: { id: 'a1', role: 'admin' }, session: {} });
  mocks.getQBittorrentClient.mockResolvedValue(mocks.client);
  mocks.listConnections.mockResolvedValue([{ id: 'q1' }, { id: 'q2' }]);
  mocks.client.exportTorrent.mockResolvedValue(TORRENT);
  mocks.client.getTorrents.mockResolvedValue([{ hash: HASH, name: 'Big Buck Bunny: 1080p / "remux"' }]);
});

describe('GET /api/qbittorrent/[hash]/export', () => {
  it('refuses anyone but an admin before asking any qBittorrent', async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
    const res = await exportOf(HASH, '?instanceId=q2');
    expect(res.status).toBe(403);
    expect(mocks.listConnections).not.toHaveBeenCalled();
    expect(mocks.getQBittorrentClient).not.toHaveBeenCalled();
  });

  it("gives an admin the file from the named qBittorrent, as a download named after the torrent, uncached", async () => {
    const res = await exportOf(HASH, '?instanceId=q2');
    expect(res.status).toBe(200);
    expect(mocks.getQBittorrentClient).toHaveBeenCalledWith('q2');
    expect(mocks.client.exportTorrent).toHaveBeenCalledWith(HASH, 25 * 1024 * 1024, expect.anything());
    expect(res.headers.get('content-type')).toBe('application/x-bittorrent');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="Big Buck Bunny_ 1080p _ _remux_.torrent"; filename*=UTF-8''Big%20Buck%20Bunny_%201080p%20_%20_remux_.torrent`,
    );
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(TORRENT);
  });

  it('names the file by its hash when qBittorrent gives no name', async () => {
    mocks.client.getTorrents.mockRejectedValue(new Error('timeout'));
    const res = await exportOf();
    expect(res.status).toBe(200);
    expect(mocks.getQBittorrentClient).toHaveBeenCalledWith(undefined);
    expect(res.headers.get('content-disposition')).toContain(`filename="${HASH}.torrent"`);
  });

  it.each(['all', `${HASH}|${HASH}`, 'not-a-hash'])('refuses %s as a hash', async (hash) => {
    const res = await exportOf(hash);
    expect(res.status).toBe(400);
    expect(mocks.client.exportTorrent).not.toHaveBeenCalled();
  });

  it('refuses a qBittorrent that is not one of the connections', async () => {
    const res = await exportOf(HASH, '?instanceId=gone');
    expect(res.status).toBe(400);
    expect(mocks.getQBittorrentClient).not.toHaveBeenCalled();
  });

  it('says so while a magnet has no metadata yet', async () => {
    mocks.client.exportTorrent.mockRejectedValue(upstream(409));
    const res = await exportOf();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'qBittorrent has no .torrent file for it until its metadata has downloaded' });
  });

  it('answers 404 for a torrent qBittorrent does not have', async () => {
    mocks.client.exportTorrent.mockRejectedValue(upstream(404));
    expect((await exportOf()).status).toBe(404);
  });

  it('never hands over something that is not a .torrent', async () => {
    mocks.client.exportTorrent.mockResolvedValue(new TextEncoder().encode('<html>login</html>'));
    const res = await exportOf();
    expect(res.status).toBe(502);
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});
