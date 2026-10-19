import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  update: vi.fn(async () => ({})),
  queue: vi.fn(async () => ({ records: [] as unknown[] })),
  client: {} as Record<string, ReturnType<typeof vi.fn>>,
  connection: vi.fn(async () => ({ id: 'i1' })),
  torrents: vi.fn(async () => [] as unknown[]),
  settle: vi.fn(async () => true),
  proof: vi.fn(async () => ({ proved: false, fileIds: [] as number[], missing: 1 })),
}));
vi.mock('@/lib/service-helpers', () => ({ getQBittorrentClient: async () => ({ getTorrents: mocks.torrents }) }));
vi.mock('../fallback', () => ({
  settleDownloaded: mocks.settle,
  fallbackImportProof: mocks.proof,
  SETTLING_STATES: new Set(['moving', 'checkingUP', 'checkingDL', 'checkingResumeData', 'metaDL', 'forcedMetaDL']),
}));
vi.mock('@/lib/db', () => ({ prisma: { manualDownload: { findMany: vi.fn(async () => mocks.rows), update: mocks.update } } }));
vi.mock('@/lib/arr-instances', () => ({ resolveConnection: mocks.connection }));
vi.mock('@/lib/activity-queue', () => ({ fetchAllQueueRecords: mocks.queue }));
vi.mock('../preflight', async (importOriginal) => ({ ...(await importOriginal<typeof import('../preflight')>()), arrClientFor: () => mocks.client }));

import { Prisma } from '@prisma/client';
import { jobReports, type JobReport } from '@/lib/polling-job-report';
import { fromQueue, importProof, reconcileManualDownloads } from '../status';

const HASH = '382CC016FF22946008ECDDCB0DDA820F42B0CD5A';
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
const row = (extra: Record<string, unknown> = {}) => ({
  id: 'md1', mode: 'ARR_MANAGED', status: 'QUEUED', service: 'RADARR', instanceId: 'i1', instanceLabel: 'Radarr',
  infoHash: HASH, arrItemId: 15, arrItemTitle: 'Night of the Living Dead', createdArrItem: true, targetEpisodeIds: [],
  baselineFileIds: [], lastError: null, arrQueueId: null, updatedAt: minutesAgo(5), ...extra,
});
const item = (extra: Record<string, unknown> = {}) => ({
  id: 101, downloadId: HASH.toLowerCase(), trackedDownloadState: 'downloading', trackedDownloadStatus: 'ok',
  statusMessages: [], errorMessage: '', size: 100, sizeleft: 50, ...extra,
});
const statusSet = () => (mocks.update.mock.calls as unknown as Array<[{ data: { status?: string; lastError?: string | null } }]>).map(([call]) => call.data.status);

async function run() {
  const report: JobReport = { failure: null, skipped: false };
  await jobReports.run(report, () => reconcileManualDownloads());
  return report;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows = [];
  mocks.queue.mockResolvedValue({ records: [] });
  mocks.torrents.mockResolvedValue([]);
  mocks.settle.mockResolvedValue(true);
  mocks.client = {
    getHistory: vi.fn(async () => ({ records: [] })),
    getMovieFiles: vi.fn(async () => []),
    getEpisodes: vi.fn(async () => []),
  };
});

describe("what Arr's queue says", () => {
  it("maps the tracked states, with Arr's own reasons for a blocked import", () => {
    expect(fromQueue(item() as never, 'Radarr').status).toBe('DOWNLOADING');
    expect(fromQueue(item({ sizeleft: 0, trackedDownloadState: 'importPending' }) as never, 'Radarr').status).toBe('IMPORT_PENDING');
    expect(fromQueue(item({ trackedDownloadState: 'importing' }) as never, 'Radarr').status).toBe('IMPORTING');
    const blocked = fromQueue(item({ trackedDownloadState: 'importBlocked', trackedDownloadStatus: 'warning', statusMessages: [{ title: 'x', messages: ['No files found are eligible for import'] }] }) as never, 'Radarr');
    expect(blocked).toEqual(expect.objectContaining({ status: 'BLOCKED', message: 'Radarr cannot import it: No files found are eligible for import' }));
    expect(fromQueue(item({ trackedDownloadState: 'failedPending' }) as never, 'Radarr').status).toBe('BLOCKED');
  });
});

