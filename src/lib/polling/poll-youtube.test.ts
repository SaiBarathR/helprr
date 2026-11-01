import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  due: vi.fn(),
  advance: vi.fn(),
  lists: vi.fn(),
  advanceList: vi.fn(),
  listSubscribers: vi.fn(),
  syncList: vi.fn(),
  videos: vi.fn(),
  stamp: vi.fn(),
  subscribers: vi.fn(),
  quota: vi.fn(),
  sync: vi.fn(),
  notify: vi.fn(),
  enqueue: vi.fn(),
  decide: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    serviceConnection: { findFirst: mocks.connection },
    creator: { findMany: mocks.due, update: mocks.advance },
    creatorPlaylist: { findMany: mocks.lists, update: mocks.advanceList },
    creatorPlaylistSubscription: { findMany: mocks.listSubscribers },
    creatorVideo: { findMany: mocks.videos, updateMany: mocks.stamp },
    creatorSubscription: { findMany: mocks.subscribers },
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('@/lib/polling-job-report', () => ({ noteJobFailure: vi.fn() }));
vi.mock('@/lib/youtube/settings', () => ({ getYoutubeSettings: vi.fn(async () => ({ pollVideosSecs: 600 })) }));
vi.mock('@/lib/youtube/sync', () => ({ syncChannelVideos: mocks.sync }));
vi.mock('@/lib/youtube/reconcile', () => ({ reconcileYoutubeJobs: vi.fn(async () => undefined) }));
vi.mock('@/lib/archive/jobs', () => ({ enqueueDownload: mocks.enqueue }));
vi.mock('@/lib/youtube/policy', () => ({
  POLICY_VIDEO: { id: true },
  decideForYoutubeVideo: mocks.decide,
  optionsFromPolicy: () => ({ quality: '1080' }),
  settleTime: () => new Date('2026-11-01T15:00:00Z'),
}));
vi.mock('@/lib/youtube/playlists', () => ({ syncPlaylist: mocks.syncList }));
vi.mock('./shared', () => ({ errorMessage: String, notifyAndLog: mocks.notify }));
vi.mock('@/lib/youtube/api', async (original) => ({
  ...await original<typeof import('@/lib/youtube/api')>(),
  quotaState: mocks.quota,
}));

import { YoutubeKeyRejectedError, YoutubeQuotaError } from '@/lib/youtube/api';
import { pollYoutube } from './poll-youtube';

const NOW = new Date('2026-11-01T12:00:00Z');
const after = (secs: number) => new Date(NOW.getTime() + secs * 1000);

