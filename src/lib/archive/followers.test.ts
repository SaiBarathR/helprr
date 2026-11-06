import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { id: 'u1', role: 'admin', template: 'admin', permissions: {} } as Record<string, unknown>,
  subscription: { findFirst: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
  playlistSubscription: { findFirst: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
  creator: { findUnique: vi.fn() },
  playlist: { findUnique: vi.fn() },
  policy: { findUnique: vi.fn() },
  videoGroups: vi.fn(async () => []),
  youtubeSettings: vi.fn(),
  twitchSettings: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUserCapability: vi.fn(async () => ({ ok: true, user: mocks.user })) }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: <T,>(handler: T) => handler }));
vi.mock('@/lib/db', () => ({
  prisma: {
    creatorSubscription: mocks.subscription,
    creatorPlaylistSubscription: mocks.playlistSubscription,
    creator: mocks.creator,
    creatorPlaylist: mocks.playlist,
    creatorPolicy: mocks.policy,
    creatorVideo: { groupBy: mocks.videoGroups },
  },
}));
vi.mock('@/lib/youtube/settings', () => ({ getYoutubeSettings: mocks.youtubeSettings }));
vi.mock('@/lib/twitch/settings', () => ({ getTwitchSettings: mocks.twitchSettings }));

import { DELETE as leaveChannel } from '@/app/api/youtube/subscriptions/[id]/route';
import { DELETE as leavePlaylist } from '@/app/api/youtube/playlist-subscriptions/[id]/route';
import { DELETE as leaveStreamer } from '@/app/api/twitch/subscriptions/[id]/route';
import { GET as getChannel } from '@/app/api/youtube/channels/[id]/route';
import { GET as getPlaylist } from '@/app/api/youtube/playlists/[id]/route';
import { GET as getStreamer } from '@/app/api/twitch/streamers/[id]/route';

const MEMBER = { id: 'u2', role: 'member', template: 'member', permissions: { 'youtube.view': true, 'twitch.view': true } };
const ADMIN = { id: 'u1', role: 'admin', template: 'admin', permissions: {} };
const req = () => new NextRequest('http://test/', { method: 'DELETE' });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const settings = (extra: Record<string, unknown> = {}) => ({ autoDownloadEnabled: true, defaultPolicy: {}, typePolicies: {}, ...extra });

