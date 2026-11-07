import { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUserCapability: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  deleteMany: vi.fn(),
  deliver: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.requireUserCapability }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/db', () => ({
  prisma: {
    notificationChannel: {
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      count: mocks.count,
      create: mocks.create,
      update: mocks.update,
      deleteMany: mocks.deleteMany,
    },
  },
}));
vi.mock('@/lib/notification-channels/dispatch', () => ({ deliverToChannel: mocks.deliver }));

import { GET, POST } from '@/app/api/notifications/channels/route';
import { DELETE, PATCH } from '@/app/api/notifications/channels/[id]/route';
import { POST as TEST } from '@/app/api/notifications/channels/[id]/test/route';
import { encryptSecrets } from '@/lib/notification-channels/config';

const member = { id: 'member-1', role: 'member', template: 'member', permissions: {} };
const admin = { id: 'admin-1', role: 'admin', template: 'admin', permissions: {} };

function stored(extra: Record<string, unknown> = {}) {
  return {
    id: 'ch-1', userId: 'member-1', type: 'ntfy', name: 'Phone', enabled: true, events: ['imported'],
    config: { serverUrl: 'https://ntfy.sh', priority: '3' },
    secrets: encryptSecrets({ topic: 'topic-secret-xyz', token: 'tk_secret_abc' }),
    consecutiveFailures: 0, lastFailedAt: null, lastSucceededAt: null, lastError: null,
    createdAt: new Date('2026-11-07T00:00:00Z'), updatedAt: new Date('2026-11-07T00:00:00Z'),
    ...extra,
  };
}

function request(method: string, body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/notifications/channels', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-tests';
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUserCapability.mockResolvedValue({ ok: true, user: member });
  mocks.count.mockResolvedValue(0);
  mocks.create.mockImplementation(async ({ data }) => stored({ ...data, id: 'new' }));
  mocks.update.mockImplementation(async ({ data }) => stored(data));
});

describe('GET /api/notifications/channels', () => {
  it('lists only the caller\'s own channels and never a secret', async () => {
    mocks.findMany.mockResolvedValue([stored()]);
    const res = await GET();
    const text = await res.text();
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'member-1' } }));
    expect(text).not.toContain('topic-secret-xyz');
    expect(text).not.toContain('tk_secret_abc');
    expect(text).not.toContain('enc:v1');
    const body = JSON.parse(text);
    expect(body.channels[0].secretsSet.sort()).toEqual(['token', 'topic']);
    expect(body.overview).toBeUndefined();
    // A member's choices exclude events they do not receive.
    expect(body.availableEvents).toContain('imported');
    expect(body.availableEvents).not.toContain('healthWarning');
    expect(body.availableEvents).not.toContain('securityAlert');
  });

  it('gives an admin their own channels plus counts of everyone\'s, not their settings', async () => {
    mocks.requireUserCapability.mockResolvedValue({ ok: true, user: admin });
    mocks.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { userId: 'member-1', type: 'ntfy', enabled: true, consecutiveFailures: 2 },
        { userId: 'member-2', type: 'webhook', enabled: false, consecutiveFailures: 0 },
      ]);
    const res = await GET();
    const body = await res.json();
    expect(mocks.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { userId: 'admin-1' } }));
    expect(mocks.findMany).toHaveBeenNthCalledWith(2, { select: { userId: true, type: true, enabled: true, consecutiveFailures: true } });
    expect(body.channels).toEqual([]);
    expect(body.overview).toEqual({ total: 2, enabled: 1, failing: 1, people: 2, byType: { ntfy: 1, webhook: 1 } });
    expect(body.availableEvents).toContain('securityAlert');
  });
});

