import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  arr: {} as Record<string, ReturnType<typeof vi.fn>>,
  qbit: {} as Record<string, ReturnType<typeof vi.fn>>,
  rows: new Map<string, Record<string, unknown>>(),
  fileUpdates: [] as Array<{ id: string; data: Record<string, unknown> }>,
  moves: [] as Array<{ status: string; message: string | null; data?: Record<string, unknown> }>,
  audits: [] as Array<{ operation: string; details: Record<string, unknown> }>,
  active: null as null | Record<string, unknown>,
}));
vi.mock('@/lib/db', () => {
  const manualDownload = {
    findFirst: vi.fn(async () => mocks.active),
    findUnique: vi.fn(async () => null),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => mocks.rows.get(where.id)),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { mocks.rows.set('md1', { id: 'md1', ...data }); return { id: 'md1' }; }),
    // Honours the status condition, as Prisma does (P2025 when the row moved on).
    update: vi.fn(async ({ where, data }: { where: { id: string; status?: string }; data: Record<string, unknown> }) => {
      const row = mocks.rows.get(where.id);
      if (row && where.status && row.status !== where.status) {
        const { Prisma } = await import('@prisma/client');
        throw new Prisma.PrismaClientKnownRequestError('No record was found', { code: 'P2025', clientVersion: '6' });
      }
      if (row && typeof data.status === 'string') row.status = data.status;
      return {};
    }),
  };
  const manualDownloadFile = {
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      mocks.fileUpdates.push({ id: where.id, data });
      for (const row of mocks.rows.values()) {
        const file = (row.files as Array<Record<string, unknown>> | undefined)?.find((entry) => entry.id === where.id);
        if (file) Object.assign(file, data);
      }
      return {};
    }),
  };
  const tx = { $executeRaw: vi.fn(async () => 1), manualDownload };
  return {
    prisma: {
      manualDownload,
      manualDownloadFile,
      $transaction: async (arg: unknown) => (typeof arg === 'function' ? (arg as (t: typeof tx) => unknown)(tx) : Promise.all(arg as Promise<unknown>[])),
    },
  };
});
vi.mock('@/lib/arr-instances', () => ({ resolveConnection: vi.fn(async () => ({ id: 'i1', label: 'radarr-4k' })) }));
vi.mock('@/lib/service-helpers', () => ({ getQBittorrentClient: async () => mocks.qbit }));
vi.mock('@/lib/cache/tagged-library', () => ({ invalidateTaggedLibrary: vi.fn(async () => {}) }));
vi.mock('@/lib/file-audit', () => ({
  systemAuditActor: (label: string) => ({ id: null, username: `system:${label}` }),
  runWithOperationAudit: async (input: { operation: string; details: Record<string, unknown> }, call: () => Promise<unknown>) => {
    mocks.audits.push({ operation: input.operation, details: input.details });
    return call();
  },
}));
vi.mock('../send', () => ({
  withEvents: vi.fn(async (id: string) => ({ id, ...mocks.rows.get(id), events: [] })),
  moveTo: vi.fn(async (_id: string, status: string, message: string | null, data?: Record<string, unknown>) => { mocks.moves.push({ status, message, data }); }),
}));
vi.mock('../preflight', async (importOriginal) => ({ ...(await importOriginal<typeof import('../preflight')>()), arrClientFor: () => mocks.arr }));

import { checkFallback, importFallback, settleDownloaded, startFallbackDownload } from '../fallback';

