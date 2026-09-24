import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUserCapability: vi.fn(),
  getTorrents: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(),
  requireUserCapability: mocks.requireUserCapability,
}));
vi.mock('@/lib/service-helpers', () => ({
  getQBittorrentClient: vi.fn().mockResolvedValue({ getTorrents: mocks.getTorrents }),
}));
vi.mock('@/lib/file-audit', () => ({
  runWithOperationAudit: vi.fn(),
  snapshotTorrentDeleteTargets: vi.fn(),
}));
vi.mock('@/lib/cache/qbittorrent-version', () => ({ bumpQbitCacheVersion: vi.fn() }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));

import { GET } from '@/app/api/qbittorrent/route';

const get = (query: string) => GET(new NextRequest(`http://localhost/api/qbittorrent${query}`));

describe('GET /api/qbittorrent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUserCapability.mockResolvedValue({ ok: true, user: { id: 'u1' }, session: {} });
    mocks.getTorrents.mockResolvedValue([{ hash: 'abc' }]);
  });

  it("forwards qBittorrent's hashes filter so one torrent can be read on its own", async () => {
    const res = await get('?hashes=abc');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ hash: 'abc' }]);
    expect(mocks.getTorrents).toHaveBeenCalledWith(undefined, undefined, undefined, undefined, 'abc');
  });

  it('still lists every torrent without the filter', async () => {
    await get('');

    expect(mocks.getTorrents).toHaveBeenCalledWith(undefined, undefined, undefined, undefined, undefined);
  });

  it('checks torrents.view before reading anything', async () => {
    mocks.requireUserCapability.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const res = await get('?hashes=abc');

    expect(res.status).toBe(403);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('torrents.view');
    expect(mocks.getTorrents).not.toHaveBeenCalled();
  });
});
