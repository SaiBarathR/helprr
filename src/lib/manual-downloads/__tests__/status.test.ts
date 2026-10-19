import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  update: vi.fn(async () => ({})),
  queue: vi.fn(async () => ({ records: [] as unknown[] })),
  client: {} as Record<string, ReturnType<typeof vi.fn>>,
  connection: vi.fn(async () => ({ id: 'i1' })),
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

describe('reconciling open manual downloads', () => {
  it('has nothing to do when nothing is open', async () => {
    expect(await run()).toEqual({ failure: null, skipped: true });
  });

  it('follows the queue, recording a change once', async () => {
    mocks.rows = [row()];
    mocks.queue.mockResolvedValue({ records: [item()] });
    await run();
    expect(statusSet()).toEqual(['DOWNLOADING']);

    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'md1', status: 'QUEUED' } }));

    mocks.update.mockClear();
    mocks.rows = [row({ status: 'DOWNLOADING', arrQueueId: 101 })];
    await run();
    expect(mocks.update).not.toHaveBeenCalled();

    mocks.queue.mockResolvedValue({ records: [item({ id: 102 })] });
    await run();
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'md1', status: 'DOWNLOADING' }, data: { arrQueueId: 102 } });
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
    expect(mocks.client.getHistory).toHaveBeenCalledWith(1, 50, 'date', 'descending', { downloadId: HASH, eventType: 1 });

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