const HASH = '382CC016FF22946008ECDDCB0DDA820F42B0CD5A';
const FILM = 'Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP';
const input = (extra: Record<string, unknown> = {}) => ({
  service: 'RADARR' as const, instanceId: 'i1', externalId: 10331, infoHash: HASH, selectedFileIndexes: [0], source: 'MAGNET' as const,
  add: { qualityProfileId: 1, rootFolderPath: '/data/Movies', tags: [] }, ...extra,
});
const torrentFiles = [
  { index: 0, name: `${FILM}/${FILM}.mkv`, size: 1000 },
  { index: 1, name: `${FILM}/Sample/${FILM}.sample.mkv`, size: 10 },
  { index: 2, name: `${FILM}/${FILM}.nfo`, size: 1 },
];
const candidate = (path: string, extra: Record<string, unknown> = {}) => ({
  path, quality: { quality: { id: 7, name: 'Bluray-1080p' } }, languages: [{ id: 1, name: 'English' }], releaseGroup: 'GRP',
  rejections: [], movie: { id: 15, title: 'Night of the Living Dead' }, ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows.clear();
  mocks.fileUpdates = [];
  mocks.moves = [];
  mocks.audits = [];
  mocks.active = null;
  mocks.qbit = {
    getTorrents: vi.fn(async () => [{ hash: HASH.toLowerCase(), name: FILM, state: 'stoppedDL', category: '', save_path: '/mnt/media/Downloads/', progress: 0 }]),
    getTorrentFiles: vi.fn(async () => torrentFiles),
    setFilePriority: vi.fn(async () => {}),
    resumeTorrent: vi.fn(async () => {}),
  };
  mocks.arr = {
    lookupMovie: vi.fn(async () => [{ title: 'Night of the Living Dead', year: 1968, tmdbId: 10331, id: 0 }]),
    getDownloadClients: vi.fn(async () => [{ id: 1, name: 'qBittorrent', enable: true, protocol: 'torrent', priority: 1, fields: [{ name: 'movieCategory', value: 'radarr' }] }]),
    getRemotePathMappings: vi.fn(async () => [{ id: 1, host: 'qbittorrent', remotePath: '/mnt/media/', localPath: '/data/' }]),
    getQualityProfiles: vi.fn(async () => [{ id: 1, name: 'HD' }]),
    getRootFolders: vi.fn(async () => [{ path: '/data/Movies' }]),
    getTags: vi.fn(async () => []),
    // Arr sees /data/Downloads (through the mapping), not /mnt/media/Downloads.
    listFolder: vi.fn(async (folder: string) => {
      if (folder === '/data/') return { directories: [{ name: 'Downloads', path: '/data/Downloads/' }], files: [] };
      if (folder === `/data/Downloads/${FILM}/`) return { directories: [], files: [{ name: `${FILM}.mkv`, path: '', size: 1000 }, { name: `${FILM}.nfo`, path: '', size: 1 }] };
      if (folder === `/data/Downloads/${FILM}/Sample/`) return { directories: [], files: [{ name: `${FILM}.sample.mkv`, path: '', size: 10 }] };
      return { directories: [], files: [] };
    }),
    addMovie: vi.fn(async () => ({ id: 15 })),
    scanImportPath: vi.fn(async () => [candidate(`/data/Downloads/${FILM}/${FILM}.mkv`)]),
    getMovieFiles: vi.fn(async () => []),
    submitManualImport: vi.fn(async () => ({ id: 77 })),
    reprocessManualImport: vi.fn(async () => []),
  };
});

describe('checking the fallback before the torrent starts', () => {
  it('finds where Radarr sees the download folder through its remote path mapping', async () => {
    const result = await checkFallback(input());
    expect(result.ok).toBe(true);
    expect(result.plan.arrSavePath).toBe('/data/Downloads/');
    expect(result.plan.mapping).toEqual({ remotePath: '/mnt/media/', localPath: '/data/' });
    expect(result.plan.torrent?.files.map((file) => file.selected)).toEqual([true, false, false]);
  });

  it('refuses when Radarr cannot see the folder, naming the fix', async () => {
    mocks.arr.getRemotePathMappings.mockResolvedValue([]);
    const result = await checkFallback(input());
    expect(result.errors.map((issue) => issue.code)).toEqual(['PATH_NOT_VISIBLE']);
    expect(result.errors[0].message).toContain('add a remote path mapping');
  });

  it('refuses a torrent that started, sits in a category Radarr watches, or has a file that is not there', async () => {
    mocks.qbit.getTorrents.mockResolvedValue([{ hash: HASH.toLowerCase(), name: FILM, state: 'downloading', category: 'radarr', save_path: '/mnt/media/Downloads/', progress: 0.1 }]);
    const result = await checkFallback(input({ selectedFileIndexes: [0, 9] }));
    expect(result.errors.map((issue) => issue.code)).toEqual(['FILE_INDEX_INVALID', 'TORRENT_RUNNING', 'TORRENT_IN_ARR_CATEGORY']);

    mocks.qbit.getTorrents.mockResolvedValue([{ hash: HASH.toLowerCase(), name: FILM, state: 'checkingResumeData', category: '', save_path: '/mnt/media/Downloads/', progress: 0 }]);
    expect((await checkFallback(input())).errors.map((issue) => issue.code)).toEqual(['TORRENT_CHECKING']);
  });

  it('warns when a Radarr download client has no category, since Radarr then watches every torrent', async () => {
    mocks.arr.getDownloadClients.mockResolvedValue([{ id: 1, name: 'qBittorrent', enable: true, protocol: 'torrent', priority: 1, fields: [{ name: 'movieCategory', value: '' }] }]);
    const result = await checkFallback(input());
    expect(result.ok).toBe(true);
    expect(result.warnings.map((issue) => issue.code)).toEqual(['ARR_CLIENT_WITHOUT_CATEGORY']);
  });
});

