import { beforeEach, describe, expect, it, vi } from 'vitest';

// "Now in your library" through the real notifyEvent: the per-device toggle,
// the notify.watchlist gate, the Remove button and its iOS fallback link.
// web-push is mocked, so nothing is ever sent.
const mocks = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  findMany: vi.fn(async () => [] as unknown[]),
  createHistory: vi.fn(async () => ({ id: 'h1' })),
}));

vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: mocks.sendNotification },
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    pushSubscription: { update: vi.fn(async () => ({})), findMany: mocks.findMany },
    notificationHistory: { create: mocks.createHistory, update: vi.fn(async () => ({})) },
  },
}));
vi.mock('@/lib/vapid', () => ({ getVapidPublicKey: () => 'test-public-key' }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { notifyEvent } from '@/lib/notification-service';
import { historyScope } from '@/lib/notification-scope';
import { EVENT_GROUPS } from '@/lib/notification-events';

function device(overrides: { permissions?: Record<string, boolean>; preferences?: unknown[] } = {}) {
  return {
    endpoint: 'https://web.push.apple.com/device-1',
    p256dh: 'p256dh',
    auth: 'auth',
    consecutiveFailures: 0,
    lastFailedAt: null,
    lastSucceededAt: null,
    preferences: overrides.preferences ?? [],
    user: { id: 'u-member', role: 'member', template: 'member', permissions: overrides.permissions ?? {}, settings: null },
  };
}

const event = {
  eventType: 'watchlistAvailable',
  title: 'Now in your library: Dune',
  body: 'From your watchlist: ready to watch.',
  url: '/watchlist?focus=w1',
  dedupeKey: 'movie-tmdb-438631-u-member',
  userIds: ['u-member'],
  ownerUserId: 'u-member',
  metadata: { source: 'radarr', id: 'w1', movieId: 12, watchlistItemId: 'w1', redirect: '/watchlist?focus=w1' },
};

function sentPayload(): Record<string, unknown> {
  return JSON.parse(mocks.sendNotification.mock.calls[0][1] as string);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.VAPID_SUBJECT = 'mailto:test@example.com';
  process.env.VAPID_PUBLIC_KEY = 'test-public-key';
  process.env.VAPID_PRIVATE_KEY = 'test-private-key';
  mocks.sendNotification.mockResolvedValue({ statusCode: 201 });
});

describe('Now in your library push', () => {
  it('is on by default for a member, with a Remove button and a tap link that offers the same on iOS', async () => {
    mocks.findMany.mockResolvedValue([device()]);
    expect(await notifyEvent(event)).toBe(1);
    expect(sentPayload()).toMatchObject({
      url: '/watchlist?focus=w1',
      actions: [{ action: 'removeWatchlist', title: 'Remove from watchlist' }],
      data: { watchlistItemId: 'w1' },
    });
    expect(mocks.createHistory).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventType: 'watchlistAvailable', userId: 'u-member', dedupeKey: 'movie-tmdb-438631-u-member' }),
    });
  });

  it('has no button when the event carries no removable item; the link still works', async () => {
    mocks.findMany.mockResolvedValue([device()]);
    await notifyEvent({ ...event, metadata: { ...event.metadata, watchlistItemId: undefined } });
    const payload = sentPayload();
    expect(payload.actions).toBeUndefined();
    expect(payload.url).toBe('/watchlist?focus=w1');
  });

  it('respects the device toggle', async () => {
    mocks.findMany.mockResolvedValue([device({ preferences: [{ eventType: 'watchlistAvailable', enabled: false }] })]);
    expect(await notifyEvent(event)).toBe(0);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it('is not sent to someone without notify.watchlist', async () => {
    mocks.findMany.mockResolvedValue([device({ permissions: { 'notify.watchlist': false } })]);
    expect(await notifyEvent(event)).toBe(0);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it('is listed with the watchlist toggles', () => {
    expect(EVENT_GROUPS.find((g) => g.id === 'watchlist')?.types).toContain('watchlistAvailable');
  });

  it("keeps an admin's list to their own copies", () => {
    expect(historyScope({ id: 'u-admin', role: 'admin' })).toEqual({
      OR: [
        { eventType: { notIn: expect.arrayContaining(['watchlistAvailable']) } },
        { userId: 'u-admin' },
        { userId: null },
      ],
    });
  });
});

describe('New episode push', () => {
  const episode = {
    eventType: 'watchingNewEpisode',
    title: "New episode: Severance S02E05 · Trojan's Horse",
    body: "From a show you're watching: ready to watch.",
    url: '/series/7/season/2/episode/75?instance=sonarr-main',
    userIds: ['u-member'],
    ownerUserId: 'u-member',
    metadata: { source: 'sonarr', seriesId: 7, seasonNumber: 2, episodeId: 75, redirect: '/series/7/season/2/episode/75?instance=sonarr-main' },
  };

  it('is on by default, opens the episode and is the owner\'s copy', async () => {
    mocks.findMany.mockResolvedValue([device()]);
    expect(await notifyEvent(episode)).toBe(1);
    expect(sentPayload()).toMatchObject({ url: '/series/7/season/2/episode/75?instance=sonarr-main', tag: 'watchingNewEpisode-75' });
    expect(mocks.createHistory).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventType: 'watchingNewEpisode', userId: 'u-member' }),
    });
  });

  it('respects the device toggle and quiet hours', async () => {
    mocks.findMany.mockResolvedValue([device({ preferences: [{ eventType: 'watchingNewEpisode', enabled: false }] })]);
    expect(await notifyEvent(episode)).toBe(0);
    const quiet = device();
    const hour = new Date().getUTCHours();
    quiet.user.settings = { quietHoursEnabled: true, quietHoursStart: hour, quietHoursEnd: (hour + 1) % 24, timeZone: 'UTC' } as never;
    mocks.findMany.mockResolvedValue([quiet]);
    expect(await notifyEvent(episode)).toBe(0);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it('sits with the watchlist toggles and is kept out of an admin\'s list', () => {
    expect(EVENT_GROUPS.find((g) => g.id === 'watchlist')?.types).toContain('watchingNewEpisode');
    expect(historyScope({ id: 'u-admin', role: 'admin' })).toMatchObject({
      OR: [{ eventType: { notIn: expect.arrayContaining(['watchingNewEpisode']) } }, { userId: 'u-admin' }, { userId: null }],
    });
  });
});
