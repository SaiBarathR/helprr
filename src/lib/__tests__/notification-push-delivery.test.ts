import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(async () => [] as unknown[]),
  createHistory: vi.fn(async () => ({ id: 'h1' })),
  updateHistory: vi.fn(async () => ({})),
  findUsers: vi.fn(async () => [] as unknown[]),
}));

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: mocks.setVapidDetails,
    sendNotification: mocks.sendNotification,
  },
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    pushSubscription: {
      update: mocks.update,
      delete: mocks.delete,
      updateMany: mocks.updateMany,
      findUnique: mocks.findUnique,
      findMany: mocks.findMany,
    },
    notificationHistory: { create: mocks.createHistory, update: mocks.updateHistory },
    user: { findMany: mocks.findUsers },
  },
}));
vi.mock('@/lib/vapid', () => ({
  getVapidPublicKey: () => 'test-public-key',
}));
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { Prisma } from '@prisma/client';
import { notifyEvent, sendPushNotification, usersWhoCouldReceive } from '@/lib/notification-service';
import { PollNotificationCollector } from '@/lib/notification-grouping';
import { jobReports, type JobReport } from '@/lib/polling-job-report';

const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/test-device',
  p256dh: 'p256dh-key',
  auth: 'auth-key',
};

// A dozing Android phone typically only reaches its next FCM maintenance
// window after well over an hour, so anything below this is effectively a
// guaranteed miss for a locked phone.
const DOZE_SAFE_TTL_SECONDS = 4 * 60 * 60;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.VAPID_SUBJECT = 'mailto:test@example.com';
  process.env.VAPID_PRIVATE_KEY = 'test-private-key';
  mocks.sendNotification.mockResolvedValue({ statusCode: 201 });
  mocks.update.mockResolvedValue({});
});

async function optionsForTag(tag?: string): Promise<Record<string, unknown>> {
  const ok = await sendPushNotification(subscription, { title: 'Title', body: 'Body', tag });
  expect(ok).toBe(true);
  const lastCall = mocks.sendNotification.mock.calls.at(-1);
  expect(lastCall).toBeDefined();
  return lastCall![2] as Record<string, unknown>;
}