describe('starting the fallback', () => {
  it('records every file as chosen or not, adds the film with searches off, and downloads only the chosen files', async () => {
    const download = await startFallbackDownload(input(), 'req-00001', { id: 'u1', username: 'admin' });
    const created = mocks.rows.get('md1')!;
    expect(created).toEqual(expect.objectContaining({ mode: 'QBIT_REVIEWED', infoHash: HASH, pathMapping: { mapping: { remotePath: '/mnt/media/', localPath: '/data/' } } }));
    expect((created.files as { create: unknown[] }).create).toEqual([
      { fileIndex: 0, path: `${FILM}/${FILM}.mkv`, size: BigInt(1000), selected: true },
      { fileIndex: 1, path: `${FILM}/Sample/${FILM}.sample.mkv`, size: BigInt(10), selected: false },
      { fileIndex: 2, path: `${FILM}/${FILM}.nfo`, size: BigInt(1), selected: false },
    ]);
    expect(mocks.arr.addMovie).toHaveBeenCalledWith(expect.objectContaining({ tmdbId: 10331, addOptions: { searchForMovie: false, monitor: 'movieOnly' } }));
    expect(mocks.qbit.setFilePriority).toHaveBeenNthCalledWith(1, HASH.toLowerCase(), [1, 2], 0);
    expect(mocks.qbit.setFilePriority).toHaveBeenNthCalledWith(2, HASH.toLowerCase(), [0], 1);
    expect(mocks.qbit.resumeTorrent).toHaveBeenCalledWith(HASH.toLowerCase());
    expect(mocks.moves.map((move) => move.status)).toEqual(['CREATING_MEDIA', 'DOWNLOADING']);
    expect(download.id).toBe('md1');
  });

  it('creates nothing when the check refuses', async () => {
    mocks.arr.getRemotePathMappings.mockResolvedValue([]);
    await expect(startFallbackDownload(input(), 'req-00002', { id: 'u1', username: 'admin' })).rejects.toThrow('add a remote path mapping');
    expect(mocks.rows.size).toBe(0);
    expect(mocks.qbit.resumeTorrent).not.toHaveBeenCalled();
  });
});

function downloaded(service: 'RADARR' | 'SONARR', files: Array<Record<string, unknown>>, status = 'DOWNLOADING') {
  const row = {
    id: 'md1', mode: 'QBIT_REVIEWED', status, service, instanceId: 'i1', instanceLabel: 'radarr-4k', arrItemId: 15,
    arrItemTitle: service === 'RADARR' ? 'Night of the Living Dead' : 'Classroom of the Elite', createdArrItem: true,
    pathMapping: { mapping: { remotePath: '/mnt/media/', localPath: '/data/' } }, files,
  };
  mocks.rows.set('md1', row);
  return row as never;
}
const file = (id: string, index: number, path: string, size: number, selected: boolean) => ({
  id, fileIndex: index, path, size: BigInt(size), selected, arrPath: null, candidate: null, decision: 'PENDING', episodeIds: [],
});

