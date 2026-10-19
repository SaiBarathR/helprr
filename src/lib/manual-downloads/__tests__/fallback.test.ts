import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown> & { id: string; status: string; updatedAt: Date; files: Array<Record<string, unknown>> };

const mocks = vi.hoisted(() => ({
  arr: {} as Record<string, ReturnType<typeof vi.fn>>,
  qbit: {} as Record<string, ReturnType<typeof vi.fn>>,
  rows: new Map<string, Record<string, unknown>>(),
  fileUpdates: [] as Array<{ id: string; data: Record<string, unknown> }>,
  moves: [] as Array<{ status: string; message: string | null; data?: Record<string, unknown> }>,
  audits: [] as Array<{ operation: string; filesDeleted?: boolean | null; details: Record<string, unknown> }>,
  /** The order of what matters: the attempt kept, then Arr asked. */
  log: [] as string[],
  locks: [] as string[],
  active: null as null | Record<string, unknown>,
}));
vi.mock('@/lib/db', () => {
  const lost = async () => {
    const { Prisma } = await import('@prisma/client');
    return new Prisma.PrismaClientKnownRequestError('No record was found', { code: 'P2025', clientVersion: '6' });
  };
  const copy = (row: unknown) => structuredClone(row);
  const manualDownload = {
    // An open workflow for the torrent, found only by a query that does not narrow it to another instance.
    findFirst: vi.fn(async ({ where }: { where: { instanceId?: string } }) => (where.instanceId && where.instanceId !== mocks.active?.instanceId ? null : mocks.active)),
    findUnique: vi.fn(async () => null),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => copy(mocks.rows.get(where.id))),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { mocks.rows.set('md1', { id: 'md1', updatedAt: new Date(), ...data }); return { id: 'md1' }; }),
    // Honours the status and updatedAt conditions, as Prisma does (P2025 when the row moved on).
    update: vi.fn(async ({ where, data }: { where: { id: string; status?: string; updatedAt?: Date }; data: Record<string, unknown> }) => {
      const row = mocks.rows.get(where.id) as Row | undefined;
      if (!row) throw await lost();
      if (where.status && row.status !== where.status) throw await lost();
      if (where.updatedAt && row.updatedAt.getTime() !== where.updatedAt.getTime()) throw await lost();
      const { events, files, updatedAt, ...fields } = data as Record<string, unknown> & { events?: { create: { message: string } }; files?: { updateMany: { data: Record<string, unknown> } }; updatedAt?: Date };
      Object.assign(row, fields);
      row.updatedAt = updatedAt ?? new Date(row.updatedAt.getTime() + 1);
      if (files) for (const file of row.files) Object.assign(file, files.updateMany.data);
      if ('baselineFileIds' in fields) mocks.log.push('keep');
      if (typeof fields.status === 'string') {
        const rest = { ...fields };
        for (const key of ['status', 'lastError', 'completedAt']) delete rest[key];
        mocks.moves.push({ status: fields.status, message: events?.create.message ?? null, data: rest });
      }
      return { updatedAt: row.updatedAt };
    }),
  };
  const manualDownloadFile = {
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      mocks.fileUpdates.push({ id: where.id, data });
      // Prisma reads DbNull back as null.
      const { Prisma } = await import('@prisma/client');
      if (data.candidate === Prisma.DbNull) data = { ...data, candidate: null };
      for (const row of mocks.rows.values()) {
        const file = (row.files as Array<Record<string, unknown>> | undefined)?.find((entry) => entry.id === where.id);
        if (file) Object.assign(file, data);
      }
      return {};
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { downloadId: string }; data: Record<string, unknown> }) => {
      for (const file of (mocks.rows.get(where.downloadId)?.files as Array<Record<string, unknown>>) ?? []) Object.assign(file, data);
      return { count: 0 };
    }),
    findMany: vi.fn(async ({ where }: { where: { downloadId: string; decision?: string } }) =>
      copy(((mocks.rows.get(where.downloadId)?.files as Array<Record<string, unknown>>) ?? []).filter((file) => !where.decision || file.decision === where.decision))),
  };
  const tx = { $executeRaw: vi.fn(async (_strings: TemplateStringsArray, key: string) => { mocks.locks.push(key); return 1; }), manualDownload, manualDownloadFile };
  return {
    prisma: {
      manualDownload,
      manualDownloadFile,
      serviceConnection: { findFirst: vi.fn(async () => ({ url: 'http://192.168.1.5:8080' })) },
      $transaction: async (arg: unknown) => (typeof arg === 'function' ? (arg as (t: typeof tx) => unknown)(tx) : Promise.all(arg as Promise<unknown>[])),
    },
  };
});
vi.mock('@/lib/arr-instances', () => ({ resolveConnection: vi.fn(async () => ({ id: 'i1', label: 'radarr-4k' })) }));
vi.mock('@/lib/service-helpers', () => ({ getQBittorrentClient: async () => mocks.qbit }));
vi.mock('@/lib/cache/tagged-library', () => ({ invalidateTaggedLibrary: vi.fn(async () => {}) }));
vi.mock('@/lib/file-audit', () => ({
  systemAuditActor: (label: string) => ({ id: null, username: `system:${label}` }),
  runWithOperationAudit: async (input: { operation: string; filesDeleted?: boolean | null; details: Record<string, unknown> }, call: () => Promise<unknown>) => {
    mocks.audits.push({ operation: input.operation, filesDeleted: input.filesDeleted, details: input.details });
    return call();
  },
}));
vi.mock('../send', () => ({
  withEvents: vi.fn(async (id: string) => ({ id, ...mocks.rows.get(id), events: [] })),
  moveTo: vi.fn(async (_id: string, status: string, message: string | null, data?: Record<string, unknown>) => { mocks.moves.push({ status, message, data }); }),
}));
vi.mock('../preflight', async (importOriginal) => ({ ...(await importOriginal<typeof import('../preflight')>()), arrClientFor: () => mocks.arr }));

