import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreflightResult } from '../preflight';

type Row = Record<string, unknown> & { id: string; events: Array<{ status: string; message: string | null; at: Date }> };

const mocks = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
  preflight: vi.fn(),
  client: {} as Record<string, ReturnType<typeof vi.fn>>,
  audits: [] as Array<{ operation: string; details: Record<string, unknown> }>,
  offer: vi.fn(async () => 'http://helprr.lan/api/manual-downloads/torrent/TOKEN'),
  withdraw: vi.fn(async () => {}),
  // Other open workflows for the same title, and Arr's queue.
  others: 0,
  queue: [] as unknown[],
  connection: vi.fn(async () => ({ id: 'i1', label: 'Arr' })),
}));

vi.mock('@/lib/db', () => {
  const manualDownload = {
    findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const key = where.createdByUserId_clientRequestId as { createdByUserId: string; clientRequestId: string } | undefined;
      const row = key
        ? [...mocks.rows.values()].find((r) => r.createdByUserId === key.createdByUserId && r.clientRequestId === key.clientRequestId)
        : mocks.rows.get(where.id as string);
      return row ?? null;
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => mocks.rows.get(where.id)!),
    // The active workflow for the same instance and release, as the lock-protected check sees it.
    findFirst: vi.fn(async () => [...mocks.rows.values()].find((r) => !['IMPORTED', 'FAILED', 'CANCELLED'].includes(r.status as string)) ?? null),
    count: vi.fn(async () => mocks.others),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const id = `md${mocks.rows.size + 1}`;
      const { events, ...rest } = data as { events: { create: { status: string; message: string } } };
      mocks.rows.set(id, { id, ...rest, events: [{ ...events.create, at: new Date() }] } as Row);
      return { id };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = mocks.rows.get(where.id)!;
      const { events, attempts, ...rest } = data as { events?: { create: { status: string; message: string } }; attempts?: { increment: number } };
      Object.assign(row, rest);
      if (attempts) row.attempts = ((row.attempts as number) ?? 0) + attempts.increment;
      if (events) row.events.push({ ...events.create, at: new Date() });
      return row;
    }),
  };
  const tx = { $executeRaw: vi.fn(async () => 1), manualDownload };
  // One transaction at a time, as the advisory lock makes it.
  let lock: Promise<unknown> = Promise.resolve();
  const $transaction = (fn: (t: typeof tx) => unknown) => {
    const run = lock.then(() => fn(tx));
    lock = run.catch(() => {});
    return run;
  };
  return { prisma: { manualDownload, $transaction } };
});
vi.mock('@/lib/arr-instances', () => ({ resolveConnection: mocks.connection }));
vi.mock('@/lib/activity-queue', () => ({ fetchAllQueueRecords: async () => ({ records: mocks.queue }) }));
vi.mock('@/lib/cache/tagged-library', () => ({ invalidateTaggedLibrary: vi.fn(async () => {}) }));
vi.mock('@/lib/file-audit', () => ({
  runWithOperationAudit: async (input: { operation: string; details: Record<string, unknown> }, call: () => Promise<unknown>) => {
    mocks.audits.push({ operation: input.operation, details: input.details });
    return call();
  },
}));
vi.mock('../torrent-link', () => ({ offerTorrentToArr: mocks.offer, withdrawTorrentLink: mocks.withdraw }));
vi.mock('../preflight', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../preflight')>()),
  preflightManualDownload: mocks.preflight,
  arrClientFor: () => mocks.client,
  resolveArrCallbackOrigin: () => 'http://helprr.lan',
}));

import { AxiosError, AxiosHeaders } from 'axios';
import { ManualDownloadRefusedError, sendManualDownload } from '../send';
import { parseMagnet } from '../release-source';

const HASH = '382CC016FF22946008ECDDCB0DDA820F42B0CD5A';
const RELEASE = 'Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP';
const source = parseMagnet(`magnet:?xt=urn:btih:${HASH}&dn=${RELEASE}`);
const actor = { id: 'u1', username: 'admin' };
const ADD = { qualityProfileId: 1, rootFolderPath: '/movies', tags: [] };