describe('after the chosen files finish', () => {
  it('imports, by copy, the one file Radarr is sure of, and only from the chosen files', async () => {
    const download = downloaded('RADARR', [file('f0', 0, `${FILM}/${FILM}.mkv`, 1000, true), file('f1', 1, `${FILM}/Sample/${FILM}.sample.mkv`, 10, false)]);
    // Radarr's scan also lists the unchosen (part-written) sample; it must be left out.
    mocks.arr.scanImportPath.mockResolvedValue([
      candidate(`/data/Downloads/${FILM}/${FILM}.mkv`),
      candidate(`/data/Downloads/${FILM}/Sample/${FILM}.sample.mkv`, { rejections: [{ reason: 'Sample' }] }),
    ]);

    expect(await settleDownloaded(download, mocks.arr as never, '/mnt/media/Downloads/')).toBe(true);

    expect(mocks.arr.scanImportPath).toHaveBeenCalledWith(`/data/Downloads/${FILM}`);
    expect(mocks.arr.submitManualImport).toHaveBeenCalledWith([expect.objectContaining({
      path: `/data/Downloads/${FILM}/${FILM}.mkv`, movieId: 15, quality: { quality: { id: 7, name: 'Bluray-1080p' } }, downloadId: '',
    })], 'copy');
    expect(mocks.moves).toEqual([expect.objectContaining({ status: 'IMPORTING', data: expect.objectContaining({ arrCommandId: 77, baselineFileIds: [] }) })]);
    expect(mocks.rows.get('md1')!.status).toBe('IMPORT_PENDING');
    expect(mocks.audits).toEqual([expect.objectContaining({ operation: 'IMPORT' })]);
    expect(mocks.fileUpdates.map((update) => update.id)).not.toContain('f1');
  });

  it('asks the user when Radarr cannot tell what a file is, with its reason', async () => {
    const download = downloaded('RADARR', [file('f0', 0, `${FILM}/${FILM}.mkv`, 1000, true)]);
    mocks.arr.scanImportPath.mockResolvedValue([candidate(`/data/Downloads/${FILM}/${FILM}.mkv`, { movie: null, rejections: [{ reason: 'Unknown Movie' }] })]);

    await settleDownloaded(download, mocks.arr as never, '/mnt/media/Downloads/');

    expect(mocks.moves).toEqual([{ status: 'NEEDS_MAPPING', message: expect.stringContaining(`${FILM}.mkv: Unknown Movie`), data: undefined }]);
    expect(mocks.arr.submitManualImport).not.toHaveBeenCalled();
  });

  it('stops when Radarr cannot see a downloaded file where it should', async () => {
    const download = downloaded('RADARR', [file('f0', 0, `${FILM}/${FILM}.mkv`, 999, true)]);
    await settleDownloaded(download, mocks.arr as never, '/mnt/media/Downloads/');
    expect(mocks.moves).toEqual([{ status: 'BLOCKED', message: expect.stringContaining('remote path mappings'), data: undefined }]);
    expect(mocks.arr.scanImportPath).not.toHaveBeenCalled();
  });

  it('asks the user when two Sonarr files read as the same episode', async () => {
    mocks.arr.listFolder.mockResolvedValue({ directories: [], files: [{ name: 'a.mkv', path: '', size: 5 }, { name: 'b.mkv', path: '', size: 5 }] });
    const download = downloaded('SONARR', [file('f0', 0, 'Show/a.mkv', 5, true), file('f1', 1, 'Show/b.mkv', 5, true)]);
    const episode = { id: 501, seasonNumber: 1, episodeNumber: 5 };
    mocks.arr.scanImportPath.mockResolvedValue([
      candidate('/data/Downloads/Show/a.mkv', { movie: null, series: { id: 15, title: 'Classroom of the Elite' }, episodes: [episode] }),
      candidate('/data/Downloads/Show/b.mkv', { movie: null, series: { id: 15, title: 'Classroom of the Elite' }, episodes: [episode] }),
    ]);
    await settleDownloaded(download, mocks.arr as never, '/mnt/media/Downloads/');
    expect(mocks.moves[0].message).toContain('b.mkv: another file holds the same episode');
  });

  it('asks the user about a chosen file Arr reads as a whole season, though it also says "Sample"', async () => {
    mocks.arr.listFolder.mockResolvedValue({ directories: [], files: [{ name: 'a.mkv', path: '', size: 5 }, { name: 'random.mkv', path: '', size: 5 }] });
    const download = downloaded('SONARR', [file('f0', 0, 'Show.S01/a.mkv', 5, true), file('f1', 1, 'Show.S01/random.mkv', 5, true)]);
    const series = { id: 15, title: 'Classroom of the Elite' };
    mocks.arr.scanImportPath.mockResolvedValue([
      candidate('/data/Downloads/Show.S01/a.mkv', { movie: null, series, episodes: [{ id: 505, seasonNumber: 1, episodeNumber: 5 }] }),
      candidate('/data/Downloads/Show.S01/random.mkv', {
        movie: null, series, episodes: [{ id: 501, seasonNumber: 1, episodeNumber: 1 }, { id: 502, seasonNumber: 1, episodeNumber: 2 }],
        rejections: [{ reason: 'Single episode file contains all episodes in seasons. Review file name or manually import' }, { reason: 'Sample' }],
      }),
    ]);
    await settleDownloaded(download, mocks.arr as never, '/mnt/media/Downloads/');
    expect(mocks.moves[0]).toEqual(expect.objectContaining({ status: 'NEEDS_MAPPING', message: expect.stringContaining('random.mkv: Single episode file contains all episodes') }));
    expect(mocks.arr.submitManualImport).not.toHaveBeenCalled();
  });

  it('scans once when two scans race', async () => {
    const download = downloaded('RADARR', [file('f0', 0, `${FILM}/${FILM}.mkv`, 1000, true)]);
    await settleDownloaded(download, mocks.arr as never, '/mnt/media/Downloads/');
    // The second one still holds the download as it read it (DOWNLOADING).
    expect(await settleDownloaded({ ...(download as object), status: 'DOWNLOADING' } as never, mocks.arr as never, '/mnt/media/Downloads/')).toBe(false);
    expect(mocks.arr.submitManualImport).toHaveBeenCalledTimes(1);
  });
});

