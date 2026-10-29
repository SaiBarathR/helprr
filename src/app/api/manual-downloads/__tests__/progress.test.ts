import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), findUnique: vi.fn(), torrents: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireUserAllCapabilities: async () => ({ ok: true }) }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/db', () => ({ prisma: { manualDownload: { findMany: mocks.findMany, findUnique: mocks.findUnique } } }));
vi.mock('@/lib/service-helpers', () => ({ getQBittorrentClient: async () => ({ getTorrents: mocks.torrents }) }));
vi.mock('@/lib/manual-downloads/send', () => ({ sendManualDownload: vi.fn(), ManualDownloadRefusedError: class extends Error {} }));

import { GET as list } from '../route';
import { GET as detail } from '../[id]/route';

const row = (extra: Record<string, unknown> = {}) => ({
  id: 'md1', status: 'DOWNLOADING', infoHash: 'ABC', importedFileIds: null,
  createdAt: new Date(), updatedAt: new Date(), completedAt: null,
  ...extra,
});
const request = () => new NextRequest('http://localhost/api/manual-downloads');
beforeEach(() => vi.resetAllMocks());

describe('progress on the existing manual download reads', () => {
  it('batches only active hashes, matches case-insensitively and exposes only progress and selected size', async () => {
    mocks.findMany.mockResolvedValue([row(), row({ id: 'md2', infoHash: 'DEF', status: 'QUEUED' }), row({ id: 'md3', status: 'IMPORTED', infoHash: 'GHI' })]);
    mocks.torrents.mockResolvedValue([{ hash: 'abc', progress: 0.5, size: 1024, total_size: 9999, magnet_uri: 'private' }]);
    const body = await (await list(request())).json();
    expect(mocks.torrents).toHaveBeenCalledExactlyOnceWith(undefined, undefined, undefined, undefined, 'abc|def');
    expect(body.downloads.map((download: { progress: unknown }) => download.progress)).toEqual([{ fraction: 0.5, size: 1024 }, null, null]);
    expect(JSON.stringify(body)).not.toContain('private');
  });

  it('adds the same progress to detail without inventing a size when metadata is missing', async () => {
    mocks.findUnique.mockResolvedValue(row());
    mocks.torrents.mockResolvedValue([{ hash: 'abc', progress: 0.25, size: 0 }]);
    const body = await (await detail(new Request('http://localhost'), { params: Promise.resolve({ id: 'md1' }) })).json();
    expect(body.download.progress).toEqual({ fraction: 0.25, size: null });
  });

  it('keeps the workflow readable when qBittorrent fails', async () => {
    mocks.findMany.mockResolvedValue([row()]);
    mocks.torrents.mockRejectedValue(new Error('unavailable'));
    const response = await list(request());
    expect(response.status).toBe(200);
    expect((await response.json()).downloads[0].progress).toBeNull();
  });

  it('skips upstream reads for history and serializes the proved file count', async () => {
    mocks.findMany.mockResolvedValue([row({ status: 'IMPORTED', importedFileIds: [1, 2, 3] }), row({ status: 'CANCELLED' })]);
    const body = await (await list(request())).json();
    expect(mocks.torrents).not.toHaveBeenCalled();
    expect(body.downloads[0].importedFileCount).toBe(3);
    expect(body.downloads[1].importedFileCount).toBeNull();
  });
});
