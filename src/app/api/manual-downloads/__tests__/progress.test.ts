import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), findUnique: vi.fn(), torrents: vi.fn(), groupBy: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireUserAllCapabilities: async () => ({ ok: true }) }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/db', () => ({ prisma: { manualDownload: { findMany: mocks.findMany, findUnique: mocks.findUnique }, manualDownloadFile: { groupBy: mocks.groupBy } } }));
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

  it('does not wait on a qBittorrent that never answers', async () => {
    vi.useFakeTimers();
    try {
      mocks.findMany.mockResolvedValue([row()]);
      mocks.torrents.mockReturnValue(new Promise(() => {}));
      const pending = list(request());
      await vi.advanceTimersByTimeAsync(2_000);
      const body = await (await pending).json();
      expect(body.downloads[0].progress).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  describe('a choose-files download', () => {
    // qBittorrent's indexes 1 and 3 were set to priority 0 (not chosen); 2 GB of the 3.5 GB torrent was.
    const files = [
      { downloadId: 'md1', fileIndex: 0, size: BigInt(1_000_000_000), selected: true },
      { downloadId: 'md1', fileIndex: 1, size: BigInt(500_000_000), selected: false },
      { downloadId: 'md1', fileIndex: 2, size: BigInt(1_000_000_000), selected: true },
      { downloadId: 'md1', fileIndex: 3, size: BigInt(1_000_000_000), selected: false },
    ];
    // Sums the fixture rows the way the query asks, so a lost `selected` filter would count skipped files.
    const sumChosen = (rows: typeof files) => async ({ where }: { where: { downloadId: { in: string[] }; selected?: boolean } }) => {
      const sums = new Map<string, bigint>();
      for (const file of rows) {
        if (!where.downloadId.in.includes(file.downloadId) || (where.selected !== undefined && file.selected !== where.selected)) continue;
        sums.set(file.downloadId, (sums.get(file.downloadId) ?? BigInt(0)) + file.size);
      }
      return [...sums].map(([downloadId, size]) => ({ downloadId, _sum: { size } }));
    };
    const reviewed = row({ mode: 'QBIT_REVIEWED' });
    const readDetail = async () => (await (await detail(new Request('http://localhost'), { params: Promise.resolve({ id: 'md1' }) })).json()).download.progress;
    const readList = async () => (await (await list(request())).json()).downloads[0].progress;

    it('shows only the chosen files on the list and the detail page, even while qBittorrent still reports the whole torrent', async () => {
      mocks.findMany.mockResolvedValue([reviewed]);
      mocks.findUnique.mockResolvedValue({ ...reviewed, files: files.map((file, index) => ({ ...file, id: `f${index}`, path: `S01E0${index}.mkv`, arrPath: null, candidate: null, decision: 'PENDING', episodeIds: [] })) });
      mocks.groupBy.mockImplementation(sumChosen(files));
      // The read right after Start: the priorities are set but qBittorrent has not refreshed its size yet.
      mocks.torrents.mockResolvedValue([{ hash: 'abc', progress: 0, size: 3_500_000_000 }]);
      expect(await readDetail()).toEqual({ fraction: 0, size: 2_000_000_000 });
      expect(await readList()).toEqual({ fraction: 0, size: 2_000_000_000 });

      mocks.torrents.mockResolvedValue([{ hash: 'abc', progress: 0.25, size: 2_000_000_000 }]);
      expect(await readDetail()).toEqual({ fraction: 0.25, size: 2_000_000_000 });
      expect(await readList()).toEqual({ fraction: 0.25, size: 2_000_000_000 });
    });

    it('counts every file when all of them were chosen', async () => {
      const all = files.map((file) => ({ ...file, selected: true }));
      mocks.findMany.mockResolvedValue([reviewed]);
      mocks.groupBy.mockImplementation(sumChosen(all));
      mocks.torrents.mockResolvedValue([{ hash: 'abc', progress: 0.5, size: 3_500_000_000 }]);
      expect(await readList()).toEqual({ fraction: 0.5, size: 3_500_000_000 });
    });

    it('uses the files the detail route already loaded instead of asking the database again', async () => {
      mocks.findUnique.mockResolvedValue({ ...reviewed, files: files.map((file, index) => ({ ...file, id: `f${index}`, path: `S01E0${index}.mkv`, arrPath: null, candidate: null, decision: 'PENDING', episodeIds: [] })) });
      mocks.torrents.mockResolvedValue([{ hash: 'abc', progress: 0, size: 3_500_000_000 }]);
      expect(await readDetail()).toEqual({ fraction: 0, size: 2_000_000_000 });
      expect(mocks.groupBy).not.toHaveBeenCalled();
    });

    it("follows qBittorrent's smaller size when files are unticked after Start", async () => {
      mocks.findMany.mockResolvedValue([reviewed]);
      mocks.groupBy.mockImplementation(sumChosen(files));
      mocks.torrents.mockResolvedValue([{ hash: 'abc', progress: 0.5, size: 1_000_000_000 }]);
      expect(await readList()).toEqual({ fraction: 0.5, size: 1_000_000_000 });
    });

    it("falls back to qBittorrent's size when no chosen files are recorded or the lookup fails", async () => {
      mocks.findMany.mockResolvedValue([reviewed]);
      mocks.torrents.mockResolvedValue([{ hash: 'abc', progress: 0.5, size: 2_000_000_000 }]);
      mocks.groupBy.mockResolvedValue([]);
      expect(await readList()).toEqual({ fraction: 0.5, size: 2_000_000_000 });
      mocks.groupBy.mockResolvedValue([{ downloadId: 'md1', _sum: { size: null } }]);
      expect(await readList()).toEqual({ fraction: 0.5, size: 2_000_000_000 });
      mocks.groupBy.mockRejectedValue(new Error('database unavailable'));
      const response = await list(request());
      expect(response.status).toBe(200);
      expect((await response.json()).downloads[0].progress).toEqual({ fraction: 0.5, size: 2_000_000_000 });
    });

    it('shows no progress and skips the lookup while qBittorrent is unavailable', async () => {
      mocks.findMany.mockResolvedValue([reviewed]);
      mocks.torrents.mockRejectedValue(new Error('unavailable'));
      expect(await readList()).toBeNull();
      expect(mocks.groupBy).not.toHaveBeenCalled();
    });

    it('asks the database only for active choose-files downloads', async () => {
      mocks.findMany.mockResolvedValue([row({ mode: 'ARR_MANAGED' }), reviewed, row({ id: 'md3', mode: 'QBIT_REVIEWED', status: 'IMPORTED' })]);
      mocks.groupBy.mockResolvedValue([]);
      mocks.torrents.mockResolvedValue([{ hash: 'abc', progress: 0.5, size: 1024 }]);
      await list(request());
      expect(mocks.groupBy).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ where: { downloadId: { in: ['md1'] }, selected: true } }));
    });
  });
});