describe("importing the user's decisions", () => {
  const scanned = (service: 'RADARR' | 'SONARR') => downloaded(service, [
    { ...file('f0', 0, 'Show/a.mkv', 5, true), arrPath: '/data/Downloads/Show/a.mkv', candidate: candidate('/data/Downloads/Show/a.mkv') },
    { ...file('f1', 1, 'Show/b.mkv', 5, true), arrPath: '/data/Downloads/Show/b.mkv', candidate: candidate('/data/Downloads/Show/b.mkv') },
    { ...file('f2', 2, 'Show/c.mkv', 5, false), arrPath: '/data/Downloads/Show/c.mkv' },
  ], 'NEEDS_MAPPING');
  const actor = { id: 'u1', username: 'admin' };

  it('never imports a file that was not chosen and downloaded', async () => {
    await expect(importFallback(scanned('RADARR'), mocks.arr as never, [{ fileId: 'f2', decision: 'IMPORT' }], actor)).rejects.toThrow('not one of the downloaded files');
    await expect(importFallback(scanned('RADARR'), mocks.arr as never, [{ fileId: 'nope', decision: 'IMPORT' }], actor)).rejects.toThrow('not one of the downloaded files');
    expect(mocks.arr.submitManualImport).not.toHaveBeenCalled();
  });

  it('checks episodes against the series and allows each episode once', async () => {
    mocks.arr.getEpisodes = vi.fn(async () => [{ id: 501, episodeFileId: 0 }, { id: 502, episodeFileId: 33 }]);
    const download = scanned('SONARR');
    await expect(importFallback(download, mocks.arr as never, [{ fileId: 'f0', decision: 'IMPORT', episodeIds: [999] }], actor)).rejects.toThrow('not in Classroom of the Elite');
    await expect(importFallback(download, mocks.arr as never, [
      { fileId: 'f0', decision: 'IMPORT', episodeIds: [501] }, { fileId: 'f1', decision: 'IMPORT', episodeIds: [501] },
    ], actor)).rejects.toThrow('same episode');

    await importFallback(download, mocks.arr as never, [
      { fileId: 'f0', decision: 'IMPORT', episodeIds: [501] }, { fileId: 'f1', decision: 'IMPORT', episodeIds: [502] },
    ], actor);
    expect(mocks.arr.submitManualImport).toHaveBeenCalledWith([
      expect.objectContaining({ path: '/data/Downloads/Show/a.mkv', seriesId: 15, episodeIds: [501], releaseType: 'singleEpisode' }),
      expect.objectContaining({ path: '/data/Downloads/Show/b.mkv', seriesId: 15, episodeIds: [502], releaseType: 'singleEpisode' }),
    ], 'copy');
    expect(mocks.moves[0].data).toEqual(expect.objectContaining({ targetEpisodeIds: [501, 502], baselineFileIds: { 501: 0, 502: 33 } }));
  });

  it('imports once when the same decisions are submitted twice, and says why Arr refused one', async () => {
    const download = scanned('RADARR');
    await importFallback(download, mocks.arr as never, [{ fileId: 'f0', decision: 'IMPORT' }], actor);
    await expect(importFallback({ ...(download as object), status: 'NEEDS_MAPPING' } as never, mocks.arr as never, [{ fileId: 'f0', decision: 'IMPORT' }], actor)).rejects.toThrow('already being imported');
    expect(mocks.arr.submitManualImport).toHaveBeenCalledTimes(1);

    mocks.moves = [];
    mocks.arr.submitManualImport.mockRejectedValue(new Error('Request failed with status code 500'));
    await expect(importFallback(scanned('RADARR'), mocks.arr as never, [{ fileId: 'f0', decision: 'IMPORT' }], actor)).rejects.toThrow();
    expect(mocks.moves).toEqual([expect.objectContaining({ status: 'BLOCKED', message: expect.stringContaining('did not take the import: Request failed with status code 500') })]);
  });

  it('imports one file for a movie', async () => {
    await expect(importFallback(scanned('RADARR'), mocks.arr as never, [
      { fileId: 'f0', decision: 'IMPORT' }, { fileId: 'f1', decision: 'IMPORT' },
    ], actor)).rejects.toThrow('Import one file');
  });
});
