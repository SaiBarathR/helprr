import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  helixGet: vi.fn(),
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
  },
}));
vi.mock('@/lib/twitch/helix', () => ({ helixGet: mocks.helixGet }));
vi.mock('@/lib/twitch/sync', () => ({ syncStreamerVideos: mocks.syncStreamerVideos }));
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
const settings = (overrides = {}) => ({ pollLiveSecs: 60, pollVideosSecs: 300, lastLivePollAt: null, ...overrides });

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

    await pollTwitch(now);

    const events = mocks.notifyAndLog.mock.calls.map(([event]) => event);
    expect(events.map((event) => event.dedupeKey)).toEqual(['twitch-vod-555-u1', 'twitch-vod-555-u2']);
    expect(events[0]).toMatchObject({ eventType: 'twitchVodNew', userIds: ['u1'], ownerUserId: 'u1' });
    expect(events[0].metadata.redirect).toBe('/twitch/vod/v1?download=1');
    expect(mocks.video.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['v1'] } }, data: { notifiedAt: now } });
  });

  it('keeps sweeping when one streamer fails, and has already moved it along', async () => {
    dueStreamers([{ id: 's1' }, { id: 's2' }]);
    mocks.syncStreamerVideos.mockRejectedValueOnce(new Error('boom'));

    await pollTwitch(now);

    expect(mocks.syncStreamerVideos).toHaveBeenCalledTimes(2);
    expect(mocks.noteJobFailure).toHaveBeenCalledTimes(1);
  });
});