describe('POST /api/notifications/channels', () => {
  it('creates the channel for the caller with encrypted secrets and only events they may receive', async () => {
    const res = await POST(request('POST', {
      type: 'ntfy', name: 'Phone', events: ['imported', 'healthWarning', 'securityAlert', 'bogus'],
      config: { serverUrl: 'https://ntfy.sh' }, secrets: { topic: 'my-topic' },
    }));
    expect(res.status).toBe(201);
    const data = mocks.create.mock.calls[0][0].data;
    expect(data.userId).toBe('member-1');
    expect(data.events).toEqual(['imported']);
    expect(data.secrets).toMatch(/^enc:v1:/);
    expect(JSON.stringify(data)).not.toContain('my-topic');
    expect(await res.text()).not.toContain('my-topic');
  });

  it('refuses an address that points at cloud metadata', async () => {
    const res = await POST(request('POST', {
      type: 'webhook', name: 'Hook', secrets: { url: 'http://169.254.169.254/latest/meta-data/' },
    }));
    expect(res.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('keeps a member off the local network, but not an admin', async () => {
    const lan = { type: 'webhook', name: 'HA', secrets: { url: 'http://192.168.1.10:8123/api/webhook/x' } };
    expect((await POST(request('POST', lan))).status).toBe(400);
    mocks.requireUserCapability.mockResolvedValue({ ok: true, user: admin });
    expect((await POST(request('POST', lan))).status).toBe(201);
  });

  it('caps the number of channels per person', async () => {
    mocks.count.mockResolvedValue(10);
    const res = await POST(request('POST', { type: 'ntfy', name: 'X', secrets: { topic: 't' } }));
    expect(res.status).toBe(400);
  });
});

describe('PATCH and DELETE /api/notifications/channels/[id]', () => {
  it('treats another person\'s channel as not found, admins included', async () => {
    mocks.requireUserCapability.mockResolvedValue({ ok: true, user: admin });
    mocks.findFirst.mockResolvedValue(null);
    mocks.deleteMany.mockResolvedValue({ count: 0 });
    expect((await PATCH(request('PATCH', { enabled: false }), ctx('ch-1'))).status).toBe(404);
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: 'ch-1', userId: 'admin-1' } });
    expect((await DELETE(request('DELETE'), ctx('ch-1'))).status).toBe(404);
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { id: 'ch-1', userId: 'admin-1' } });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('keeps saved secrets on an edit that leaves them empty', async () => {
    mocks.findFirst.mockResolvedValue(stored());
    const res = await PATCH(request('PATCH', { config: { serverUrl: 'https://ntfy.sh', priority: '5' }, secrets: {} }), ctx('ch-1'));
    expect(res.status).toBe(200);
    expect(mocks.update.mock.calls[0][0].data.config).toEqual({ serverUrl: 'https://ntfy.sh', priority: '5' });
    expect(mocks.update.mock.calls[0][0].data.secrets).toMatch(/^enc:v1:/);
  });

  it('merges a partial config into the stored one', async () => {
    mocks.findFirst.mockResolvedValue(stored());
    const res = await PATCH(request('PATCH', { config: { priority: '5' } }), ctx('ch-1'));
    expect(res.status).toBe(200);
    expect(mocks.update.mock.calls[0][0].data.config).toEqual({ serverUrl: 'https://ntfy.sh', priority: '5' });
  });

  it('will not move saved secrets to a new address', async () => {
    mocks.findFirst.mockResolvedValue(stored());
    const res = await PATCH(request('PATCH', { config: { serverUrl: 'https://elsewhere.example' }, secrets: {} }), ctx('ch-1'));
    expect(res.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/notifications/channels/[id]/test', () => {
  it('sends to the caller\'s own channel and reports the short reason', async () => {
    mocks.findFirst.mockResolvedValue(stored());
    mocks.deliver.mockResolvedValue({ ok: false, reason: 'HTTP 401' });
    const res = await TEST(request('POST'), ctx('ch-1'));
    expect(await res.json()).toEqual({ ok: false, error: 'HTTP 401' });
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: 'ch-1', userId: 'member-1' } });
    expect(mocks.deliver.mock.calls[0][2]).toEqual({ allowPrivate: false });
  });

  it('does not test someone else\'s channel', async () => {
    mocks.findFirst.mockResolvedValue(null);
    const res = await TEST(request('POST'), ctx('ch-2'));
    expect(res.status).toBe(404);
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
});