function plan(service: 'RADARR' | 'SONARR', overrides: Partial<PreflightResult['plan']> = {}): PreflightResult {
  return {
    ok: true, errors: [], warnings: [],
    plan: {
      service, instance: { id: 'i1', label: 'Arr' },
      target: { externalId: 10331, title: 'Night of the Living Dead', year: 1968, existingId: null },
      release: { title: RELEASE, name: RELEASE, infoHash: HASH, source: 'MAGNET' },
      parsed: null, episodes: [], downloadClient: { id: 1, name: 'qBittorrent' }, downloadClientChoices: [],
      ...overrides,
    },
  };
}
const grab = (extra: Record<string, unknown> = {}) => ({ eventType: 'grabbed', date: new Date().toISOString(), movieId: 15, data: { downloadClientName: 'qBittorrent' }, ...extra });

function radarrClient() {
  return {
    addMovie: vi.fn(async () => ({ id: 15 })),
    getMovieById: vi.fn(async () => ({ id: 15, monitored: false })),
    updateMovie: vi.fn(async () => ({})),
    getMovieFiles: vi.fn(async () => []),
    deleteMovie: vi.fn(async () => {}),
    pushRelease: vi.fn(async () => ({ approved: true, rejected: false, rejections: [] })),
    getHistory: vi.fn(async () => ({ records: [grab()] })),
  };
}

async function settle<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  promise.then(() => { done = true; }, () => { done = true; });
  while (!done) await vi.advanceTimersByTimeAsync(500);
  return promise;
}
const send = (overrides: Record<string, unknown> = {}, requestId = 'req-00001') =>
  settle(sendManualDownload({ service: 'RADARR', instanceId: 'i1', externalId: 10331, source, releaseTitle: RELEASE, add: ADD, ...overrides } as never, requestId, actor));

beforeEach(() => {
  vi.useFakeTimers();
  mocks.rows.clear();
  mocks.others = 0;
  mocks.queue = [];
  mocks.connection.mockResolvedValue({ id: 'i1', label: 'Arr' });
  mocks.audits.length = 0;
  vi.clearAllMocks();
  mocks.client = radarrClient();
  mocks.preflight.mockResolvedValue(plan('RADARR'));
});
afterEach(() => { vi.useRealTimers(); });

