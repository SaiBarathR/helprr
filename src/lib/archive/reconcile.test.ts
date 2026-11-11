import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  job: { findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
  mediaFile: { updateMany: vi.fn(), findMany: vi.fn() },
  subscription: { findMany: vi.fn() },
  heartbeat: { findFirst: vi.fn() },
  notifyAndLog: vi.fn(),
  refreshItem: vi.fn(),
  queryItems: vi.fn(),
  scanAllLibraries: vi.fn(),
  getJellyfinClient: vi.fn(),
  getTwitchSettings: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    archiveJob: mocks.job,
    archiveMediaFile: mocks.mediaFile,
    creatorSubscription: mocks.subscription,
    archiveWorkerHeartbeat: mocks.heartbeat,
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('@/lib/polling/shared', () => ({ notifyAndLog: mocks.notifyAndLog, errorMessage: String }));
vi.mock('@/lib/service-helpers', () => ({ getJellyfinClient: mocks.getJellyfinClient }));
vi.mock('@/lib/twitch/settings', () => ({ getTwitchSettings: mocks.getTwitchSettings }));

import { reconcileTwitchJobs } from '@/lib/twitch/reconcile';

const now = new Date('2026-10-30T12:00:00Z');
const video = { id: 'v1', externalId: '555', title: 'T', creatorId: 's1', creator: { displayName: 'N', folderName: 'n' } };
const doneJob = (overrides = {}) => ({
  id: 'j1', kind: 'DOWNLOAD', video, requestedByUserId: 'u1', finishedAt: new Date(now.getTime() - 60_000), mediaFile: null, attempts: 1, ...overrides,
});

function pending(rows: unknown[], failed: unknown[] = []) {
  mocks.job.findMany.mockResolvedValueOnce(rows).mockResolvedValueOnce(failed);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.job.count.mockResolvedValue(0);
  mocks.mediaFile.findMany.mockResolvedValue([]);
  mocks.getTwitchSettings.mockResolvedValue({ jellyfinLibraryItemId: 'lib', toolsPausedAt: null });
  mocks.getJellyfinClient.mockResolvedValue({ refreshItem: mocks.refreshItem, queryItems: mocks.queryItems, scanAllLibraries: mocks.scanAllLibraries });
  mocks.refreshItem.mockResolvedValue(undefined);
  mocks.subscription.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);
});