describe('polling YouTube', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connection.mockResolvedValue({ id: 'youtube' });
    mocks.quota.mockResolvedValue({ stopped: false, slowDown: false });
    mocks.due.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    mocks.sync.mockResolvedValue({ newVideoIds: [] });
    mocks.lists.mockResolvedValue([]);
    mocks.decide.mockResolvedValue({ policy: { notify: true, autoDownload: false }, trace: {}, autoDownloadReason: 'off' });
    mocks.syncList.mockResolvedValue({ newVideoIds: [] });
    mocks.subscribers.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);
    mocks.videos.mockResolvedValue([{ id: 'v', externalId: 'ext', title: 'A video', type: 'ARCHIVE', creator: { displayName: 'WAN Show' } }]);
  });

  it('does nothing until YouTube is connected', async () => {
    mocks.connection.mockResolvedValue(null);
    await pollYoutube(NOW);
    expect(mocks.quota).not.toHaveBeenCalled();
  });

  it('stops when the daily quota is nearly gone', async () => {
    mocks.quota.mockResolvedValue({ stopped: true, slowDown: true });
    await pollYoutube(NOW);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('only ever looks at followed YouTube channels that are due', async () => {
    await pollYoutube(NOW);
    expect(mocks.due.mock.calls[0][0].where).toMatchObject({ platform: 'YOUTUBE', subscriptions: { some: {} } });
  });

  it('checks half as often once the quota runs low', async () => {
    await pollYoutube(NOW);
    expect(mocks.advance.mock.calls[0][0].data).toEqual({ nextVideosCheckAt: after(600) });

    mocks.advance.mockClear();
    mocks.quota.mockResolvedValue({ stopped: false, slowDown: true });
    await pollYoutube(NOW);
    expect(mocks.advance.mock.calls[0][0].data).toEqual({ nextVideosCheckAt: after(1200) });
  });

  it('moves on from one failing channel', async () => {
    mocks.sync.mockRejectedValueOnce(new Error('YouTube request failed: 500'));
    await pollYoutube(NOW);
    expect(mocks.sync).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['the quota', new YoutubeQuotaError()],
    ['a rejected key', new YoutubeKeyRejectedError()],
  ])('stops the cycle on %s, which the next channel could not fix', async (_label, error) => {
    mocks.sync.mockRejectedValueOnce(error);
    await pollYoutube(NOW);
    expect(mocks.sync).toHaveBeenCalledTimes(1);
  });

  it('sweeps followed lists too, and tells their followers under the same key as a channel alert', async () => {
    mocks.lists.mockResolvedValue([{ id: 'l', title: 'Best of' }]);
    mocks.syncList.mockResolvedValue({ newVideoIds: ['v'] });
    mocks.listSubscribers.mockResolvedValue([{ userId: 'u1' }]);

    await pollYoutube(NOW);

    expect(mocks.lists.mock.calls[0][0].where).toMatchObject({ platform: 'YOUTUBE', subscriptions: { some: {} } });
    expect(mocks.advanceList.mock.calls[0][0].data).toEqual({ nextCheckAt: after(600) });
    expect(mocks.notify.mock.calls[0][0]).toMatchObject({ title: 'Best of: new video', dedupeKey: 'youtube-video-ext-u1' });
  });

  it('queues what the rules pick, not before its wait', async () => {
    mocks.due.mockResolvedValue([{ id: 'a' }]);
    mocks.sync.mockResolvedValue({ newVideoIds: ['v'] });
    mocks.decide.mockResolvedValue({ policy: { notify: true, autoDownload: true }, trace: {}, autoDownloadReason: 'on in streamer' });

    await pollYoutube(NOW);

    expect(mocks.enqueue.mock.calls[0][0]).toMatchObject({
      platform: 'YOUTUBE', videoId: 'v', source: 'RULE', runAfter: new Date('2026-11-01T15:00:00Z'), trace: { reason: 'on in streamer' },
    });
  });

  it('queues nothing the rules leave alone', async () => {
    mocks.due.mockResolvedValue([{ id: 'a' }]);
    mocks.sync.mockResolvedValue({ newVideoIds: ['v'] });

    await pollYoutube(NOW);

    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('stays quiet about a video when the rules say not to notify', async () => {
    mocks.due.mockResolvedValue([{ id: 'a' }]);
    mocks.sync.mockResolvedValue({ newVideoIds: ['v'] });
    mocks.decide.mockResolvedValue({ policy: { notify: false, autoDownload: false }, trace: {}, autoDownloadReason: 'off' });

    await pollYoutube(NOW);

    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.stamp).toHaveBeenCalled();
  });

  it('tells each follower once, with a link that can start the download', async () => {
    mocks.due.mockResolvedValue([{ id: 'a' }]);
    mocks.sync.mockResolvedValue({ newVideoIds: ['v'] });

    await pollYoutube(NOW);

    expect(mocks.subscribers.mock.calls[0][0].where).toEqual({ creatorId: 'a', notifyNewVods: true });
    expect(mocks.notify).toHaveBeenCalledTimes(2);
    expect(mocks.notify.mock.calls[0][0]).toMatchObject({
      eventType: 'youtubeVideoNew',
      title: 'WAN Show: new live replay',
      url: '/youtube/video/v',
      dedupeKey: 'youtube-video-ext-u1',
      userIds: ['u1'],
      metadata: { redirect: '/youtube/video/v?download=1' },
    });
    expect(mocks.stamp).toHaveBeenCalledWith({ where: { id: { in: ['v'] } }, data: { notifiedAt: NOW } });
  });
});