// The endpoint is a URL the server posts to. The subscribe route refuses one
// that is not a push service's, and the sender checks again for rows stored
// before it did.
describe('push destination', () => {
  it.each([
    'https://collector.example/hook',
    'https://internal;.push.apple.com/device',
    'http://fcm.googleapis.com/fcm/send/test-device',
  ])('does not send to %s', async (endpoint) => {
    const ok = await sendPushNotification({ ...subscription, endpoint }, { title: 'Title', body: 'Body' });
    expect(ok).toBe(false);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});

// FCM only wakes a device in Doze for high-urgency pushes; the web-push
// default ("normal") parks the message until the next maintenance window.
// Every Helprr push displays a notification (src/app/sw.ts), so high urgency
// is compliant with FCM's visible-notification policy.
describe('push urgency', () => {
  it('sends every push with high urgency', async () => {
    for (const tag of ['grabbed-1', 'requestCreated-2', 'healthWarning', undefined]) {
      const options = await optionsForTag(tag);
      expect(options.urgency).toBe('high');
    }
  });
});

describe('push TTL', () => {
  it('gives transient item events a Doze-safe TTL', async () => {
    for (const tag of [
      'grabbed-101',
      'imported-101',
      'downloadFailed-101',
      'importFailed-101',
      'torrentAdded-abc',
      'torrentCompleted-abc',
      'torrentDeleted-abc',
      'cleanupStrike-abc',
      'cleanupRemoved-abc',
      'requestCreated-5',
      'requestApproved-5',
      'requestAvailable-5',
      'requestDeclined-5',
      'requestFailed-5',
      'jellyfinItemAdded-9',
      'healthWarning',
      'serviceDown',
      'serviceRestored',
      'diskLowSpace',
    ]) {
      const options = await optionsForTag(tag);
      expect(options.TTL, `TTL for ${tag}`).toBeGreaterThanOrEqual(DOZE_SAFE_TTL_SECONDS);
    }
  });

  it('defaults unknown events and missing tags to a Doze-safe TTL', async () => {
    expect((await optionsForTag('someFutureEvent-1')).TTL).toBeGreaterThanOrEqual(DOZE_SAFE_TTL_SECONDS);
    expect((await optionsForTag(undefined)).TTL).toBeGreaterThanOrEqual(DOZE_SAFE_TTL_SECONDS);
  });

  it('keeps playback-start short-lived but long enough to survive brief Doze gaps', async () => {
    const options = await optionsForTag('jellyfinPlaybackStart-session1');
    expect(options.TTL).toBe(15 * 60);
  });

  it('keeps calendar-style events valid for a full day', async () => {
    for (const tag of ['upcomingPremiere-7', 'watchlistReminder-7', 'scheduledAlert-7']) {
      const options = await optionsForTag(tag);
      expect(options.TTL, `TTL for ${tag}`).toBe(24 * 60 * 60);
    }
  });
});

// A push that went out still counts; the polling job is told its bookkeeping failed.
describe('notification writes that fail after sending', () => {
  const inJob = async (run: () => Promise<unknown>) => {
    const report: JobReport = { failure: null, skipped: false };
    await jobReports.run(report, run);
    return report;
  };

  it('reports a delivery-state write that failed, but not one for a subscription removed meanwhile', async () => {
    mocks.update.mockRejectedValueOnce(new Error('write failed'));
    expect((await inJob(() => sendPushNotification(subscription, { title: 'Title', body: 'Body' }))).failure).toBe('write failed');

    mocks.update.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Record not found', { code: 'P2025', clientVersion: '6' }));
    expect((await inJob(() => sendPushNotification(subscription, { title: 'Title', body: 'Body' }))).failure).toBeNull();
  });

  it('reports a delivery count that could not be saved', async () => {
    mocks.updateHistory.mockRejectedValueOnce(new Error('count write failed'));

    expect((await inJob(() => notifyEvent({ eventType: 'grabbed', title: 'Title', body: 'Body' }))).failure).toBe('count write failed');
  });
});

// A Tonight pick invite reaches a device only once its owner turns it on.
describe('events that start off', () => {
  const device = (name: string, preferences: { eventType: string; enabled: boolean }[]) => ({
    ...subscription,
    id: name,
    endpoint: `${subscription.endpoint}-${name}`,
    consecutiveFailures: 0,
    lastFailedAt: null,
    lastSucceededAt: null,
    preferences,
    user: { id: `user-${name}`, status: 'active', role: 'admin', template: 'admin', permissions: {}, settings: null },
  });
  const sentTo = () => mocks.sendNotification.mock.calls.map(([target]) => (target as { endpoint: string }).endpoint);

  it('skips a device with no saved choice for a default-off event, and sends where it was turned on', async () => {
    mocks.findMany.mockResolvedValueOnce([
      device('unset', []),
      device('on', [{ eventType: 'tonightPickInvite', enabled: true }]),
      device('off', [{ eventType: 'tonightPickInvite', enabled: false }]),
    ]);
    await notifyEvent({ eventType: 'tonightPickInvite', title: 'Pick', body: 'Body' });
    expect(sentTo()).toEqual([`${subscription.endpoint}-on`]);
  });

  it('sends a test push during quiet hours, and holds other events then', async () => {
    const hour = new Date().getUTCHours();
    const sleepy = () => ({
      ...device('sleepy', []),
      user: {
        id: 'user-sleepy', status: 'active', role: 'admin', template: 'admin', permissions: {},
        settings: { quietHoursEnabled: true, quietHoursStart: hour, quietHoursEnd: (hour + 1) % 24, timeZone: 'UTC' },
      },
    });
    mocks.findMany.mockResolvedValueOnce([sleepy()]);
    await notifyEvent({ eventType: 'test', title: 'Test', body: 'Body', userIds: ['user-sleepy'] });
    expect(sentTo()).toEqual([`${subscription.endpoint}-sleepy`]);

    mocks.sendNotification.mockClear();
    mocks.findMany.mockResolvedValueOnce([sleepy()]);
    await notifyEvent({ eventType: 'grabbed', title: 'Grabbed', body: 'Body' });
    expect(sentTo()).toEqual([]);
  });

  it("holds an upcoming film's push in quiet hours but keeps its history row, which claims it (not sent later)", async () => {
    // Before-air films now fire near 23:00 local, inside most overnight quiet
    // hours. As for every other held push: no push, but the row is written
    // with its key and recipients, so the next cycles don't send it again.
    // 23:15 in India, inside 23:00–07:00 quiet hours (a fixed clock, so no hour rollover).
    vi.useFakeTimers({ now: Date.parse('2026-10-19T17:45:00Z'), toFake: ['Date'] });
    try {
      mocks.findMany.mockResolvedValueOnce([{
        ...device('sleepy', []),
        user: {
          id: 'user-sleepy', status: 'active', role: 'admin', template: 'admin', permissions: {},
          settings: { quietHoursEnabled: true, quietHoursStart: 23, quietHoursEnd: 7, timeZone: 'Asia/Kolkata' },
        },
      }]);
      await notifyEvent({
        eventType: 'upcomingPremiere', title: 'Upcoming Movie', body: 'Film (2026) — In Cinemas',
        dedupeKey: 'radarr-r1-50-cinema-1792454400000@1792434600000', userIds: ['user-sleepy'],
        metadata: { recipientUserIds: ['user-sleepy'], source: 'radarr', movieId: 50 },
      });
    } finally {
      vi.useRealTimers();
    }
    expect(sentTo()).toEqual([]);
    expect(mocks.createHistory).toHaveBeenCalledWith({ data: expect.objectContaining({
      dedupeKey: 'radarr-r1-50-cinema-1792454400000@1792434600000',
      metadata: expect.objectContaining({ recipientUserIds: ['user-sleepy'] }),
    }) });
  });

  it('still sends other events to a device with no saved choice', async () => {
    mocks.findMany.mockResolvedValueOnce([device('unset', [])]);
    await notifyEvent({ eventType: 'grabbed', title: 'Grabbed', body: 'Body' });
    expect(sentTo()).toEqual([`${subscription.endpoint}-unset`]);
  });
});

// "Upgraded" is its own event: on for a device that never chose, switched
// apart from "Imported", filtered by quality like it, and gated by notify.media.
describe('upgrade pushes', () => {
  const device = (name: string, preferences: Record<string, unknown>[], user: Record<string, unknown> = {}) => ({
    ...subscription,
    id: name,
    endpoint: `${subscription.endpoint}-${name}`,
    consecutiveFailures: 0,
    lastFailedAt: null,
    lastSucceededAt: null,
    preferences: preferences.map((p) => ({ tagFilter: null, qualityFilter: null, mutedUserFilter: null, ...p })),
    user: { id: `user-${name}`, status: 'active', role: 'member', template: 'member', permissions: {}, settings: null, ...user },
  });
  const sentTo = () => mocks.sendNotification.mock.calls
    .map(([target]) => (target as { endpoint: string }).endpoint.replace(`${subscription.endpoint}-`, ''));
  const upgrade = { eventType: 'upgraded', title: 'Movie Upgraded', body: 'WEBDL-1080p → Bluray-2160p: Film', metadata: { source: 'radarr', instanceId: 'r1', movieId: 4, qualityName: 'Bluray-2160p' } };

  it('reaches a device with no saved choice and one that keeps upgrades while muting imports, not one that turned upgrades off', async () => {
    mocks.findMany.mockResolvedValueOnce([
      device('unset', []),
      device('upgrades-only', [{ eventType: 'imported', enabled: false }, { eventType: 'upgraded', enabled: true }]),
      device('new-only', [{ eventType: 'imported', enabled: true }, { eventType: 'upgraded', enabled: false }]),
    ]);
    await notifyEvent(upgrade);
    expect(sentTo()).toEqual(['unset', 'upgrades-only']);
  });

  it('applies the device quality filter set on "Upgraded"', async () => {
    mocks.findMany.mockResolvedValueOnce([
      device('4k', [{ eventType: 'upgraded', enabled: true, qualityFilter: 'Bluray-2160p' }]),
      device('1080', [{ eventType: 'upgraded', enabled: true, qualityFilter: 'WEBDL-1080p' }]),
    ]);
    await notifyEvent(upgrade);
    expect(sentTo()).toEqual(['4k']);
  });

  it('is never sent to someone without notify.media', async () => {
    mocks.findMany.mockResolvedValueOnce([
      device('member', []),
      device('no-media', [], { permissions: { 'notify.media': false } }),
    ]);
    await notifyEvent(upgrade);
    expect(sentTo()).toEqual(['member']);
  });
});

// An event about a Lidarr album tells what is in the music library: only people
// who may see that library get it. Other sources are unchanged.
describe('Lidarr-sourced pushes', () => {
  const device = (name: string, user: Record<string, unknown>) => ({
    ...subscription,
    id: name,
    endpoint: `${subscription.endpoint}-${name}`,
    consecutiveFailures: 0,
    lastFailedAt: null,
    lastSucceededAt: null,
    preferences: [],
    user: { id: `user-${name}`, status: 'active', settings: null, ...user },
  });
  const devices = () => [
    device('admin', { role: 'admin', template: 'admin', permissions: {} }),
    device('member', { role: 'member', template: 'member', permissions: {} }),
    device('no-music', { role: 'member', template: 'member', permissions: { 'music.view': false } }),
  ];
  const sentTo = () => mocks.sendNotification.mock.calls
    .map(([target]) => (target as { endpoint: string }).endpoint.replace(`${subscription.endpoint}-`, ''));

  it.each([
    ['grabbed', 'Album Download Started'],
    ['importFailed', 'Album Manual Import Required'],
    ['imported', 'Album Imported'],
    ['downloadFailed', 'Album Download Failed'],
    ['upcomingPremiere', 'Upcoming Album'],
  ])('sends %s (%s) only to those with music.view', async (eventType, title) => {
    mocks.findMany.mockResolvedValueOnce(devices());
    await notifyEvent({ eventType, title, body: 'Artist - Album', metadata: { source: 'lidarr', instanceId: 'lid-1', albumId: 4 } });
    expect(sentTo()).toEqual(['admin', 'member']);
  });

  it('sends a digest that names Lidarr albums only to those with music.view, and the other one only where targeted', async () => {
    mocks.findMany.mockResolvedValueOnce(devices());
    await notifyEvent({ eventType: 'activityDigest', title: 'Yesterday on Helprr', body: 'Album', metadata: { source: 'digest', includesLidarr: true } });
    expect(sentTo()).toEqual(['admin', 'member']);

    mocks.sendNotification.mockClear();
    // notifyEvent asks the database for the targeted users' devices only.
    mocks.findMany.mockResolvedValueOnce(devices().filter((d) => d.id === 'no-music'));
    await notifyEvent({ eventType: 'activityDigest', title: 'Yesterday on Helprr', body: 'Show', metadata: { source: 'digest' }, userIds: ['user-no-music'] });
    expect(sentTo()).toEqual(['no-music']);
  });

  it('gates a grouped Lidarr burst the same way', async () => {
    mocks.findMany.mockResolvedValueOnce(devices());
    const collector = new PollNotificationCollector();
    for (const id of [1, 2, 3]) {
      collector.add(
        { eventType: 'grabbed', title: 'Album Download Started', body: `Album ${id}`, metadata: { source: 'lidarr', instanceId: 'lid-1', id } },
        { service: 'lidarr', reason: 'queue-new-item' },
      );
    }
    const titles: string[] = [];
    await collector.flush({ enabled: true, notify: async (event) => { titles.push(event.title); return notifyEvent(event); } });
    expect(titles).toEqual(['3 Album Downloads Started']);
    expect(sentTo()).toEqual(['admin', 'member']);
  });

  it('still sends a Sonarr event to a member without music.view', async () => {
    mocks.findMany.mockResolvedValueOnce(devices());
    await notifyEvent({ eventType: 'grabbed', title: 'Download Started', body: 'Show', metadata: { source: 'sonarr', instanceId: 'son-1' } });
    expect(sentTo()).toEqual(['admin', 'member', 'no-music']);
  });
});

// Disabling a user ends their sessions but keeps their devices subscribed, so
// re-enabling them brings their pushes back; until then nothing reaches them.
describe('accounts that are not active', () => {
  const device = (name: string, status: string) => ({
    ...subscription,
    id: name,
    endpoint: `${subscription.endpoint}-${name}`,
    consecutiveFailures: 0,
    lastFailedAt: null,
    lastSucceededAt: null,
    preferences: [],
    user: { id: `user-${name}`, status, role: 'admin', template: 'admin', permissions: {}, settings: null },
  });
  const devices = () => [device('active', 'active'), device('disabled', 'disabled'), device('pending', 'pending')];
  const sentTo = () => mocks.sendNotification.mock.calls
    .map(([target]) => (target as { endpoint: string }).endpoint.replace(`${subscription.endpoint}-`, ''));

  it('sends a broadcast only to an active account', async () => {
    mocks.findMany.mockResolvedValueOnce(devices());
    await notifyEvent({ eventType: 'upcomingPremiere', title: 'Upcoming Movie', body: 'Film', metadata: { source: 'radarr', movieId: 1 } });
    expect(sentTo()).toEqual(['active']);
  });

  it('holds a targeted push to a disabled or pending account too', async () => {
    mocks.findMany.mockResolvedValueOnce(devices());
    await notifyEvent({ eventType: 'test', title: 'Test', body: 'Body', userIds: ['user-active', 'user-disabled', 'user-pending'] });
    expect(sentTo()).toEqual(['active']);
  });

  it('plans upcoming films only for active accounts', async () => {
    mocks.findUsers.mockResolvedValueOnce([
      { id: 'active', status: 'active', role: 'admin', template: 'admin', permissions: {}, settings: null, pushSubscriptions: [{ preferences: [] }], notificationChannels: [] },
      { id: 'disabled', status: 'disabled', role: 'admin', template: 'admin', permissions: {}, settings: null, pushSubscriptions: [{ preferences: [] }], notificationChannels: [] },
    ]);
    expect((await usersWhoCouldReceive('upcomingPremiere', { source: 'radarr' })).map((u) => u.id)).toEqual(['active']);
  });
});

// Upcoming films are timed per recipient, so their sends are planned only for
// the users the delivery could reach.
describe('usersWhoCouldReceive', () => {
  const user = (id: string, extra: Record<string, unknown> = {}) => ({
    id, status: 'active', role: 'member', template: 'member', permissions: {}, settings: { timeZone: `Zone/${id}` },
    pushSubscriptions: [{ preferences: [] }], notificationChannels: [], ...extra,
  });

  it('keeps users allowed the event with a device or channel that takes it', async () => {
    mocks.findUsers.mockResolvedValueOnce([
      user('phone'),
      user('admin', { role: 'admin', template: 'admin' }),
      user('channel-only', { pushSubscriptions: [], notificationChannels: [{ id: 'c1' }] }),
      user('turned-off', { pushSubscriptions: [{ preferences: [{ enabled: false }] }] }),
      user('one-of-two-on', { pushSubscriptions: [{ preferences: [{ enabled: false }] }, { preferences: [{ enabled: true }] }] }),
      user('no-media', { permissions: { 'notify.media': false } }),
      user('no-zone', { settings: null }),
    ]);
    expect(await usersWhoCouldReceive('upcomingPremiere', { source: 'radarr' })).toEqual([
      { id: 'phone', timeZone: 'Zone/phone' },
      { id: 'admin', timeZone: 'Zone/admin' },
      { id: 'channel-only', timeZone: 'Zone/channel-only' },
      { id: 'one-of-two-on', timeZone: 'Zone/one-of-two-on' },
      { id: 'no-zone', timeZone: null },
    ]);
    // Only active users with a live device or a channel set to the event are read.
    expect(mocks.findUsers).toHaveBeenCalledWith(expect.objectContaining({ where: {
      status: 'active',
      OR: [
        { pushSubscriptions: { some: { revokedAt: null } } },
        { notificationChannels: { some: { enabled: true, events: { has: 'upcomingPremiere' } } } },
      ],
    } }));
  });

  it('needs music.view for an album', async () => {
    mocks.findUsers.mockResolvedValue([user('member'), user('no-music', { permissions: { 'music.view': false } })]);
    expect((await usersWhoCouldReceive('upcomingPremiere', { source: 'lidarr' })).map((u) => u.id)).toEqual(['member']);
    expect((await usersWhoCouldReceive('upcomingPremiere', { source: 'radarr' })).map((u) => u.id)).toEqual(['member', 'no-music']);
    mocks.findUsers.mockResolvedValue([]);
  });
});
