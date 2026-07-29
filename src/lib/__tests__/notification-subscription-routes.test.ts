import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireUserCapability: vi.fn(),
  ensurePreferences: vi.fn(),
  findUnique: vi.fn(),
  deleteMany: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireUser: mocks.requireUser,
  requireUserCapability: mocks.requireUserCapability,
}));
vi.mock('@/lib/notification-events', () => ({
  ensureNotificationPreferences: mocks.ensurePreferences,
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    pushSubscription: {
      findUnique: mocks.findUnique,
      deleteMany: mocks.deleteMany,
      update: mocks.update,
      upsert: mocks.upsert,
      findMany: mocks.findMany,
    },
  },
}));
vi.mock('@/lib/user-dto', () => ({
  ownerScope: (user: { id: string; role: string }) =>
    user.role === 'admin' ? {} : { userId: user.id },
}));
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown) => handler,
}));

import { GET } from '@/app/api/notifications/subscriptions/route';
import {
  DELETE as DELETE_PUSH_SUBSCRIPTION,
  POST,
} from '@/app/api/push/subscribe/route';

const storedSubscription = {
  id: 'device-1',
  userId: 'user-1',
  endpoint: 'https://push.example/device',
  p256dh: 'p256dh-secret',
  auth: 'auth-secret',
  deviceName: 'Phone',
  consecutiveFailures: 0,
  lastFailedAt: null,
  lastSucceededAt: new Date('2026-07-29T01:00:00.000Z'),
  revokedAt: null,
  createdAt: new Date('2026-07-29T00:00:00.000Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  const auth = {
    ok: true,
    user: { id: 'user-1', role: 'member' },
  };
  mocks.requireUser.mockResolvedValue(auth);
  mocks.requireUserCapability.mockResolvedValue(auth);
  mocks.upsert.mockResolvedValue(storedSubscription);
  mocks.findMany.mockResolvedValue([storedSubscription]);
  mocks.deleteMany.mockResolvedValue({ count: 0 });
});

function subscribeRequest(overrides: Record<string, unknown> = {}): NextRequest {
  return new NextRequest('http://localhost/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: storedSubscription.endpoint,
      keys: {
        p256dh: storedSubscription.p256dh,
        auth: storedSubscription.auth,
      },
      ...overrides,
    }),
  });
}

describe('push subscription safe response contract', () => {
  it('returns only management-list fields after subscribing', async () => {
    const response = await POST(subscribeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      id: 'device-1',
      endpoint: 'https://push.example/device',
      deviceName: 'Phone',
      consecutiveFailures: 0,
      lastFailedAt: null,
      lastSucceededAt: '2026-07-29T01:00:00.000Z',
      createdAt: '2026-07-29T00:00:00.000Z',
    });
    expect(body).not.toHaveProperty('p256dh');
    expect(body).not.toHaveProperty('auth');
    expect(body).not.toHaveProperty('userId');
    expect(mocks.ensurePreferences).toHaveBeenCalledWith('device-1');
  });

  it('returns the same stable id after an owned endpoint rotation', async () => {
    mocks.findUnique.mockResolvedValue(storedSubscription);
    mocks.update.mockResolvedValue({
      ...storedSubscription,
      endpoint: 'https://push.example/rotated',
    });

    const response = await POST(subscribeRequest({
      endpoint: 'https://push.example/rotated',
      oldEndpoint: storedSubscription.endpoint,
    }));

    expect(await response.json()).toMatchObject({
      id: 'device-1',
      endpoint: 'https://push.example/rotated',
    });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'device-1' },
    }));
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('uses the same secret-free serializer for the management list', async () => {
    const response = await GET();
    const body = await response.json();

    expect(body).toEqual([{
      id: 'device-1',
      endpoint: 'https://push.example/device',
      deviceName: 'Phone',
      consecutiveFailures: 0,
      lastFailedAt: null,
      lastSucceededAt: '2026-07-29T01:00:00.000Z',
      createdAt: '2026-07-29T00:00:00.000Z',
    }]);
    expect(body[0]).not.toHaveProperty('p256dh');
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { revokedAt: null, userId: 'user-1' },
    }));
  });

  it('reports a failed unsubscribe instead of confirming a cache mutation', async () => {
    mocks.deleteMany.mockRejectedValueOnce(new Error('database unavailable'));
    const response = await DELETE_PUSH_SUBSCRIPTION(new NextRequest(
      'http://localhost/api/push/subscribe',
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: storedSubscription.endpoint }),
      },
    ));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Failed to remove push subscription',
    });
  });
});