describe('reconcileTwitchJobs', () => {
  it('refreshes the series, stores the item and tells only the requester', async () => {
    pending([doneJob()]);
    mocks.queryItems
      .mockResolvedValueOnce({ Items: [{ Id: 'series', Path: '/lib/n' }] })
      .mockResolvedValueOnce({ Items: [{ Id: 'item' }] });

    await reconcileTwitchJobs(now);

    expect(mocks.refreshItem).toHaveBeenCalledWith('series', { recursive: true });
    expect(mocks.queryItems.mock.calls[1][0]).toMatchObject({ Tags: 'twitch-v555' });
    expect(mocks.mediaFile.updateMany).toHaveBeenCalledWith({ where: { videoId: 'v1' }, data: { jellyfinItemId: 'item' } });
    expect(mocks.notifyAndLog).toHaveBeenCalledTimes(1);
    expect(mocks.notifyAndLog.mock.calls[0][0]).toMatchObject({
      eventType: 'twitchDownloadComplete', userIds: ['u1'], metadata: { redirect: '/jellyfin/library/item/item' },
    });
    expect(mocks.job.update).toHaveBeenCalledWith({ where: { id: 'j1' }, data: { needsJellyfinRefresh: false } });
  });

  it('refreshes the library for a streamer with no series yet', async () => {
    pending([doneJob()]);
    mocks.queryItems.mockResolvedValue({ Items: [{ Id: 'other', Path: '/twitch/someone-else' }] });
    await reconcileTwitchJobs(now);
    expect(mocks.refreshItem).toHaveBeenCalledWith('lib', { recursive: true });
    expect(mocks.scanAllLibraries).not.toHaveBeenCalled();
  });

  it('runs a full scan for an empty library, which a refresh of its own never looks at', async () => {
    const first = new Date('2030-01-01T00:00:00Z');
    mocks.queryItems.mockResolvedValue({ Items: [] });

    pending([doneJob({ finishedAt: first })]);
    await reconcileTwitchJobs(first);
    expect(mocks.scanAllLibraries).toHaveBeenCalledTimes(1);
    expect(mocks.refreshItem).not.toHaveBeenCalled();

    pending([doneJob({ finishedAt: first })]);
    await reconcileTwitchJobs(new Date(first.getTime() + 15_000));
    expect(mocks.scanAllLibraries).toHaveBeenCalledTimes(1);

    pending([doneJob({ finishedAt: first })]);
    await reconcileTwitchJobs(new Date(first.getTime() + 11 * 60_000));
    expect(mocks.scanAllLibraries).toHaveBeenCalledTimes(2);
  });

  it('keeps trying while Jellyfin has not indexed the file yet', async () => {
    pending([doneJob()]);
    mocks.queryItems.mockResolvedValue({ Items: [] });

    await reconcileTwitchJobs(now);

    expect(mocks.notifyAndLog).not.toHaveBeenCalled();
    expect(mocks.job.update).not.toHaveBeenCalled();
  });

  it('gives up after half an hour, and still reports the download, to the VOD page', async () => {
    pending([doneJob({ finishedAt: new Date(now.getTime() - 31 * 60_000) })]);
    mocks.queryItems.mockResolvedValue({ Items: [] });

    await reconcileTwitchJobs(now);

    expect(mocks.notifyAndLog.mock.calls[0][0].metadata.redirect).toBe('/twitch/vod/v1');
    expect(mocks.job.update).toHaveBeenCalledWith({ where: { id: 'j1' }, data: { needsJellyfinRefresh: false } });
  });

  it('survives Jellyfin being down, and retries later', async () => {
    pending([doneJob()]);
    mocks.getJellyfinClient.mockRejectedValue(new Error('down'));

    await reconcileTwitchJobs(now);

    expect(mocks.job.update).not.toHaveBeenCalled();
  });

  it('tells every subscriber about a job nobody asked for', async () => {
    pending([doneJob({ requestedByUserId: null })]);
    mocks.queryItems.mockResolvedValueOnce({ Items: [] }).mockResolvedValueOnce({ Items: [{ Id: 'item' }] });

    await reconcileTwitchJobs(now);

    expect(mocks.notifyAndLog.mock.calls.map(([event]) => event.userIds)).toEqual([['u1'], ['u2']]);
  });

  it.each(['REENCODE', 'RESTORE_ORIGINAL'])('sends no push for %s: nothing new landed', async (kind) => {
    pending([doneJob({ kind, mediaFile: { jellyfinItemId: 'item' } })]);

    await reconcileTwitchJobs(now);

    expect(mocks.refreshItem).toHaveBeenCalledWith('item', { recursive: false });
    expect(mocks.notifyAndLog).not.toHaveBeenCalled();
    expect(mocks.job.update).toHaveBeenCalledWith({ where: { id: 'j1' }, data: { needsJellyfinRefresh: false } });
  });

  it('refreshes the library after a delete, without a push', async () => {
    pending([doneJob({ kind: 'DELETE_FILES', video: null })]);

    await reconcileTwitchJobs(now);

    expect(mocks.refreshItem).toHaveBeenCalledWith('lib', { recursive: true });
    expect(mocks.notifyAndLog).not.toHaveBeenCalled();
  });

  it('reports a failed download once', async () => {
    pending([], [doneJob()]);

    await reconcileTwitchJobs(now);

    expect(mocks.notifyAndLog.mock.calls[0][0]).toMatchObject({ eventType: 'twitchDownloadFailed', userIds: ['u1'], url: '/twitch/queue' });
    expect(mocks.job.update).toHaveBeenCalledWith({ where: { id: 'j1' }, data: { failureNotifiedAt: now } });
  });

  it('stays quiet about a worker never started, with nothing waiting', async () => {
    pending([]);
    mocks.heartbeat.findFirst.mockResolvedValue(null);
    await reconcileTwitchJobs(now);
    expect(mocks.notifyAndLog).not.toHaveBeenCalled();
  });

  it('warns about a worker that went away, even with nothing waiting', async () => {
    pending([]);
    mocks.heartbeat.findFirst.mockResolvedValue({ lastSeenAt: new Date(now.getTime() - 11 * 60_000) });
    await reconcileTwitchJobs(now);
    expect(mocks.notifyAndLog.mock.calls[0][0].eventType).toBe('twitchWorkerIssue');
  });

  it('keeps a refresh request while Jellyfin is away', async () => {
    pending([doneJob({ kind: 'REENCODE', mediaFile: { jellyfinItemId: 'item' } })]);
    mocks.refreshItem.mockRejectedValue(new Error('down'));
    await reconcileTwitchJobs(now);
    expect(mocks.job.update).not.toHaveBeenCalled();
  });

  it('warns once a day when work waits on an absent worker', async () => {
    pending([]);
    mocks.job.count.mockResolvedValue(1);
    mocks.heartbeat.findFirst.mockResolvedValue({ lastSeenAt: new Date(now.getTime() - 11 * 60_000) });

    await reconcileTwitchJobs(now);

    expect(mocks.notifyAndLog.mock.calls[0][0]).toMatchObject({ eventType: 'twitchWorkerIssue', dedupeKey: 'twitch-worker-offline-2026-10-30' });
  });

  it('warns when the tools have paused downloads', async () => {
    pending([]);
    mocks.getTwitchSettings.mockResolvedValue({ toolsPausedAt: now });
    await reconcileTwitchJobs(now);
    expect(mocks.notifyAndLog.mock.calls[0][0]).toMatchObject({ eventType: 'twitchWorkerIssue', dedupeKey: 'twitch-tools-paused-2026-10-30' });
  });

  it('says nothing while the worker is seen', async () => {
    pending([]);
    mocks.job.count.mockResolvedValue(1);
    mocks.heartbeat.findFirst.mockResolvedValue({ lastSeenAt: new Date(now.getTime() - 60_000) });

    await reconcileTwitchJobs(now);

    expect(mocks.notifyAndLog).not.toHaveBeenCalled();
  });
});