describe('the import proof', () => {
  it('needs a movie file that was not there before', () => {
    expect(importProof({ service: 'RADARR', baselineFileIds: [], targetEpisodeIds: [] }, [7])).toEqual({ proved: true, newFiles: [7], missing: [] });
    expect(importProof({ service: 'RADARR', baselineFileIds: [7], targetEpisodeIds: [] }, [7]).proved).toBe(false);
    expect(importProof({ service: 'RADARR', baselineFileIds: [7], targetEpisodeIds: [] }, [8]).proved).toBe(true);
  });

  it('needs every episode the release covers to hold a new file, an upgrade included', () => {
    const download = { service: 'SONARR' as const, baselineFileIds: { 1: 0, 2: 55 }, targetEpisodeIds: [1, 2] };
    expect(importProof(download, { 1: 90, 2: 91 })).toEqual({ proved: true, newFiles: [90, 91], missing: [] });
    expect(importProof(download, { 1: 90, 2: 55 })).toEqual({ proved: false, newFiles: [90], missing: [2] });
    expect(importProof({ ...download, targetEpisodeIds: [] }, {}).proved).toBe(false);
  });
});

describe("the import proof from this release's own import events", () => {
  const sonarr = { service: 'SONARR' as const, baselineFileIds: { 1: 0, 2: 0 }, targetEpisodeIds: [1, 2], arrItemId: 3 };

  it("does not count another release's file for an episode this one did not import", () => {
    // This release imported episode 1 (file 90); another release supplied episode 2 (file 91).
    const imports = [{ eventType: 'downloadFolderImported', episodeId: 1, data: { fileId: '90' } }] as never;
    expect(importProof(sonarr, { 1: 90, 2: 91 }, imports)).toEqual({ proved: false, newFiles: [90], missing: [2] });
    const both = [...imports, { eventType: 'downloadFolderImported', episodeId: 2, data: { fileId: '91' } }] as never;
    expect(importProof(sonarr, { 1: 90, 2: 91 }, both).proved).toBe(true);
  });

  it("counts only the movie file this release imported, and only while the movie still has it", () => {
    const radarr = { service: 'RADARR' as const, baselineFileIds: [], targetEpisodeIds: [], arrItemId: 15 };
    const imports = [{ eventType: 'downloadFolderImported', movieId: 15, data: { fileId: '7' } }] as never;
    expect(importProof(radarr, [7, 8], imports)).toEqual({ proved: true, newFiles: [7], missing: [] });
    expect(importProof(radarr, [8], imports).proved).toBe(false);
  });
});

