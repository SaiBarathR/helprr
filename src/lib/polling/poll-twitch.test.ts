import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  helixGet: vi.fn(),
  enqueueDownload: vi.fn(),
  getJellyfinClient: vi.fn(),
  decideForVideo: vi.fn(),
  job: { updateMany: vi.fn(), count: vi.fn() },
  syncStreamerVideos: vi.fn(),
  notifyAndLog: vi.fn(),
  noteJobFailure: vi.fn(),
  connection: { findFirst: vi.fn() },
  streamer: { findMany: vi.fn(), update: vi.fn() },
  settings: { upsert: vi.fn(), update: vi.fn() },
  video: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  subscription: { findMany: vi.fn() },
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    serviceConnection: mocks.connection,
    twitchStreamer: mocks.streamer,
    twitchSettings: mocks.settings,
    twitchVideo: mocks.video,
    twitchSubscription: mocks.subscription,
    twitchJob: mocks.job,
  },
}));
vi.mock('@/lib/twitch/helix', () => ({ helixGet: mocks.helixGet }));
vi.mock('@/lib/twitch/sync', () => ({ syncStreamerVideos: mocks.syncStreamerVideos }));
vi.mock('@/lib/twitch/jobs', () => ({ enqueueDownload: mocks.enqueueDownload }));
vi.mock('@/lib/twitch/policy-store', () => ({ decideForVideo: mocks.decideForVideo }));
vi.mock('@/lib/service-helpers', () => ({ getJellyfinClient: mocks.getJellyfinClient }));
vi.mock('@/lib/twitch/browser-token', () => ({ checkStoredBrowserToken: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/twitch/reconcile', () => ({ reconcileTwitchJobs: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/polling-job-report', () => ({ noteJobFailure: mocks.noteJobFailure }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));
vi.mock('./shared', () => ({
  notifyAndLog: mocks.notifyAndLog,
  errorMessage: (error: unknown) => String(error),
}));

import { pollTwitch } from './poll-twitch';

const now = new Date('2026-10-30T08:00:00');
const liveStreamer = { id: 's1', twitchUserId: '100', isLive: true, liveMissedChecks: 0 };
const rateLimit = { remaining: 700, resetAt: null };
const settings = (overrides = {}) => ({
  pollLiveSecs: 60, pollVideosSecs: 300, lastLivePollAt: null, reencodeEnabled: false, reencodeWindowStart: '01:00', reencodeWindowEnd: '08:00', ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connection.findFirst.mockResolvedValue({ id: 'c1' });
  mocks.streamer.findMany.mockResolvedValue([liveStreamer]);
  mocks.settings.upsert.mockResolvedValue(settings());
  mocks.helixGet.mockResolvedValue({ data: [], cursor: null, rateLimit });
  mocks.syncStreamerVideos.mockResolvedValue({ rateLimit, newVideoIds: [] });
  mocks.subscription.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);
  mocks.video.findMany.mockResolvedValue([]);
});

function dueStreamers(rows: unknown[]) {
  mocks.streamer.findMany.mockResolvedValueOnce([liveStreamer]).mockResolvedValueOnce(rows);
}

describe('pollTwitch', () => {
  it('does nothing until Twitch is configured', async () => {
    mocks.connection.findFirst.mockResolvedValue(null);
    await pollTwitch(now);
    expect(mocks.streamer.findMany).not.toHaveBeenCalled();
    expect(mocks.helixGet).not.toHaveBeenCalled();
  });

  it('does nothing without streamers', async () => {
    mocks.streamer.findMany.mockResolvedValue([]);
    await pollTwitch(now);
    expect(mocks.helixGet).not.toHaveBeenCalled();
  });

  it('throttles live checks from the stored timestamp, so a restart does not reset it', async () => {
    mocks.settings.upsert.mockResolvedValue(settings({ lastLivePollAt: new Date(now.getTime() - 30_000) }));
    dueStreamers([]);

    await pollTwitch(now);

    expect(mocks.helixGet).not.toHaveBeenCalled();
    expect(mocks.settings.update).not.toHaveBeenCalled();
  });

  it('records the time of a live check', async () => {
    dueStreamers([]);
    await pollTwitch(now);
    expect(mocks.settings.update).toHaveBeenCalledWith({ where: { id: 'singleton' }, data: { lastLivePollAt: now } });
  });

  it('keeps a streamer live after one absent check', async () => {
    dueStreamers([]);
    await pollTwitch(now);
    expect(mocks.streamer.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { liveMissedChecks: 1 } });
  });

  it('declares offline on the second absence and schedules a check two minutes later', async () => {
    mocks.streamer.findMany.mockReset();
    mocks.streamer.findMany
      .mockResolvedValueOnce([{ ...liveStreamer, liveMissedChecks: 1 }])
      .mockResolvedValueOnce([]);

    await pollTwitch(now);

    expect(mocks.streamer.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: {
        isLive: false,
        liveStreamId: null,
        liveMissedChecks: 0,
        nextVideosCheckAt: new Date(now.getTime() + 120_000),
      },
    });
  });

  it('stops before the video sweep when the rate limit runs low', async () => {
    mocks.helixGet.mockResolvedValue({ data: [], cursor: null, rateLimit: { remaining: 10, resetAt: null } });
    await pollTwitch(now);
    expect(mocks.syncStreamerVideos).not.toHaveBeenCalled();
    expect(mocks.streamer.update).not.toHaveBeenCalled();
  });

  it('notifies each subscriber once, with their own dedupe key', async () => {
    dueStreamers([{ id: 's1' }]);
    mocks.syncStreamerVideos.mockResolvedValue({ rateLimit, newVideoIds: ['v1'] });
    mocks.video.findMany.mockResolvedValue([{
      id: 'v1', twitchVideoId: '555', title: 'A stream', type: 'ARCHIVE', streamer: { displayName: 'Name' },
    }]);
    mocks.decideForVideo.mockResolvedValue({ policy: { notify: true, autoDownload: false }, trace: {}, autoDownloadReason: '' });

    await pollTwitch(now);

    const events = mocks.notifyAndLog.mock.calls.map(([event]) => event);
    expect(events.map((event) => event.dedupeKey)).toEqual(['twitch-vod-555-u1', 'twitch-vod-555-u2']);
    expect(events[0]).toMatchObject({ eventType: 'twitchVodNew', userIds: ['u1'], ownerUserId: 'u1' });
    expect(events[0].metadata.redirect).toBe('/twitch/vod/v1?download=1');
    expect(mocks.video.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['v1'] } }, data: { notifiedAt: now } });
  });

  it('queues a new video only when the rules say so, with its trace', async () => {
    dueStreamers([{ id: 's1' }]);
    mocks.syncStreamerVideos.mockResolvedValue({ rateLimit, newVideoIds: ['v1', 'v2'] });
    const row = (id: string) => ({ id, twitchVideoId: id, title: 'T', type: 'ARCHIVE', streamer: { displayName: 'N' }, streamerId: 's1', durationSeconds: 60 });
    mocks.video.findMany.mockResolvedValue([row('v1'), row('v2')]);
    const policy = { autoDownload: true, quality: '720p60', chat: true, chapters: true, reencode: true, keepForever: false };
    mocks.decideForVideo
      .mockResolvedValueOnce({ policy: { notify: false } })
      .mockResolvedValueOnce({ policy: { notify: false } })
      .mockResolvedValueOnce({ policy, trace: { autoDownload: 'streamer' }, autoDownloadReason: 'on in streamer' })
      .mockResolvedValueOnce({ policy: { ...policy, autoDownload: false }, trace: {}, autoDownloadReason: 'master-switch' });

    await pollTwitch(now);

    expect(mocks.notifyAndLog).not.toHaveBeenCalled();
    expect(mocks.enqueueDownload).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueDownload.mock.calls[0][0]).toMatchObject({
      videoId: 'v1',
      source: 'RULE',
      options: { quality: '720p60' },
      trace: { autoDownload: 'streamer', reason: 'on in streamer' },
    });
  });

  it('raises the priority of queued jobs close to expiry, and queues nothing itself', async () => {
    dueStreamers([]);
    await pollTwitch(now);
    expect(mocks.job.updateMany.mock.calls[0][0].data).toEqual({ priority: 100 });
    expect(mocks.enqueueDownload).not.toHaveBeenCalled();
  });

  it('marks Jellyfin busy inside the window only while a video transcode runs', async () => {
    mocks.settings.upsert.mockResolvedValue(settings({ reencodeEnabled: true, reencodeWindowStart: '07:00', reencodeWindowEnd: '09:00' }));
    mocks.job.count.mockResolvedValue(1);
    dueStreamers([]);
    mocks.getJellyfinClient.mockResolvedValue({
      getActiveSessions: async () => [{ TranscodingInfo: { IsVideoDirect: true } }, { TranscodingInfo: { IsVideoDirect: false } }],
    });

    await pollTwitch(now);

    expect(mocks.settings.update).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      data: { jellyfinBusyUntil: new Date(now.getTime() + 90_000) },
    });
  });

  it('keeps discovering when Jellyfin cannot be reached', async () => {
    mocks.settings.upsert.mockResolvedValue(settings({ reencodeEnabled: true, reencodeWindowStart: '07:00', reencodeWindowEnd: '09:00' }));
    mocks.job.count.mockResolvedValue(1);
    mocks.getJellyfinClient.mockRejectedValue(new Error('Jellyfin is down'));
    dueStreamers([{ id: 's1' }]);

    await pollTwitch(now);

    expect(mocks.syncStreamerVideos).toHaveBeenCalledTimes(1);
    expect(mocks.noteJobFailure).toHaveBeenCalledTimes(1);
  });

  it('asks Jellyfin nothing outside the window', async () => {
    mocks.settings.upsert.mockResolvedValue(settings({ reencodeEnabled: true, reencodeWindowStart: '01:00', reencodeWindowEnd: '02:00' }));
    dueStreamers([]);
    await pollTwitch(now);
    expect(mocks.getJellyfinClient).not.toHaveBeenCalled();
  });

  it('keeps sweeping when one streamer fails, and has already moved it along', async () => {
    dueStreamers([{ id: 's1' }, { id: 's2' }]);
    mocks.syncStreamerVideos.mockRejectedValueOnce(new Error('boom'));

    await pollTwitch(now);

    expect(mocks.syncStreamerVideos).toHaveBeenCalledTimes(2);
    expect(mocks.noteJobFailure).toHaveBeenCalledTimes(1);
  });
});