describe('unfollowing a creator others still follow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = ADMIN;
    mocks.subscription.findFirst.mockResolvedValue({ creatorId: 'c1' });
    mocks.subscription.deleteMany.mockResolvedValue({ count: 1 });
    mocks.subscription.count.mockResolvedValue(2);
    mocks.playlistSubscription.findFirst.mockResolvedValue({ playlistId: 'p1' });
    mocks.playlistSubscription.deleteMany.mockResolvedValue({ count: 1 });
    mocks.playlistSubscription.count.mockResolvedValue(1);
    mocks.policy.findUnique.mockResolvedValue({ policy: { autoDownload: true }, typePolicies: {} });
    mocks.playlist.findUnique.mockResolvedValue({ policy: {} });
    mocks.youtubeSettings.mockResolvedValue(settings());
    mocks.twitchSettings.mockResolvedValue(settings());
  });

  it('tells an admin who else follows and that the channel rule still downloads', async () => {
    const response = await leaveChannel(req(), ctx('s1'));
    expect(await response.json()).toEqual({ ok: true, othersFollowing: 2, autoDownload: true });
    // Only the caller's own subscription, on this platform.
    expect(mocks.subscription.deleteMany).toHaveBeenCalledWith({ where: { id: 's1', userId: 'u1', creator: { platform: 'YOUTUBE' } } });
    expect(mocks.subscription.count).toHaveBeenCalledWith({ where: { creatorId: 'c1' } });
  });

  it('gives a member the count, never the rule', async () => {
    mocks.user = MEMBER;
    const response = await leaveChannel(req(), ctx('s1'));
    expect(await response.json()).toEqual({ ok: true, othersFollowing: 2 });
    expect(mocks.policy.findUnique).not.toHaveBeenCalled();
  });

  it('reads a rule as off when a video type or the master switch turns it off', async () => {
    mocks.policy.findUnique.mockResolvedValue({ policy: {}, typePolicies: {} });
    expect(await (await leaveChannel(req(), ctx('s1'))).json()).toMatchObject({ autoDownload: false });

    // On for Shorts only, from the global type rule.
    mocks.youtubeSettings.mockResolvedValue(settings({ typePolicies: { SHORT: { autoDownload: true } } }));
    expect(await (await leaveChannel(req(), ctx('s1'))).json()).toMatchObject({ autoDownload: true });

    // Every type of this channel turned off by its own rules.
    mocks.policy.findUnique.mockResolvedValue({ policy: { autoDownload: false }, typePolicies: { SHORT: { autoDownload: false } } });
    expect(await (await leaveChannel(req(), ctx('s1'))).json()).toMatchObject({ autoDownload: false });

    mocks.policy.findUnique.mockResolvedValue({ policy: { autoDownload: true }, typePolicies: {} });
    mocks.youtubeSettings.mockResolvedValue(settings({ autoDownloadEnabled: false }));
    expect(await (await leaveChannel(req(), ctx('s1'))).json()).toMatchObject({ autoDownload: false });
  });

  it('says nothing downloads when nobody else follows', async () => {
    mocks.subscription.count.mockResolvedValue(0);
    expect(await (await leaveChannel(req(), ctx('s1'))).json()).toEqual({ ok: true, othersFollowing: 0, autoDownload: false });
    expect(mocks.policy.findUnique).not.toHaveBeenCalled();
  });

  it('still refuses a subscription that is not the caller\'s', async () => {
    mocks.subscription.findFirst.mockResolvedValue(null);
    expect((await leaveChannel(req(), ctx('s1'))).status).toBe(404);
    expect(mocks.subscription.deleteMany).not.toHaveBeenCalled();
  });

  it('works the same for a Twitch streamer, under twitch.manage', async () => {
    const response = await leaveStreamer(req(), ctx('s1'));
    expect(await response.json()).toEqual({ ok: true, othersFollowing: 2, autoDownload: true });
    expect(mocks.subscription.deleteMany).toHaveBeenCalledWith({ where: { id: 's1', userId: 'u1', creator: { platform: 'TWITCH' } } });
    expect(mocks.twitchSettings).toHaveBeenCalled();

    mocks.user = { ...MEMBER, permissions: { 'twitch.view': true, 'youtube.manage': true } };
    expect(await (await leaveStreamer(req(), ctx('s1'))).json()).toEqual({ ok: true, othersFollowing: 2 });
  });

  it('tells who else follows a playlist, and whether its rules download', async () => {
    expect(await (await leavePlaylist(req(), ctx('ps1'))).json()).toEqual({ ok: true, othersFollowing: 1, autoDownload: false });
    expect(mocks.playlistSubscription.count).toHaveBeenCalledWith({ where: { playlistId: 'p1' } });

    mocks.youtubeSettings.mockResolvedValue(settings({ defaultPolicy: { autoDownload: true } }));
    expect(await (await leavePlaylist(req(), ctx('ps1'))).json()).toMatchObject({ autoDownload: true });

    mocks.user = MEMBER;
    expect(await (await leavePlaylist(req(), ctx('ps1'))).json()).toEqual({ ok: true, othersFollowing: 1 });
  });
});

describe('how many people follow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const row = { id: 'c1', subscriptions: [{ id: 's1', notifyNewVods: true }], _count: { subscriptions: 3 } };
    mocks.creator.findUnique.mockResolvedValue(row);
    mocks.playlist.findUnique.mockResolvedValue({ ...row, subscriptions: [{ id: 's1', notifyNewVideos: true }] });
  });

  it('is shown to whoever can change the rules', async () => {
    mocks.user = ADMIN;
    for (const get of [getChannel, getPlaylist, getStreamer]) {
      const body = await (await get(req(), ctx('c1'))).json();
      expect(body.followers).toBe(3);
      expect(body).not.toHaveProperty('_count');
    }
  });

  it('is not shown to a member', async () => {
    mocks.user = MEMBER;
    for (const get of [getChannel, getPlaylist, getStreamer]) {
      const body = await (await get(req(), ctx('c1'))).json();
      expect(body).not.toHaveProperty('followers');
      expect(body).not.toHaveProperty('_count');
    }
  });
});
