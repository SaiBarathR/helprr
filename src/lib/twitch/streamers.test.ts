import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  helixGet: vi.fn(),
  syncStreamerVideos: vi.fn(),
  streamer: { findUnique: vi.fn(), upsert: vi.fn() },
  video: { updateMany: vi.fn() },
  subscription: { upsert: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma: { twitchStreamer: mocks.streamer, twitchSubscription: mocks.subscription, twitchVideo: mocks.video } }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('@/lib/twitch/helix', () => ({ helixGet: mocks.helixGet }));
vi.mock('@/lib/twitch/sync', () => ({ syncStreamerVideos: mocks.syncStreamerVideos }));

import { subscribeToStreamer } from '@/lib/twitch/streamers';

const user = { id: '1', login: 'a', display_name: 'A', description: '', profile_image_url: '', offline_image_url: '', broadcaster_type: '' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.helixGet.mockResolvedValue({ data: [user] });
  mocks.subscription.upsert.mockResolvedValue({ id: 'sub' });
  mocks.syncStreamerVideos.mockResolvedValue({});
});

describe('subscribeToStreamer', () => {
  it('takes a new silent baseline when a streamer nobody followed is followed again', async () => {
    mocks.streamer.findUnique.mockResolvedValue({ _count: { subscriptions: 0 } });
    mocks.streamer.upsert.mockImplementation(async ({ update }) => ({ id: 's', ...update }));

    await subscribeToStreamer('u1', 'a');

    expect(mocks.streamer.upsert.mock.calls[0][0].update).toMatchObject({ baselinedAt: null, nextVideosCheckAt: null });
    expect(mocks.syncStreamerVideos).toHaveBeenCalledTimes(1);
    expect(mocks.video.updateMany.mock.calls[0][0].where).toMatchObject({ streamerId: 's', notifiedAt: null, availability: 'PUBLISHED' });
  });

  it('leaves the baseline alone while someone else follows them', async () => {
    mocks.streamer.findUnique.mockResolvedValue({ _count: { subscriptions: 1 } });
    mocks.streamer.upsert.mockImplementation(async () => ({ id: 's', baselinedAt: new Date() }));

    await subscribeToStreamer('u2', 'a');

    expect(mocks.streamer.upsert.mock.calls[0][0].update).not.toHaveProperty('baselinedAt');
    expect(mocks.syncStreamerVideos).not.toHaveBeenCalled();
  });

  it('baselines a brand-new streamer', async () => {
    mocks.streamer.findUnique.mockResolvedValue(null);
    mocks.streamer.upsert.mockImplementation(async () => ({ id: 's', baselinedAt: null }));

    await subscribeToStreamer('u1', 'a');

    expect(mocks.syncStreamerVideos).toHaveBeenCalledTimes(1);
  });
});