import { checkFallback, fallbackImportProof, importFallback, settleDownloaded, startFallbackDownload } from '../fallback';

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
const qbittorrentClient = (host = 'qbittorrent') => ({
  id: 1, name: 'qBittorrent', enable: true, protocol: 'torrent', priority: 1, implementation: 'QBittorrent',
  fields: [{ name: 'host', value: host }, { name: 'port', value: 8080 }, { name: 'movieCategory', value: 'radarr' }],
});
const mapping = { host: 'qbittorrent', remotePath: '/mnt/media/', localPath: '/data/' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows.clear();
  mocks.fileUpdates = [];
  mocks.moves = [];
  mocks.audits = [];
  mocks.log = [];
  mocks.locks = [];
  mocks.active = null;
  mocks.qbit = {
    getTorrents: vi.fn(async () => [{ hash: HASH.toLowerCase(), name: FILM, state: 'stoppedDL', category: '', save_path: '/mnt/media/Downloads/', progress: 0 }]),
    getTorrentFiles: vi.fn(async () => torrentFiles),
    setFilePriority: vi.fn(async () => {}),
    resumeTorrent: vi.fn(async () => {}),
  };
  mocks.arr = {
    lookupMovie: vi.fn(async () => [{ title: 'Night of the Living Dead', year: 1968, tmdbId: 10331, id: 0 }]),
    getDownloadClients: vi.fn(async () => [qbittorrentClient()]),
    getRemotePathMappings: vi.fn(async () => [{ id: 1, ...mapping }]),
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
    getMediaManagementConfig: vi.fn(async () => ({ recycleBin: '', importExtraFiles: false })),
    getCommands: vi.fn(async () => []),
    getMovieHistory: vi.fn(async () => []),
    getSeriesHistory: vi.fn(async () => []),
    submitManualImport: vi.fn(async () => { mocks.log.push('submit'); return { id: 77 }; }),
    reprocessManualImport: vi.fn(async () => []),
  };
});

describe('checking the fallback before the torrent starts', () => {
  it('finds where Radarr sees the download folder through its remote path mapping', async () => {
    const result = await checkFallback(input());
    expect(result.ok).toBe(true);
    expect(result.plan.arrSavePath).toBe('/data/Downloads/');
    expect(result.plan.mapping).toEqual(mapping);
    expect(result.plan.torrent?.files.map((file) => file.selected)).toEqual([true, false, false]);
  });

  it('refuses when Radarr cannot see the folder, naming the fix', async () => {
    mocks.arr.getRemotePathMappings.mockResolvedValue([]);
    const result = await checkFallback(input());
    expect(result.errors.map((issue) => issue.code)).toEqual(['PATH_NOT_VISIBLE']);
    expect(result.errors[0].message).toContain('add a remote path mapping');
  });

  it("uses only the mappings of the host Radarr knows qBittorrent by, and says when it cannot tell", async () => {
    mocks.arr.getRemotePathMappings.mockResolvedValue([{ id: 2, ...mapping, host: 'seedbox' }]);
    expect((await checkFallback(input())).errors.map((issue) => issue.code)).toEqual(['PATH_NOT_VISIBLE']);

    mocks.arr.getRemotePathMappings.mockResolvedValue([{ id: 1, ...mapping }]);
    mocks.arr.getDownloadClients.mockResolvedValue([qbittorrentClient('qbit-a'), qbittorrentClient('qbit-b')]);
    const result = await checkFallback(input());
    expect(result.errors.map((issue) => issue.code)).toEqual(['PATH_NOT_VISIBLE']);
    expect(result.errors[0].message).toContain('several qBittorrent download clients');
  });

  it('refuses a torrent that started, sits in a category Radarr watches, or has a file that is not there', async () => {
    mocks.qbit.getTorrents.mockResolvedValue([{ hash: HASH.toLowerCase(), name: FILM, state: 'downloading', category: 'radarr', save_path: '/mnt/media/Downloads/', progress: 0.1 }]);
    const result = await checkFallback(input({ selectedFileIndexes: [0, 9] }));
    expect(result.errors.map((issue) => issue.code)).toEqual(['FILE_INDEX_INVALID', 'TORRENT_RUNNING', 'TORRENT_IN_ARR_CATEGORY']);

    mocks.qbit.getTorrents.mockResolvedValue([{ hash: HASH.toLowerCase(), name: FILM, state: 'checkingResumeData', category: '', save_path: '/mnt/media/Downloads/', progress: 0 }]);
    expect((await checkFallback(input())).errors.map((issue) => issue.code)).toEqual(['TORRENT_CHECKING']);
  });

  it('refuses a torrent another instance already follows', async () => {
    mocks.active = { instanceId: 'i2', arrItemTitle: 'Night of the Living Dead', instanceLabel: 'radarr-4k' };
    const result = await checkFallback(input());
    expect(result.errors).toEqual([{ code: 'ALREADY_ACTIVE', message: 'This torrent is already linked to Night of the Living Dead in radarr-4k.' }]);
  });

  it('warns when a Radarr download client has no category, since Radarr then watches every torrent', async () => {
    mocks.arr.getDownloadClients.mockResolvedValue([{ ...qbittorrentClient(), fields: [{ name: 'host', value: 'qbittorrent' }, { name: 'port', value: 8080 }, { name: 'movieCategory', value: '' }] }]);
    const result = await checkFallback(input());
    expect(result.ok).toBe(true);
    expect(result.warnings.map((issue) => issue.code)).toEqual(['ARR_CLIENT_WITHOUT_CATEGORY']);
  });
});