describe('sending a film to Radarr', () => {
  it('adds the film with searches off, pushes the release and proves the grab', async () => {
    const download = await send();

    expect(mocks.client.addMovie).toHaveBeenCalledWith({
      title: 'Night of the Living Dead', tmdbId: 10331, year: 1968, qualityProfileId: 1, rootFolderPath: '/movies', tags: [],
      monitored: true, minimumAvailability: 'released', addOptions: { searchForMovie: false, monitor: 'movieOnly' },
    });
    expect(mocks.client.pushRelease).toHaveBeenCalledWith(expect.objectContaining({
      title: RELEASE, protocol: 'torrent', magnetUrl: source.magnetUrl, tmdbId: 10331, downloadClientId: 1,
    }));
    expect(mocks.client.getHistory).toHaveBeenCalledWith(1, 1000, 'date', 'descending', { downloadId: HASH });
    expect(download).toEqual(expect.objectContaining({ status: 'QUEUED', arrItemId: 15, createdArrItem: true, downloadClientName: 'qBittorrent', attempts: 1 }));
    expect(download.events.map((event) => event.status)).toEqual(['PREFLIGHT', 'CREATING_MEDIA', 'SUBMITTING_RELEASE', 'QUEUED']);
    expect(mocks.audits.map((audit) => audit.operation)).toEqual(['CREATE_MEDIA', 'PUSH_RELEASE']);
    // The audit keeps the hash and name, never the magnet.
    expect(JSON.stringify(mocks.audits)).not.toContain('magnet:');
  });

  it('removes the film it added when Radarr turns the release down', async () => {
    mocks.client.pushRelease.mockResolvedValue({ approved: false, rejected: true, rejections: ['Unknown is not wanted in profile'] });

    const download = await send();

    expect(download.status).toBe('FAILED');
    expect(download.lastError).toContain('Unknown is not wanted in profile');
    expect(download.lastError).toContain('was removed again');
    expect(mocks.client.deleteMovie).toHaveBeenCalledWith(15, false, false);
    expect(mocks.audits.map((audit) => audit.operation)).toEqual(['CREATE_MEDIA', 'PUSH_RELEASE', 'DELETE_MEDIA']);
    // Its page no longer links to a film that is gone.
    expect(download.arrItemId).toBeNull();
  });

  it('fails an approved release that was never grabbed', async () => {
    mocks.client.getHistory.mockResolvedValue({ records: [] });

    const download = await send();

    expect(download.status).toBe('FAILED');
    expect(download.lastError).toContain('accepted the release but did not grab it');
    expect(mocks.client.deleteMovie).toHaveBeenCalled();
  });

  it('flags a grab for a different film instead of calling it done', async () => {
    mocks.client.getHistory.mockResolvedValue({ records: [grab({ movieId: 99 })] });

    const download = await send();

    expect(download.status).toBe('BLOCKED');
    expect(mocks.client.deleteMovie).not.toHaveBeenCalled();
  });

  it('trusts the history when the push answer is lost after the grab', async () => {
    mocks.client.pushRelease.mockRejectedValue(new Error('socket hang up'));
    expect((await send()).status).toBe('QUEUED');
  });

  it('keeps the film it added when it cannot tell whether Radarr grabbed the release', async () => {
    mocks.client.pushRelease.mockRejectedValue(new Error('socket hang up'));
    mocks.client.getHistory.mockResolvedValue({ records: [] });
    const lost = await send();
    expect(lost.status).toBe('BLOCKED');
    expect(lost.lastError).toContain('could not confirm that Radarr grabbed it: socket hang up');

    mocks.rows.clear();
    mocks.client.pushRelease.mockResolvedValue({ approved: true, rejected: false, rejections: [] });
    mocks.client.getHistory.mockRejectedValue(new Error('timeout of 15000ms exceeded'));
    expect((await send({}, 'req-00002')).status).toBe('BLOCKED');
    expect(mocks.client.deleteMovie).not.toHaveBeenCalled();
  });

  it('removes the film it added when Radarr answers the push with an error and grabs nothing', async () => {
    const response = { status: 400, statusText: 'Bad Request', headers: {}, config: { headers: new AxiosHeaders() }, data: {} };
    mocks.client.pushRelease.mockRejectedValue(new AxiosError('Request failed with status code 400', 'ERR_BAD_REQUEST', undefined, undefined, response));
    mocks.client.getHistory.mockResolvedValue({ records: [] });

    const download = await send();

    expect(download.status).toBe('FAILED');
    expect(download.lastError).toContain('status code 400');
    expect(mocks.client.deleteMovie).toHaveBeenCalledWith(15, false, false);
  });

  it("keeps the film when a gateway's 5xx stands between Helprr and Radarr's answer", async () => {
    const response = { status: 504, statusText: 'Gateway Timeout', headers: {}, config: { headers: new AxiosHeaders() }, data: {} };
    mocks.client.pushRelease.mockRejectedValue(new AxiosError('Request failed with status code 504', 'ERR_BAD_RESPONSE', undefined, undefined, response));
    mocks.client.getHistory.mockResolvedValue({ records: [] });

    const download = await send();

    expect(download.status).toBe('BLOCKED');
    expect(mocks.client.deleteMovie).not.toHaveBeenCalled();
  });

  it("does not take an earlier send's grab of the same release as this one's", async () => {
    mocks.client.getHistory.mockResolvedValue({ records: [grab({ date: new Date(Date.now() - 13 * 3_600_000).toISOString() })] });

    const download = await send();

    expect(download.status).toBe('FAILED');
    expect(download.lastError).toContain('accepted the release but did not grab it');
  });

  it('hands the same submission sent twice at once the one workflow', async () => {
    const [first, second] = await Promise.all([send(), send()]);
    expect(second.id).toBe(first.id);
    expect(mocks.client.pushRelease).toHaveBeenCalledTimes(1);
  });

  it('leaves a film it added once it has files', async () => {
    mocks.client.pushRelease.mockResolvedValue({ approved: false, rejected: true, rejections: ['nope'] });
    mocks.client.getMovieFiles.mockResolvedValueOnce([]).mockResolvedValue([{ id: 7 }]);

    const download = await send();

    expect(download.lastError).toContain('already has files');
    expect(mocks.client.deleteMovie).not.toHaveBeenCalled();
  });

  it('monitors an existing film only when allowed, and never removes it', async () => {
    mocks.preflight.mockResolvedValue(plan('RADARR', { target: { externalId: 10331, title: 'Night of the Living Dead', year: 1968, existingId: 15 } }));
    mocks.client.pushRelease.mockResolvedValue({ approved: false, rejected: true, rejections: ['nope'] });

    const download = await send({ add: undefined, monitorTarget: true });

    expect(mocks.client.addMovie).not.toHaveBeenCalled();
    expect(mocks.client.updateMovie).toHaveBeenCalledWith({ id: 15, monitored: true });
    expect(download.status).toBe('FAILED');
    expect(mocks.client.deleteMovie).not.toHaveBeenCalled();
  });

  it('hands Radarr a single-use link for a .torrent, and withdraws it afterwards', async () => {
    const torrent = { kind: 'TORRENT_FILE' as const, infoHash: HASH, name: RELEASE, private: false, bytes: Buffer.from('d4:infod4:name1:xee') };

    await send({ source: torrent });

    expect(mocks.offer).toHaveBeenCalledWith(torrent.bytes, 'http://helprr.lan');
    expect(mocks.client.pushRelease).toHaveBeenCalledWith(expect.objectContaining({ downloadUrl: 'http://helprr.lan/api/manual-downloads/torrent/TOKEN' }));
    expect(mocks.withdraw).toHaveBeenCalledWith('http://helprr.lan/api/manual-downloads/torrent/TOKEN');
  });

  it('returns the workflow the same submission recorded while its preflight ran', async () => {
    const first = await send();
    // The second copy looked before the first recorded, then its preflight saw the first as active.
    mocks.preflight.mockResolvedValue({ ...plan('RADARR'), ok: false, errors: [{ code: 'ALREADY_ACTIVE', message: 'This release is already being sent.' }] });
    const original = mocks.rows.get(first.id)!;
    vi.mocked((await import('@/lib/db')).prisma.manualDownload.findUnique)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(original as never);
    expect((await send()).id).toBe(first.id);
  });

  it('keeps a film it added when another download is on its way for it', async () => {
    mocks.client.pushRelease.mockResolvedValue({ approved: false, rejected: true, rejections: ['nope'] });
    mocks.others = 1;

    const download = await send();

    expect(download.lastError).toContain('another download is on its way for it');
    expect(mocks.client.deleteMovie).not.toHaveBeenCalled();
  });

  it('adopts a film Radarr added though its answer was lost, and carries on', async () => {
    mocks.client.addMovie.mockRejectedValue(new Error('socket hang up'));
    mocks.client.lookupMovie = vi.fn(async () => [{ id: 15, tmdbId: 10331 }]);

    const download = await send();

    expect(download).toEqual(expect.objectContaining({ status: 'QUEUED', arrItemId: 15, createdArrItem: true }));
  });

  it('waits for a film Radarr is still adding after the answer timed out', async () => {
    mocks.client.addMovie.mockRejectedValue(new AxiosError('timeout of 30000ms exceeded', 'ECONNABORTED'));
    mocks.client.lookupMovie = vi.fn()
      .mockResolvedValueOnce([{ tmdbId: 10331 }])
      .mockResolvedValueOnce([{ tmdbId: 10331 }])
      .mockResolvedValue([{ id: 15, tmdbId: 10331 }]);

    const download = await send();

    expect(download).toEqual(expect.objectContaining({ status: 'QUEUED', arrItemId: 15, createdArrItem: true }));
    expect(mocks.client.lookupMovie).toHaveBeenCalledTimes(3);
  });

  it('says a film may still appear when Radarr never answered the add and it is not there', async () => {
    mocks.client.addMovie.mockRejectedValue(new AxiosError('timeout of 30000ms exceeded', 'ECONNABORTED'));
    mocks.client.lookupMovie = vi.fn(async () => [{ tmdbId: 10331 }]);

    const download = await send();

    expect(download.status).toBe('FAILED');
    expect(download.lastError).toContain('If Night of the Living Dead shows up in Arr later, it was added for this download');
    expect(mocks.client.lookupMovie).toHaveBeenCalledTimes(5);
    expect(mocks.client.deleteMovie).not.toHaveBeenCalled();
  });

  it('fails at once when Radarr could not be reached to add the film', async () => {
    mocks.client.addMovie.mockRejectedValue(new AxiosError('connect ECONNREFUSED 127.0.0.1:7878', 'ECONNREFUSED'));
    mocks.client.lookupMovie = vi.fn(async () => [{ tmdbId: 10331 }]);

    const download = await send();

    expect(download.status).toBe('FAILED');
    expect(download.lastError).not.toContain('shows up');
    expect(mocks.client.lookupMovie).not.toHaveBeenCalled();
  });

  it('never takes over a film Radarr refused to add, though it is there now', async () => {
    const response = { status: 400, statusText: 'Bad Request', headers: {}, config: { headers: new AxiosHeaders() }, data: [{ errorMessage: 'This movie has already been added' }] };
    mocks.client.addMovie.mockRejectedValue(new AxiosError('Request failed with status code 400', 'ERR_BAD_REQUEST', undefined, undefined, response));
    mocks.client.lookupMovie = vi.fn(async () => [{ id: 99, tmdbId: 10331 }]);

    const download = await send();

    expect(download.status).toBe('FAILED');
    expect(download.createdArrItem).toBeFalsy();
    expect(mocks.client.lookupMovie).not.toHaveBeenCalled();
    expect(mocks.client.deleteMovie).not.toHaveBeenCalled();
  });

  it('fails the recorded workflow when the instance cannot be reached', async () => {
    mocks.connection.mockRejectedValue(new Error('That Radarr instance no longer exists.'));
    const download = await send();
    expect(download.status).toBe('FAILED');
    expect(mocks.client.addMovie).not.toHaveBeenCalled();
  });

  it('returns the same workflow for a repeated request, and creates nothing when the preflight refuses', async () => {
    const first = await send();
    const again = await send();
    expect(again.id).toBe(first.id);
    expect(mocks.preflight).toHaveBeenCalledOnce();

    mocks.preflight.mockResolvedValue({ ...plan('RADARR'), ok: false, errors: [{ code: 'TITLE_NOT_FOUND', message: 'Radarr could not find that title.' }] });
    await expect(send({}, 'req-00003')).rejects.toBeInstanceOf(ManualDownloadRefusedError);
    expect(mocks.rows.size).toBe(1);
  });
});