describe('linking files that Jellyfin found late', () => {
  const unlinked = [{ id: 'f1', video: { externalId: '555' } }, { id: 'f2', video: { externalId: '777' } }];
  let reconcile: typeof reconcileTwitchJobs;

  // A fresh module each time, so the ten-minute wait starts clean.
  beforeEach(async () => {
    vi.resetModules();
    ({ reconcileTwitchJobs: reconcile } = await import('@/lib/twitch/reconcile'));
    mocks.job.findMany.mockResolvedValue([]);
    mocks.mediaFile.findMany.mockResolvedValue(unlinked);
  });

  it('links a file once its item appears, long after the download stopped looking', async () => {
    mocks.queryItems.mockResolvedValue({ Items: [{ Id: 'item', Tags: ['video', 'twitch-v555'] }] });

    await reconcile(now);

    expect(mocks.mediaFile.findMany.mock.calls[0][0]).toMatchObject({ where: { platform: 'TWITCH', jellyfinItemId: null } });
    expect(mocks.queryItems).toHaveBeenCalledWith(expect.objectContaining({ ParentId: 'lib', Tags: 'twitch-v555|twitch-v777', Fields: 'Tags' }));
    expect(mocks.mediaFile.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.mediaFile.updateMany).toHaveBeenCalledWith({ where: { id: 'f1', jellyfinItemId: null }, data: { jellyfinItemId: 'item' } });
    expect(mocks.notifyAndLog).not.toHaveBeenCalled();
  });

  it('leaves a file unlinked when two items carry its tag', async () => {
    mocks.queryItems.mockResolvedValue({ Items: [{ Id: 'a', Tags: ['twitch-v555'] }, { Id: 'b', Tags: ['twitch-v555'] }] });
    await reconcile(now);
    expect(mocks.mediaFile.updateMany).not.toHaveBeenCalled();
  });

  it('asks Jellyfin nothing when every file is linked or there is no library', async () => {
    mocks.mediaFile.findMany.mockResolvedValue([]);
    await reconcile(now);
    expect(mocks.getJellyfinClient).not.toHaveBeenCalled();

    vi.resetModules();
    ({ reconcileTwitchJobs: reconcile } = await import('@/lib/twitch/reconcile'));
    mocks.mediaFile.findMany.mockResolvedValue(unlinked);
    mocks.getTwitchSettings.mockResolvedValue({ jellyfinLibraryItemId: null, toolsPausedAt: null });
    await reconcile(now);
    expect(mocks.getJellyfinClient).not.toHaveBeenCalled();
  });

  it('looks at most every ten minutes', async () => {
    mocks.queryItems.mockResolvedValue({ Items: [] });
    await reconcile(now);
    await reconcile(new Date(now.getTime() + 9 * 60_000));
    expect(mocks.mediaFile.findMany).toHaveBeenCalledTimes(1);
    await reconcile(new Date(now.getTime() + 11 * 60_000));
    expect(mocks.mediaFile.findMany).toHaveBeenCalledTimes(2);
  });

  it('survives Jellyfin being down, and tries again later', async () => {
    mocks.getJellyfinClient.mockRejectedValue(new Error('down'));
    await expect(reconcile(now)).resolves.toBeUndefined();
    expect(mocks.mediaFile.updateMany).not.toHaveBeenCalled();

    mocks.getJellyfinClient.mockResolvedValue({ refreshItem: mocks.refreshItem, queryItems: mocks.queryItems, scanAllLibraries: mocks.scanAllLibraries });
    mocks.queryItems.mockResolvedValue({ Items: [{ Id: 'item', Tags: ['twitch-v777'] }] });
    await reconcile(new Date(now.getTime() + 11 * 60_000));
    expect(mocks.mediaFile.updateMany).toHaveBeenCalledWith({ where: { id: 'f2', jellyfinItemId: null }, data: { jellyfinItemId: 'item' } });
  });
});
