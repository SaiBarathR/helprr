import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
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
    },
  },
}));
vi.mock('@/lib/vapid', () => ({
  getVapidPublicKey: () => 'test-public-key',
}));
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { sendPushNotification } from '@/lib/notification-service';

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