describe('starting the fallback', () => {
  it('records every file as chosen or not, adds the film with searches off, and downloads only the chosen files', async () => {
    const download = await startFallbackDownload(input(), 'req-00001', { id: 'u1', username: 'admin' });
    const created = mocks.rows.get('md1')!;
    expect(created).toEqual(expect.objectContaining({ mode: 'QBIT_REVIEWED', infoHash: HASH, pathMapping: { mapping } }));
    expect((created.files as { create: unknown[] }).create).toEqual([
      { fileIndex: 0, path: `${FILM}/${FILM}.mkv`, size: BigInt(1000), selected: true },
      { fileIndex: 1, path: `${FILM}/Sample/${FILM}.sample.mkv`, size: BigInt(10), selected: false },
      { fileIndex: 2, path: `${FILM}/${FILM}.nfo`, size: BigInt(1), selected: false },
    ]);
    // One lock per torrent, whichever instance asks.
    expect(mocks.locks).toEqual([`manual-download:qbittorrent:${HASH}`]);
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

const T0 = new Date('2026-10-19T10:00:00Z');
/** A fallback download as the database has it, and as a caller read it (a copy that does not change after). */
function downloaded(service: 'RADARR' | 'SONARR', files: Array<Record<string, unknown>>, status = 'DOWNLOADING', extra: Record<string, unknown> = {}) {
  const row = {
    id: 'md1', mode: 'QBIT_REVIEWED', status, service, instanceId: 'i1', instanceLabel: 'radarr-4k', arrItemId: 15,
    arrItemTitle: service === 'RADARR' ? 'Night of the Living Dead' : 'Classroom of the Elite', createdArrItem: true, infoHash: HASH,
    lastError: null, updatedAt: T0, targetEpisodeIds: [], baselineFileIds: [], arrCommandId: null,
    pathMapping: { mapping }, files, ...extra,
  };
  mocks.rows.set('md1', structuredClone(row));
  // qBittorrent has the chosen files complete, the others skipped.
  mocks.qbit.getTorrents.mockResolvedValue([{ hash: HASH.toLowerCase(), name: 'x', state: 'stalledUP', category: '', save_path: '/mnt/media/Downloads/', progress: 1 }]);
  mocks.qbit.getTorrentFiles.mockResolvedValue(files.map((entry) => ({
    index: entry.fileIndex, name: entry.path, size: Number(entry.size), priority: entry.selected ? 1 : 0, progress: entry.selected ? 1 : 0,
  })));
  return structuredClone(row) as never;
}
const file = (id: string, index: number, path: string, size: number, selected: boolean, extra: Record<string, unknown> = {}) => ({
  id, fileIndex: index, path, size: BigInt(size), selected, arrPath: null, candidate: null, decision: 'PENDING', episodeIds: [], ...extra,
});
const statuses = () => mocks.moves.map((move) => move.status);
const series = { id: 15, title: 'Classroom of the Elite' };
/** Every folder lists these files (and /data/ its Downloads folder). */
const sonarrSees = (...names: string[]) => mocks.arr.listFolder.mockResolvedValue({ directories: [{ name: 'Downloads', path: '' }], files: names.map((name) => ({ name, path: '', size: 5 })) });

describe('after the chosen files finish', () => {
  it('imports, by copy, the one file Radarr is sure of, and only from the chosen files', async () => {
    const download = downloaded('RADARR', [file('f0', 0, `${FILM}/${FILM}.mkv`, 1000, true), file('f1', 1, `${FILM}/Sample/${FILM}.sample.mkv`, 10, false)]);
    // Radarr's scan also lists the unchosen (part-written) sample; it must be left out.
    mocks.arr.scanImportPath.mockResolvedValue([
      candidate(`/data/Downloads/${FILM}/${FILM}.mkv`),
      candidate(`/data/Downloads/${FILM}/Sample/${FILM}.sample.mkv`, { rejections: [{ reason: 'Sample' }] }),
    ]);

    expect(await settleDownloaded(download, mocks.arr as never)).toBe(true);

    expect(mocks.arr.scanImportPath).toHaveBeenCalledWith(`/data/Downloads/${FILM}`);
    expect(mocks.arr.submitManualImport).toHaveBeenCalledWith([expect.objectContaining({
      path: `/data/Downloads/${FILM}/${FILM}.mkv`, movieId: 15, quality: { quality: { id: 7, name: 'Bluray-1080p' } }, downloadId: '',
    })], 'copy');
    expect(statuses()).toEqual(['IMPORT_PENDING', 'IMPORTING']);
    expect(mocks.moves[1].data).toEqual(expect.objectContaining({ arrCommandId: 77 }));
    // The attempt is kept before Arr is asked, so an interruption after it cannot send it twice.
    expect(mocks.log).toEqual(['keep', 'submit']);
    expect(mocks.rows.get('md1')!.baselineFileIds).toEqual([]);
    expect(mocks.audits).toEqual([expect.objectContaining({ operation: 'IMPORT', filesDeleted: false })]);
    expect(mocks.fileUpdates.filter((update) => 'arrPath' in update.data).map((update) => update.id)).toEqual(['f0']);
  });

  it('asks the user when Radarr cannot tell what a file is, with its reason', async () => {
    const download = downloaded('RADARR', [file('f0', 0, `${FILM}/${FILM}.mkv`, 1000, true)]);
    mocks.arr.scanImportPath.mockResolvedValue([candidate(`/data/Downloads/${FILM}/${FILM}.mkv`, { movie: null, rejections: [{ reason: 'Unknown Movie' }] })]);

    await settleDownloaded(download, mocks.arr as never);

    expect(mocks.moves.at(-1)).toEqual(expect.objectContaining({ status: 'NEEDS_MAPPING', message: expect.stringContaining(`${FILM}.mkv: Unknown Movie`) }));
    expect(mocks.arr.submitManualImport).not.toHaveBeenCalled();
  });

  it('stops when Radarr cannot see a downloaded file where it should', async () => {
    const download = downloaded('RADARR', [file('f0', 0, `${FILM}/${FILM}.mkv`, 999, true)]);
    await settleDownloaded(download, mocks.arr as never);
    expect(mocks.moves.at(-1)).toEqual(expect.objectContaining({ status: 'BLOCKED', message: expect.stringContaining('remote path mappings') }));
    expect(mocks.arr.scanImportPath).not.toHaveBeenCalled();
  });

  it('asks the user when two Sonarr files read as the same episode', async () => {
    sonarrSees('a.mkv', 'b.mkv');
    const download = downloaded('SONARR', [file('f0', 0, 'Show/a.mkv', 5, true), file('f1', 1, 'Show/b.mkv', 5, true)]);
    const episode = { id: 501, seasonNumber: 1, episodeNumber: 5 };
    mocks.arr.scanImportPath.mockResolvedValue([
      candidate('/data/Downloads/Show/a.mkv', { movie: null, series, episodes: [episode] }),
      candidate('/data/Downloads/Show/b.mkv', { movie: null, series, episodes: [episode] }),
    ]);
    await settleDownloaded(download, mocks.arr as never);
    expect(mocks.moves.at(-1)!.message).toContain('b.mkv: another file holds the same episode');
  });

  it('asks the user about a chosen file Arr reads as a whole season, though it also says "Sample"', async () => {
    sonarrSees('a.mkv', 'random.mkv');
    const download = downloaded('SONARR', [file('f0', 0, 'Show.S01/a.mkv', 5, true), file('f1', 1, 'Show.S01/random.mkv', 5, true)]);
    mocks.arr.scanImportPath.mockResolvedValue([
      candidate('/data/Downloads/Show.S01/a.mkv', { movie: null, series, episodes: [{ id: 505, seasonNumber: 1, episodeNumber: 5 }] }),
      candidate('/data/Downloads/Show.S01/random.mkv', {
        movie: null, series, episodes: [{ id: 501, seasonNumber: 1, episodeNumber: 1 }, { id: 502, seasonNumber: 1, episodeNumber: 2 }],
        rejections: [{ reason: 'Single episode file contains all episodes in seasons. Review file name or manually import' }, { reason: 'Sample' }],
      }),
    ]);
    await settleDownloaded(download, mocks.arr as never);
    expect(mocks.moves.at(-1)).toEqual(expect.objectContaining({ status: 'NEEDS_MAPPING', message: expect.stringContaining('random.mkv: Single episode file contains all episodes') }));
    expect(mocks.arr.submitManualImport).not.toHaveBeenCalled();
  });

  it('leaves out on its own only a file named a sample, never one whose title or folder merely contains the word', async () => {
    sonarrSees('Samples.of.Life.S01E01.mkv', 'Samples.of.Life.S01E02.mkv');
    const download = downloaded('SONARR', [
      file('f0', 0, 'Samples.of.Life.S01/Samples.of.Life.S01E01.mkv', 5, true),
      file('f1', 1, 'Samples.of.Life.S01/Samples.of.Life.S01E02.mkv', 5, true),
    ]);
    mocks.arr.scanImportPath.mockResolvedValue([
      candidate('/data/Downloads/Samples.of.Life.S01/Samples.of.Life.S01E01.mkv', { movie: null, series, episodes: [{ id: 501, seasonNumber: 1, episodeNumber: 1 }], rejections: [{ reason: 'Sample' }] }),
      candidate('/data/Downloads/Samples.of.Life.S01/Samples.of.Life.S01E02.mkv', { movie: null, series, episodes: [{ id: 502, seasonNumber: 1, episodeNumber: 2 }] }),
    ]);
    await settleDownloaded(download, mocks.arr as never);
    expect(mocks.moves.at(-1)).toEqual(expect.objectContaining({ status: 'NEEDS_MAPPING', message: expect.stringContaining('Samples.of.Life.S01E01.mkv: Sample') }));

    // A real sample, in a Sample folder and named one, is left out while the episode imports.
    mocks.moves = [];
    mocks.arr.getEpisodes = vi.fn(async () => [{ id: 501, episodeFileId: 0 }]);
    mocks.arr.listFolder.mockImplementation(async (folder: string) => ({
      directories: [{ name: 'Downloads', path: '' }], files: folder.endsWith('Sample/') ? [{ name: 'show.s01e01.sample.mkv', path: '', size: 5 }] : [{ name: 'show.s01e01.mkv', path: '', size: 5 }],
    }));
    const again = downloaded('SONARR', [file('f0', 0, 'Show.S01/show.s01e01.mkv', 5, true), file('f1', 1, 'Show.S01/Sample/show.s01e01.sample.mkv', 5, true)]);
    mocks.arr.scanImportPath.mockResolvedValue([
      candidate('/data/Downloads/Show.S01/show.s01e01.mkv', { movie: null, series, episodes: [{ id: 501, seasonNumber: 1, episodeNumber: 1 }] }),
      candidate('/data/Downloads/Show.S01/Sample/show.s01e01.sample.mkv', { movie: null, series, episodes: [{ id: 501, seasonNumber: 1, episodeNumber: 1 }], rejections: [{ reason: 'Sample' }] }),
    ]);
    await settleDownloaded(again, mocks.arr as never);
    expect(statuses()).toEqual(['IMPORT_PENDING', 'IMPORTING']);
    const files = mocks.rows.get('md1')!.files as Array<{ id: string; decision: string }>;
    expect(files.map((entry) => [entry.id, entry.decision])).toEqual([['f0', 'IMPORT'], ['f1', 'IGNORE']]);
  });

  it("matches each chosen file by its exact name: an unchosen A.mkv never lends its verdict to a.mkv", async () => {
    sonarrSees('a.mkv', 'A.mkv');
    mocks.arr.getEpisodes = vi.fn(async () => [{ id: 501, episodeFileId: 0 }, { id: 502, episodeFileId: 0 }]);
    const download = downloaded('SONARR', [file('f0', 0, 'Show/a.mkv', 5, true), file('f1', 1, 'Show/A.mkv', 5, false)]);
    mocks.arr.scanImportPath.mockResolvedValue([
      candidate('/data/Downloads/Show/A.mkv', { movie: null, series, episodes: [{ id: 502, seasonNumber: 1, episodeNumber: 2 }], quality: { quality: { id: 1, name: 'SDTV' } } }),
      candidate('/data/Downloads/Show/a.mkv', { movie: null, series, episodes: [{ id: 501, seasonNumber: 1, episodeNumber: 1 }] }),
    ]);
    await settleDownloaded(download, mocks.arr as never);
    expect(mocks.arr.submitManualImport).toHaveBeenCalledWith([expect.objectContaining({
      path: '/data/Downloads/Show/a.mkv', episodeIds: [501], quality: { quality: { id: 7, name: 'Bluray-1080p' } },
    })], 'copy');
  });

  it('asks the user about a chosen video Arr leaves out, but not about a chosen .nfo', async () => {
    mocks.arr.listFolder.mockImplementation(async (folder: string) => ({
      directories: [{ name: 'Downloads', path: '' }], files: folder.endsWith('Extras/') ? [{ name: 'Making.Of.mkv', path: '', size: 5 }] : [{ name: 'a.mkv', path: '', size: 5 }, { name: 'a.nfo', path: '', size: 5 }],
    }));
    const download = downloaded('SONARR', [file('f0', 0, 'Show/a.mkv', 5, true), file('f1', 1, 'Show/a.nfo', 5, true), file('f2', 2, 'Show/Extras/Making.Of.mkv', 5, true)]);
    // Sonarr skips videos under an Extras folder.
    mocks.arr.scanImportPath.mockResolvedValue([candidate('/data/Downloads/Show/a.mkv', { movie: null, series, episodes: [{ id: 501, seasonNumber: 1, episodeNumber: 1 }] })]);
    await settleDownloaded(download, mocks.arr as never);
    expect(mocks.moves.at(-1)).toEqual(expect.objectContaining({ status: 'NEEDS_MAPPING' }));
    expect(mocks.moves.at(-1)!.message).toContain('Making.Of.mkv: Sonarr did not offer it for import');
    expect(mocks.moves.at(-1)!.message).not.toContain('a.nfo');
    expect(mocks.arr.submitManualImport).not.toHaveBeenCalled();
  });

  it("reads the files through the mapping as it is now, after the user fixed it, and keeps it", async () => {
    // Created when Radarr saw /mnt/media through /data/; the mapping now says /storage/.
    const download = downloaded('RADARR', [file('f0', 0, `${FILM}/${FILM}.mkv`, 1000, true)], 'BLOCKED');
    mocks.arr.getRemotePathMappings.mockResolvedValue([{ id: 1, ...mapping, localPath: '/storage/' }]);
    mocks.arr.listFolder.mockImplementation(async (folder: string) => {
      if (folder === '/storage/') return { directories: [{ name: 'Downloads', path: '' }], files: [] };
      if (folder === `/storage/Downloads/${FILM}/`) return { directories: [], files: [{ name: `${FILM}.mkv`, path: '', size: 1000 }] };
      return { directories: [], files: [] };
    });
    mocks.arr.scanImportPath.mockResolvedValue([candidate(`/storage/Downloads/${FILM}/${FILM}.mkv`)]);
    await settleDownloaded(download, mocks.arr as never);
    expect(mocks.rows.get('md1')!.pathMapping).toEqual({ mapping: { ...mapping, localPath: '/storage/' } });
    expect(mocks.arr.submitManualImport).toHaveBeenCalledWith([expect.objectContaining({ path: `/storage/Downloads/${FILM}/${FILM}.mkv` })], 'copy');
  });

  it('scans once when two scans race', async () => {
    const download = downloaded('RADARR', [file('f0', 0, `${FILM}/${FILM}.mkv`, 1000, true)]);
    await settleDownloaded(download, mocks.arr as never);
    // The second one still holds the download as it read it (DOWNLOADING).
    expect(await settleDownloaded(download, mocks.arr as never)).toBe(false);
    expect(mocks.arr.submitManualImport).toHaveBeenCalledTimes(1);
  });

  describe('checks the chosen files in qBittorrent first', () => {
    const chosen = () => [file('f0', 0, `${FILM}/${FILM}.mkv`, 1000, true), file('f1', 1, `${FILM}/${FILM}.nfo`, 1, false)];
    const qbitFiles = (overrides: Record<string, unknown>) => [
      { index: 0, name: `${FILM}/${FILM}.mkv`, size: 1000, priority: 1, progress: 1, ...overrides },
      { index: 1, name: `${FILM}/${FILM}.nfo`, size: 1, priority: 0, progress: 0 },
    ];

    it('waits for a chosen file still downloading, though the torrent says it is complete', async () => {
      const download = downloaded('RADARR', chosen());
      mocks.qbit.getTorrentFiles.mockResolvedValue(qbitFiles({ progress: 0.6 }));
      expect(await settleDownloaded(download, mocks.arr as never)).toBe(true);
      expect(mocks.moves).toEqual([]);
      expect(mocks.arr.scanImportPath).not.toHaveBeenCalled();
    });

    it('stops for a chosen file set not to download, or renamed, in qBittorrent', async () => {
      const deselected = downloaded('RADARR', chosen());
      mocks.qbit.getTorrentFiles.mockResolvedValue(qbitFiles({ priority: 0, progress: 0.2 }));
      await settleDownloaded(deselected, mocks.arr as never);
      expect(mocks.moves).toEqual([expect.objectContaining({ status: 'BLOCKED', message: expect.stringContaining('was set not to download in qBittorrent') })]);

      mocks.moves = [];
      const renamed = downloaded('RADARR', chosen());
      mocks.qbit.getTorrentFiles.mockResolvedValue(qbitFiles({ name: `${FILM}/renamed.mkv` }));
      await settleDownloaded(renamed, mocks.arr as never);
      expect(mocks.moves).toEqual([expect.objectContaining({ status: 'BLOCKED', message: expect.stringContaining('no longer in the torrent as it was chosen') })]);
      expect(mocks.arr.scanImportPath).not.toHaveBeenCalled();
    });

    it('waits while qBittorrent moves the files', async () => {
      const download = downloaded('RADARR', chosen(), 'BLOCKED');
      mocks.qbit.getTorrents.mockResolvedValue([{ hash: HASH.toLowerCase(), name: 'x', state: 'moving', save_path: '/mnt/media/Downloads/', progress: 1 }]);
      await settleDownloaded(download, mocks.arr as never);
      expect(mocks.moves).toEqual([expect.objectContaining({ status: 'DOWNLOADING' })]);
      expect(mocks.arr.scanImportPath).not.toHaveBeenCalled();
    });
  });

  it("stops before importing when Radarr would also pick up an extra file the user did not choose", async () => {
    mocks.arr.getMediaManagementConfig.mockResolvedValue({ recycleBin: '', importExtraFiles: true, extraFileExtensions: 'srt, .sub' });
    mocks.arr.listFolder.mockResolvedValue({ directories: [{ name: 'Downloads', path: '' }], files: [{ name: 'a.mkv', path: '', size: 1000 }, { name: 'a.en.srt', path: '', size: 3 }, { name: 'other.SRT', path: '', size: 3 }] });
    const download = downloaded('RADARR', [file('f0', 0, 'a.mkv', 1000, true), file('f1', 1, 'a.en.srt', 3, true)]);
    // Each file is read on its own (no torrent folder); a subtitle is no candidate.
    mocks.arr.scanImportPath.mockImplementation(async (path: string) => (path.endsWith('.mkv') ? [candidate(path)] : []));

    await settleDownloaded(download, mocks.arr as never);

    expect(mocks.moves.at(-1)).toEqual(expect.objectContaining({ status: 'BLOCKED', message: expect.stringContaining('/data/Downloads/ also holds other.SRT, which this download did not choose') }));
    expect(mocks.arr.submitManualImport).not.toHaveBeenCalled();

    // Only chosen extras next to the video: it imports.
    mocks.moves = [];
    mocks.arr.listFolder.mockResolvedValue({ directories: [{ name: 'Downloads', path: '' }], files: [{ name: 'a.mkv', path: '', size: 1000 }, { name: 'a.en.srt', path: '', size: 3 }] });
    await settleDownloaded(downloaded('RADARR', [file('f0', 0, 'a.mkv', 1000, true), file('f1', 1, 'a.en.srt', 3, true)]), mocks.arr as never);
    expect(statuses()).toEqual(['IMPORT_PENDING', 'IMPORTING']);
  });

  it('records that an upgrade may replace the file already there', async () => {
    mocks.arr.getMovieFiles.mockResolvedValue([{ id: 40 }]);
    await settleDownloaded(downloaded('RADARR', [file('f0', 0, `${FILM}/${FILM}.mkv`, 1000, true)]), mocks.arr as never);
    expect(mocks.audits).toEqual([expect.objectContaining({ operation: 'IMPORT', filesDeleted: null, details: expect.objectContaining({ replacesFileIds: [40] }) })]);
  });

  it('takes a lost answer as sent when Radarr lists the import command', async () => {
    mocks.arr.submitManualImport.mockRejectedValue(new Error('timeout of 30000ms exceeded'));
    mocks.arr.getCommands.mockResolvedValue([
      { id: 81, name: 'ManualImport', queued: new Date(Date.now() - 1000).toISOString(), body: { files: [{ path: `/data/Downloads/${FILM}/${FILM}.mkv` }] } },
    ]);
    await settleDownloaded(downloaded('RADARR', [file('f0', 0, `${FILM}/${FILM}.mkv`, 1000, true)]), mocks.arr as never);
    expect(mocks.moves.at(-1)).toEqual(expect.objectContaining({ status: 'IMPORTING', data: expect.objectContaining({ arrCommandId: 81 }) }));
  });
});

describe('picking up an import Helprr was interrupted in', () => {
  const STALE = new Date(Date.now() - 15 * 60_000);
  const decided = () => downloaded('SONARR', [
    file('f0', 0, 'Show/a.mkv', 5, true, { arrPath: '/data/Downloads/Show/a.mkv', candidate: candidate('/data/Downloads/Show/a.mkv'), decision: 'IMPORT', episodeIds: [502] }),
    file('f1', 1, 'Show/b.mkv', 5, true, { arrPath: '/data/Downloads/Show/b.mkv', candidate: candidate('/data/Downloads/Show/b.mkv'), decision: 'IGNORE' }),
  ], 'IMPORT_PENDING', { updatedAt: STALE, targetEpisodeIds: [502], baselineFileIds: { 502: 0 } });

  it('keeps what was decided: no new reading, and nothing sent again', async () => {
    mocks.arr.getCommands.mockResolvedValue([
      { id: 90, name: 'ManualImport', queued: new Date(STALE.getTime() + 500).toISOString(), body: { files: [{ path: '/data/Downloads/Show/a.mkv' }] } },
    ]);
    expect(await settleDownloaded(decided(), mocks.arr as never)).toBe(true);
    expect(mocks.arr.scanImportPath).not.toHaveBeenCalled();
    expect(mocks.arr.submitManualImport).not.toHaveBeenCalled();
    expect(statuses()).toEqual(['IMPORT_PENDING', 'IMPORTING']);
    expect(mocks.moves[1].data).toEqual(expect.objectContaining({ arrCommandId: 90 }));
    const files = mocks.rows.get('md1')!.files as Array<{ decision: string; episodeIds: number[] }>;
    expect(files.map((entry) => [entry.decision, entry.episodeIds])).toEqual([['IMPORT', [502]], ['IGNORE', []]]);
  });

  it("is done when Sonarr's history has the import, and otherwise leaves it to the user", async () => {
    mocks.arr.getSeriesHistory.mockResolvedValue([{ eventType: 'downloadFolderImported', episodeId: 502, data: { droppedPath: '/data/Downloads/Show/a.mkv', fileId: '61' } }]);
    await settleDownloaded(decided(), mocks.arr as never);
    expect(mocks.moves.at(-1)).toEqual(expect.objectContaining({ status: 'IMPORTED', data: expect.objectContaining({ importedFileIds: [61] }) }));

    mocks.moves = [];
    mocks.arr.getSeriesHistory.mockResolvedValue([]);
    await settleDownloaded(decided(), mocks.arr as never);
    expect(mocks.moves.at(-1)).toEqual(expect.objectContaining({ status: 'BLOCKED', message: expect.stringContaining('shows no sign of it') }));
    expect(mocks.arr.submitManualImport).not.toHaveBeenCalled();
  });

  it('is picked up once when two pollers find it at the same time', async () => {
    const read = decided();
    // Both read the same expired claim; the second must lose though the status is still IMPORT_PENDING.
    expect(await Promise.all([settleDownloaded(read, mocks.arr as never), settleDownloaded(read, mocks.arr as never)])).toEqual([true, false]);
    expect(mocks.arr.getCommands).toHaveBeenCalledTimes(1);
  });
});

describe('proving a fallback import', () => {
  it("needs Radarr's history of this file's own import: a new file from another download proves nothing", async () => {
    downloaded('RADARR', [file('f0', 0, 'a.mkv', 5, true, { arrPath: '/data/Downloads/a.mkv', decision: 'IMPORT' })], 'IMPORTING', { baselineFileIds: [40] });
    const read = mocks.rows.get('md1') as never;
    mocks.arr.getMovieHistory.mockResolvedValue([
      { eventType: 'downloadFolderImported', movieId: 15, data: { droppedPath: '/data/Downloads/Other.Release/b.mkv', fileId: '41' } },
    ]);
    expect(await fallbackImportProof(read, mocks.arr as never)).toEqual({ proved: false, fileIds: [], missing: 1 });
    expect(mocks.arr.getMovieHistory).toHaveBeenCalledWith(15, 3);

    mocks.arr.getMovieHistory.mockResolvedValue([
      { eventType: 'downloadFolderImported', movieId: 15, data: { droppedPath: '/data/Downloads/a.mkv', fileId: '42' } },
    ]);
    expect(await fallbackImportProof(read, mocks.arr as never)).toEqual({ proved: true, fileIds: [42], missing: 0 });
  });

  it('needs every target episode imported from its own file', async () => {
    downloaded('SONARR', [
      file('f0', 0, 'Show/a.mkv', 5, true, { arrPath: '/data/Downloads/Show/a.mkv', decision: 'IMPORT', episodeIds: [501] }),
      file('f1', 1, 'Show/b.mkv', 5, true, { arrPath: '/data/Downloads/Show/b.mkv', decision: 'IMPORT', episodeIds: [502] }),
    ], 'IMPORTING', { targetEpisodeIds: [501, 502], baselineFileIds: { 501: 0, 502: 0 } });
    mocks.arr.getSeriesHistory.mockResolvedValue([
      { eventType: 'downloadFolderImported', episodeId: 501, data: { droppedPath: '/data/Downloads/Show/a.mkv', fileId: '60' } },
      // Episode 2 came from another release.
      { eventType: 'downloadFolderImported', episodeId: 502, data: { droppedPath: '/data/Downloads/Other/e02.mkv', fileId: '61' } },
    ]);
    expect(await fallbackImportProof(mocks.rows.get('md1') as never, mocks.arr as never)).toEqual({ proved: false, fileIds: [60], missing: 1 });
  });
});

describe("importing the user's decisions", () => {
  const scanned = (service: 'RADARR' | 'SONARR', status = 'NEEDS_MAPPING') => downloaded(service, [
    file('f0', 0, 'Show/a.mkv', 5, true, { arrPath: '/data/Downloads/Show/a.mkv', candidate: candidate('/data/Downloads/Show/a.mkv') }),
    file('f1', 1, 'Show/b.mkv', 5, true, { arrPath: '/data/Downloads/Show/b.mkv', candidate: candidate('/data/Downloads/Show/b.mkv') }),
    file('f2', 2, 'Show/c.mkv', 5, false, { arrPath: '/data/Downloads/Show/c.mkv' }),
    file('f3', 3, 'Show/d.mkv', 5, true, { arrPath: '/data/Downloads/Show/d.mkv' }),
  ], status);
  const actor = { id: 'u1', username: 'admin' };
  beforeEach(() => sonarrSees('a.mkv', 'b.mkv', 'd.mkv'));

  it('never imports a file that was not chosen and downloaded, or one Arr did not offer', async () => {
    await expect(importFallback(scanned('RADARR'), mocks.arr as never, [{ fileId: 'f2', decision: 'IMPORT' }], actor)).rejects.toThrow('not one of the downloaded files');
    await expect(importFallback(scanned('RADARR'), mocks.arr as never, [{ fileId: 'nope', decision: 'IMPORT' }], actor)).rejects.toThrow('not one of the downloaded files');
    await expect(importFallback(scanned('RADARR'), mocks.arr as never, [{ fileId: 'f3', decision: 'IMPORT' }], actor)).rejects.toThrow('Radarr did not offer d.mkv for import');
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
    expect(mocks.rows.get('md1')).toEqual(expect.objectContaining({ targetEpisodeIds: [501, 502], baselineFileIds: { 501: 0, 502: 33 } }));
  });

  it('imports once when the same decisions are submitted twice, and says why Arr refused one', async () => {
    const download = scanned('RADARR');
    await importFallback(download, mocks.arr as never, [{ fileId: 'f0', decision: 'IMPORT' }], actor);
    await expect(importFallback(download, mocks.arr as never, [{ fileId: 'f0', decision: 'IMPORT' }], actor)).rejects.toThrow('already being imported');
    expect(mocks.arr.submitManualImport).toHaveBeenCalledTimes(1);

    mocks.moves = [];
    mocks.arr.submitManualImport.mockRejectedValue(new Error('Request failed with status code 500'));
    await expect(importFallback(scanned('RADARR'), mocks.arr as never, [{ fileId: 'f0', decision: 'IMPORT' }], actor)).rejects.toThrow('did not take the import: Request failed with status code 500');
    expect(mocks.moves.at(-1)).toEqual(expect.objectContaining({ status: 'BLOCKED' }));
  });

  it('refuses while a scan or another import has it', async () => {
    await expect(importFallback(scanned('RADARR', 'IMPORT_PENDING'), mocks.arr as never, [{ fileId: 'f0', decision: 'IMPORT' }], actor)).rejects.toThrow('already being read or imported');
    expect(mocks.moves).toEqual([]);
  });

  it('checks the files again in qBittorrent and where Arr reads them', async () => {
    const download = scanned('RADARR');
    mocks.qbit.getTorrentFiles.mockResolvedValue([
      { index: 0, name: 'Show/a-renamed.mkv', size: 5, priority: 1, progress: 1 },
      { index: 1, name: 'Show/b.mkv', size: 5, priority: 1, progress: 1 },
    ]);
    await expect(importFallback(download, mocks.arr as never, [{ fileId: 'f0', decision: 'IMPORT' }], actor)).rejects.toThrow('no longer in the torrent as it was chosen');
    expect(mocks.moves).toEqual([expect.objectContaining({ status: 'BLOCKED' })]);

    mocks.moves = [];
    const moved = scanned('RADARR');
    mocks.arr.getRemotePathMappings.mockResolvedValue([{ id: 1, ...mapping, localPath: '/storage/' }]);
    mocks.arr.listFolder.mockResolvedValue({ directories: [{ name: 'Downloads', path: '' }], files: [{ name: 'a.mkv', path: '', size: 5 }] });
    await expect(importFallback(moved, mocks.arr as never, [{ fileId: 'f0', decision: 'IMPORT' }], actor)).rejects.toThrow('is not where Radarr read it any more. Scan again.');
    expect(mocks.arr.submitManualImport).not.toHaveBeenCalled();
  });

  it('imports one file for a movie', async () => {
    await expect(importFallback(scanned('RADARR'), mocks.arr as never, [
      { fileId: 'f0', decision: 'IMPORT' }, { fileId: 'f1', decision: 'IMPORT' },
    ], actor)).rejects.toThrow('Import one file');
  });
});