describe('sending an episode to Sonarr', () => {
  const sonarrClient = () => ({
    addSeries: vi.fn(async () => ({ id: 6 })),
    getSeriesById: vi.fn(async () => ({ id: 6, monitored: false })),
    updateSeries: vi.fn(async () => ({})),
    setEpisodesMonitored: vi.fn(async () => []),
    parseTitle: vi.fn(),
    getEpisodes: vi.fn(async () => [{ id: 236, episodeFileId: 0 }, { id: 237, episodeFileId: 0 }]),
    getEpisodeFiles: vi.fn(async () => []),
    deleteSeries: vi.fn(async () => {}),
    pushRelease: vi.fn(async () => ({ approved: true, rejected: false, rejections: [] })),
    getHistory: vi.fn(async () => ({ records: [{ eventType: 'grabbed', date: new Date().toISOString(), seriesId: 6, episodeId: 236, data: {} }] })),
  });
  const sonarr = (overrides: Record<string, unknown> = {}) => settle(sendManualDownload({
    service: 'SONARR', instanceId: 'i1', externalId: 71471, source, releaseTitle: 'The.Beverly.Hillbillies.S01E01.720p.WEB',
    add: { qualityProfileId: 1, rootFolderPath: '/tv', tags: [], seriesType: 'standard', seasonFolder: true }, ...overrides,
  } as never, `req-s-${mocks.rows.size}`, actor));

  beforeEach(() => {
    mocks.client = sonarrClient();
    mocks.preflight.mockResolvedValue(plan('SONARR', { target: { externalId: 71471, title: 'The Beverly Hillbillies', year: 1962, existingId: null }, release: { title: 'The.Beverly.Hillbillies.S01E01.720p.WEB', name: '', infoHash: HASH, source: 'MAGNET' } }));
  });

  it('adds the series with nothing monitored or searched, waits for its episodes, then monitors only those the release covers', async () => {
    mocks.client.parseTitle
      .mockResolvedValueOnce({ series: { id: 6 }, episodes: [] })
      .mockResolvedValue({ series: { id: 6 }, episodes: [{ id: 236 }] });

    const download = await sonarr();

    expect(mocks.client.addSeries).toHaveBeenCalledWith(expect.objectContaining({
      tvdbId: 71471, monitored: false, seriesType: 'standard', seasonFolder: true,
      addOptions: { monitor: 'none', searchForMissingEpisodes: false, searchForCutoffUnmetEpisodes: false },
    }));
    expect(mocks.client.parseTitle).toHaveBeenCalledTimes(2);
    expect(mocks.client.updateSeries).toHaveBeenCalledWith({ id: 6, monitored: true });
    expect(mocks.client.setEpisodesMonitored).toHaveBeenCalledWith([236], true);
    expect(mocks.client.pushRelease).toHaveBeenCalledWith(expect.objectContaining({ tvdbId: 71471 }));
    expect(download).toEqual(expect.objectContaining({ status: 'QUEUED', targetEpisodeIds: [236], baselineFileIds: { 236: 0 } }));
  });

  it('removes the series it added when Sonarr maps the release elsewhere', async () => {
    mocks.client.parseTitle.mockResolvedValue({ series: { id: 3 }, episodes: [{ id: 23 }] });

    const download = await sonarr();

    expect(download.status).toBe('FAILED');
    expect(download.lastError).toContain('did not match the release name');
    expect(mocks.client.deleteSeries).toHaveBeenCalledWith(6, false);
    expect(mocks.client.pushRelease).not.toHaveBeenCalled();
  });

  it('takes the episodes from the grab when Sonarr matched an existing series by its TVDB id, with files from before the push', async () => {
    mocks.preflight.mockResolvedValue(plan('SONARR', { target: { externalId: 71471, title: 'The Beverly Hillbillies', year: 1962, existingId: 6 } }));
    // Sonarr imports in the seconds after the push: the baseline is what was there before it.
    mocks.client.getEpisodes
      .mockResolvedValueOnce([{ id: 236, episodeFileId: 0 }, { id: 237, episodeFileId: 0 }])
      .mockResolvedValue([{ id: 236, episodeFileId: 99 }, { id: 237, episodeFileId: 0 }]);

    const download = await sonarr({ add: undefined });

    expect(download).toEqual(expect.objectContaining({ status: 'QUEUED', targetEpisodeIds: [236], baselineFileIds: { 236: 0 } }));
  });
});