describe('reconciling open manual downloads', () => {
  it('has nothing to do when nothing is open', async () => {
    expect(await run()).toEqual({ failure: null, skipped: true });
  });

  it('follows the queue, recording a change once', async () => {
    mocks.rows = [row()];
    mocks.queue.mockResolvedValue({ records: [item()] });
    await run();
    expect(statusSet()).toEqual(['DOWNLOADING']);

    // Only from the state the run read: the status and when it was last written.
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'md1', status: 'QUEUED', updatedAt: expect.any(Date) } }));

    mocks.update.mockClear();
    mocks.rows = [row({ status: 'DOWNLOADING', arrQueueId: 101 })];
    await run();
    expect(mocks.update).not.toHaveBeenCalled();

    mocks.queue.mockResolvedValue({ records: [item({ id: 102 })] });
    await run();
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'md1', status: 'DOWNLOADING', updatedAt: expect.any(Date) }, data: { arrQueueId: 102 } });
  });

  it('leaves a download a cancel settled while the run was reading Arr', async () => {
    mocks.rows = [row()];
    mocks.queue.mockResolvedValue({ records: [item()] });
    mocks.update.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('No record was found', { code: 'P2025', clientVersion: '6' }));
    expect((await run()).failure).toBeNull();
  });

  it('settles an item Arr still lists as imported from its history', async () => {
    mocks.rows = [row({ status: 'IMPORTING' })];
    mocks.queue.mockResolvedValue({ records: [item({ trackedDownloadState: 'imported' })] });
    mocks.client.getHistory.mockResolvedValue({ records: [{ eventType: 'downloadFolderImported' }] });
    mocks.client.getMovieFiles.mockResolvedValue([{ id: 7 }]);
    await run();
    expect(statusSet()).toEqual(['IMPORTED']);
  });

  it('marks it imported only with new file ids, from history once it leaves the queue', async () => {
    mocks.rows = [row({ status: 'IMPORTING' })];
    mocks.client.getHistory.mockResolvedValue({ records: [{ eventType: 'downloadFolderImported' }, { eventType: 'grabbed' }] });
    mocks.client.getMovieFiles.mockResolvedValue([{ id: 7 }]);
    await run();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'IMPORTED', importedFileIds: [7], completedAt: expect.any(Date) }) }));

    mocks.update.mockClear();
    mocks.client.getMovieFiles.mockResolvedValue([]);
    await run();
    expect(statusSet()).toEqual(['BLOCKED']);
  });

  it('takes failed and ignored downloads from history', async () => {
    mocks.rows = [row()];
    mocks.client.getHistory.mockResolvedValue({ records: [{ eventType: 'downloadFailed', data: { message: 'Manually marked as failed' } }] });
    await run();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', lastError: 'Radarr marked the download failed: Manually marked as failed' }) }));

    mocks.update.mockClear();
    mocks.client.getHistory.mockResolvedValue({ records: [{ eventType: 'downloadIgnored' }] });
    await run();
    expect(statusSet()).toEqual(['CANCELLED']);
  });

  it('gives a fresh grab time to reach the queue, then says it is gone', async () => {
    mocks.client.getHistory.mockResolvedValue({ records: [{ eventType: 'grabbed' }] });
    mocks.rows = [row({ updatedAt: minutesAgo(0.5) })];
    await run();
    expect(mocks.update).not.toHaveBeenCalled();

    mocks.rows = [row({ updatedAt: minutesAgo(5) })];
    await run();
    expect(statusSet()).toEqual(['BLOCKED']);
  });

  it('settles a send interrupted by a restart from history, leaving a recent one alone', async () => {
    mocks.rows = [row({ status: 'SUBMITTING_RELEASE', updatedAt: minutesAgo(1) })];
    await run();
    expect(mocks.update).not.toHaveBeenCalled();

    mocks.rows = [row({ status: 'SUBMITTING_RELEASE', updatedAt: minutesAgo(15) })];
    mocks.client.getHistory.mockResolvedValue({ records: [{ eventType: 'grabbed' }] });
    await run();
    expect(statusSet()).toEqual(['QUEUED']);
    expect(mocks.client.getHistory).toHaveBeenCalledWith(1, 1000, 'date', 'descending', { downloadId: HASH, eventType: 1 });

    mocks.update.mockClear();
    mocks.client.getHistory.mockResolvedValue({ records: [] });
    await run();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: 'FAILED', lastError: expect.stringContaining('remove it in Radarr if you do not want it'),
    }) }));
  });

  it('fails a download whose instance was removed, and leaves the rest alone when an instance does not answer', async () => {
    mocks.rows = [row({ instanceId: null })];
    await run();
    expect(statusSet()).toEqual(['FAILED']);

    mocks.update.mockClear();
    mocks.rows = [row()];
    mocks.queue.mockRejectedValue(new Error('ECONNREFUSED'));
    const report = await run();
    expect(report.failure).toBe('ECONNREFUSED');
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe('following a fallback download', () => {
  const fallback = (extra: Record<string, unknown> = {}) => row({ mode: 'QBIT_REVIEWED', status: 'DOWNLOADING', ...extra });
  const torrent = (extra: Record<string, unknown> = {}) => ({ hash: HASH.toLowerCase(), progress: 0.4, state: 'downloading', save_path: '/mnt/exos22/Downloads/', ...extra });

  it("follows qBittorrent, not Arr's queue, until the chosen files finish", async () => {
    mocks.rows = [fallback()];
    mocks.torrents.mockResolvedValue([torrent()]);
    await run();
    expect(mocks.queue).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
    expect(mocks.torrents).toHaveBeenCalledWith(undefined, undefined, undefined, undefined, HASH.toLowerCase());

    mocks.torrents.mockResolvedValue([torrent({ progress: 1, state: 'moving' })]);
    await run();
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it("hands finished files to Arr's reading once, and leaves what waits for the user", async () => {
    mocks.rows = [fallback()];
    mocks.torrents.mockResolvedValue([torrent({ progress: 1, state: 'stalledUP' })]);
    await run();
    expect(mocks.settle).toHaveBeenCalledWith(expect.objectContaining({ id: 'md1' }), mocks.client);

    for (const waiting of [fallback({ status: 'NEEDS_MAPPING' }), fallback({ status: 'BLOCKED' }), fallback({ status: 'IMPORT_PENDING', updatedAt: minutesAgo(2) })]) {
      mocks.settle.mockClear();
      mocks.rows = [waiting];
      await run();
      expect(mocks.settle).not.toHaveBeenCalled();
    }
    expect(mocks.update).not.toHaveBeenCalled();

    // A scan, import or cancel that never finished (a restart) is picked up, even with the torrent gone.
    mocks.torrents.mockResolvedValue([]);
    mocks.rows = [fallback({ status: 'IMPORT_PENDING', updatedAt: minutesAgo(15) })];
    await run();
    expect(mocks.settle).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('says so when the torrent leaves qBittorrent, and leaves everything when qBittorrent does not answer', async () => {
    mocks.rows = [fallback()];
    await run();
    expect(statusSet()).toEqual(['BLOCKED']);

    mocks.update.mockClear();
    mocks.torrents.mockRejectedValue(new Error('ECONNREFUSED'));
    expect((await run()).failure).toBe('ECONNREFUSED');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("proves its own import by Arr's history of its files, or reports the failed command", async () => {
    mocks.rows = [fallback({ status: 'IMPORTING', arrCommandId: 77, baselineFileIds: [] })];
    mocks.proof.mockResolvedValueOnce({ proved: true, fileIds: [9], missing: 0 });
    await run();
    expect(mocks.proof).toHaveBeenCalledWith(expect.objectContaining({ id: 'md1' }), mocks.client);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'IMPORTED', importedFileIds: [9] }) }));

    mocks.update.mockClear();
    mocks.client.getCommand = vi.fn(async () => ({ status: 'failed', message: 'Access to the path is denied' }));
    await run();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: 'BLOCKED', lastError: "Radarr's import failed: Access to the path is denied. Fix it, then import again.",
    }) }));
  });
});

