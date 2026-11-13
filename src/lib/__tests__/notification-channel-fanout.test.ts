import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// notifyEvent's channel fan-out: the same scope, capability, admin-only and
// quiet-hours gates as push, the per-channel backoff, and only after the
// dedupe row is claimed. Delivery itself is replaced by a spy.

const mocks = vi.hoisted(() => ({
  findChannels: vi.fn(async () => [] as unknown[]),
  createHistory: vi.fn(async () => ({ id: 'h1' })),
  updateHistory: vi.fn(async () => ({})),
  dispatch: vi.fn(async () => 0),
}));

vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() } }));
vi.mock('@/lib/db', () => ({
  prisma: {
    pushSubscription: { findMany: vi.fn(async () => []) },
    notificationChannel: { findMany: mocks.findChannels },
    notificationHistory: { create: mocks.createHistory, update: mocks.updateHistory },
  },
}));
vi.mock('@/lib/vapid', () => ({ getVapidPublicKey: () => null }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/notification-channels/dispatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/notification-channels/dispatch')>()),
  dispatchToChannels: mocks.dispatch,
}));

import { Prisma } from '@prisma/client';
import { notifyEvent } from '@/lib/notification-service';

const admin = { id: 'admin', role: 'admin', template: 'admin', permissions: {}, status: 'active', settings: null };
const member = { id: 'member', role: 'member', template: 'member', permissions: {}, status: 'active', settings: null };
// A member who was granted health alerts: still never an admin-only event.
const healthMember = { ...member, id: 'health', permissions: { 'notify.health': true } };
const sleepyMember = {
  ...member,
  id: 'sleepy',
  settings: { quietHoursEnabled: true, quietHoursStart: 1, quietHoursEnd: 6, timeZone: 'UTC' },
};

function channel(id: string, user: object, extra: Record<string, unknown> = {}) {
  return {
    id, userId: (user as { id: string }).id, type: 'webhook', name: id, enabled: true, events: [],
    config: {}, secrets: null, consecutiveFailures: 0, lastFailedAt: null, lastSucceededAt: null, lastError: null,
    createdAt: new Date(), updatedAt: new Date(), user, ...extra,
  };
}

function dispatchedIds(): string[] {
  expect(mocks.dispatch).toHaveBeenCalledTimes(1);
  return (mocks.dispatch.mock.calls[0] as unknown as [{ id: string }[]])[0].map((c) => c.id).sort();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-07T03:30:00Z'));
  delete process.env.APP_ORIGIN;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('channel fan-out', () => {
  it('asks only for enabled channels of active users that picked the event', async () => {
    await notifyEvent({ eventType: 'imported', title: 'T', body: 'B' });
    expect(mocks.findChannels).toHaveBeenCalledWith(expect.objectContaining({
      where: { enabled: true, events: { has: 'imported' }, user: { status: 'active' } },
    }));
  });

  it('keeps a targeted event to its users', async () => {
    await notifyEvent({ eventType: 'watchlistReminder', title: 'T', body: 'B', userIds: ['member'] });
    expect(mocks.findChannels).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: { in: ['member'] } }),
    }));
  });

  it('applies capabilities: a member gets media events but not health ones', async () => {
    mocks.findChannels.mockResolvedValue([channel('a', admin), channel('m', member)]);
    await notifyEvent({ eventType: 'imported', title: 'T', body: 'B' });
    expect(dispatchedIds()).toEqual(['a', 'm']);

    mocks.dispatch.mockClear();
    await notifyEvent({ eventType: 'healthWarning', title: 'T', body: 'B' });
    expect(dispatchedIds()).toEqual(['a']);
  });

  it('sends a Lidarr album event only to those who may see the music library', async () => {
    const noMusic = { ...member, id: 'no-music', permissions: { 'music.view': false } };
    mocks.findChannels.mockResolvedValue([channel('a', admin), channel('m', member), channel('n', noMusic)]);
    await notifyEvent({ eventType: 'imported', title: 'Album Imported', body: 'B', metadata: { source: 'lidarr' } });
    expect(dispatchedIds()).toEqual(['a', 'm']);

    mocks.dispatch.mockClear();
    await notifyEvent({ eventType: 'imported', title: 'Episode Imported', body: 'B', metadata: { source: 'sonarr' } });
    expect(dispatchedIds()).toEqual(['a', 'm', 'n']);
  });

  it('sends admin-only events to admins, whatever a member was granted', async () => {
    mocks.findChannels.mockResolvedValue([channel('a', admin), channel('h', healthMember)]);
    await notifyEvent({ eventType: 'securityAlert', title: 'T', body: 'B' });
    expect(dispatchedIds()).toEqual(['a']);
  });

  it('holds back a channel during its owner\'s quiet hours, except for critical alerts', async () => {
    mocks.findChannels.mockResolvedValue([channel('a', admin), channel('s', sleepyMember)]);
    await notifyEvent({ eventType: 'imported', title: 'T', body: 'B' });
    expect(dispatchedIds()).toEqual(['a']);

    mocks.dispatch.mockClear();
    mocks.findChannels.mockResolvedValue([channel('s', { ...sleepyMember, permissions: { 'notify.health': true } })]);
    await notifyEvent({ eventType: 'serviceDown', title: 'T', body: 'B' });
    expect(dispatchedIds()).toEqual(['s']);
  });

  it('skips a failing channel while it is backing off', async () => {
    mocks.findChannels.mockResolvedValue([
      channel('fresh-failure', admin, { consecutiveFailures: 1, lastFailedAt: new Date('2026-11-07T03:28:00Z') }),
      channel('old-failure', admin, { consecutiveFailures: 1, lastFailedAt: new Date('2026-11-07T03:00:00Z') }),
      channel('healthy', admin),
    ]);
    await notifyEvent({ eventType: 'imported', title: 'T', body: 'B' });
    expect(dispatchedIds()).toEqual(['healthy', 'old-failure']);
  });

  it('sends nothing for a duplicate the dedupe row already claimed', async () => {
    mocks.findChannels.mockResolvedValue([channel('a', admin)]);
    mocks.createHistory.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
    await notifyEvent({ eventType: 'updateAvailable', title: 'T', body: 'B', dedupeKey: 'updateAvailable:1.15.0' });
    expect(mocks.findChannels).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('gives channels the in-app path, an absolute link with APP_ORIGIN, and only safe metadata', async () => {
    process.env.APP_ORIGIN = 'https://helprr.example';
    mocks.findChannels.mockResolvedValue([channel('a', admin)]);
    await notifyEvent({
      eventType: 'imported', title: 'T', body: 'B', url: '/movies/1',
      metadata: { source: 'radarr', movieId: 1, apiKey: 'should-not-leave' },
    });
    const message = (mocks.dispatch.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
    expect(message).toMatchObject({ eventType: 'imported', path: '/movies/1', link: 'https://helprr.example/movies/1' });
    expect(message.metadata).toEqual({ source: 'radarr', movieId: 1, redirect: '/movies/1' });
  });

  it('does not wait for the channels before returning', async () => {
    mocks.findChannels.mockResolvedValue([channel('a', admin)]);
    mocks.dispatch.mockImplementation(() => new Promise(() => {}));
    await expect(notifyEvent({ eventType: 'imported', title: 'T', body: 'B' })).resolves.toBe(0);
  });
});