describe('reconciling: review round two', () => {
  it("keeps a grab for another title blocked, though Arr's queue says it is downloading", async () => {
    mocks.rows = [row({ status: 'BLOCKED', lastError: 'Radarr grabbed the release for a different title than Night of the Living Dead. Cancel it from its queue.' })];
    mocks.queue.mockResolvedValue({ records: [item({ movieId: 99 })] });
    await run();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('takes a failure after a partial import as the end of the download', async () => {
    mocks.rows = [row({ service: 'SONARR', status: 'IMPORTING', targetEpisodeIds: [1, 2], baselineFileIds: { 1: 0, 2: 0 } })];
    mocks.client.getHistory.mockResolvedValue({ records: [
      { eventType: 'downloadFailed', data: { message: 'Download stalled' } },
      { eventType: 'downloadFolderImported', episodeId: 1, data: { fileId: '90' } },
    ] });
    await run();
    expect(statusSet()).toEqual(['FAILED']);
  });

  it("takes the episodes from the grab when a TVDB-matched Sonarr send was interrupted before it could", async () => {
    mocks.rows = [row({ service: 'SONARR', status: 'SUBMITTING_RELEASE', updatedAt: minutesAgo(15), targetEpisodeIds: [] })];
    mocks.client.getHistory.mockResolvedValue({ records: [{ eventType: 'grabbed', seriesId: 15, episodeId: 501 }, { eventType: 'grabbed', seriesId: 15, episodeId: 502 }] });
    await run();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: 'QUEUED', targetEpisodeIds: [501, 502], baselineFileIds: { 501: 0, 502: 0 },
    }) }));
  });

  it("keeps credentials out of Arr's messages", async () => {
    mocks.rows = [row()];
    mocks.queue.mockResolvedValue({ records: [item({ trackedDownloadState: 'importBlocked', statusMessages: [{ title: 'x', messages: ['Cannot reach http://qbit:8080/api?apikey=s3cret'] }] })] });
    await run();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      lastError: 'Radarr cannot import it: Cannot reach http://qbit:8080/api?apikey=[REDACTED]',
    }) }));
  });
});
