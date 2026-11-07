import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  deleteMany: vi.fn(),
  findFirst: vi.fn(),
  sessionUpdateMany: vi.fn(),
  recordSecurityEvent: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/security-audit', () => ({ recordSecurityEvent: mocks.recordSecurityEvent, coarseIp: () => null }));
vi.mock('@/lib/db', () => {
  const prisma = {
    apiToken: { findMany: mocks.findMany, count: mocks.count, create: mocks.create, deleteMany: mocks.deleteMany, findFirst: mocks.findFirst },
    session: { updateMany: mocks.sessionUpdateMany },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
  };
  return { prisma };
});

import { GET, POST } from './route';
import { DELETE } from './[id]/route';
import { hashApiToken, MAX_API_TOKENS } from '@/lib/api-tokens';

const NOW = new Date('2026-11-07T10:00:00Z');
const MEMBER = {
  id: 'u1', username: 'member', role: 'member', template: 'member',
  // A member who may not see Jellyfin sessions.
  permissions: { 'jellyfin.sessions': false }, status: 'active',
};

function post(body: unknown) {
  return POST(new NextRequest('http://localhost/api/me/api-tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  mocks.requireUser.mockResolvedValue({ ok: true, user: MEMBER, session: { id: 's1' } });
  mocks.count.mockResolvedValue(0);
  mocks.create.mockImplementation(async () => ({ id: 'tok-1', createdAt: NOW }));
  mocks.deleteMany.mockResolvedValue({ count: 1 });
  mocks.findFirst.mockResolvedValue({ name: 'iPhone' });
  mocks.sessionUpdateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /api/me/api-tokens', () => {
  it('makes a token, stores only its hash, shows it once and audits it', async () => {
    const response = await post({ name: '  iPhone  ', scopes: ['activity.view', 'calendar.view'], expiresInDays: 30 });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      id: 'tok-1',
      token: expect.stringMatching(/^hlp_[A-Za-z0-9_-]{43}$/),
      name: 'iPhone',
      scopes: ['activity.view', 'calendar.view'],
      expiresAt: new Date(NOW.getTime() + 30 * 86_400_000).toISOString(),
      createdAt: NOW.toISOString(),
    });
    const data = mocks.create.mock.calls[0][0].data;
    expect(data).toEqual({
      userId: 'u1',
      name: 'iPhone',
      scopes: ['activity.view', 'calendar.view'],
      expiresAt: new Date(NOW.getTime() + 30 * 86_400_000),
      tokenHash: hashApiToken(body.token),
    });
    expect(JSON.stringify(data)).not.toContain(body.token);
    expect(mocks.sessionUpdateMany).toHaveBeenCalledWith({
      where: { id: 's1', userId: 'u1', revokedAt: null },
      data: { lastSeenAt: expect.any(Date) },
    });
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.any(NextRequest), expect.objectContaining({
      action: 'API_TOKEN_CREATED', targetType: 'api-token', targetId: 'tok-1', targetLabel: 'iPhone',
      fields: ['activity.view', 'calendar.view'],
    }));
    expect(JSON.stringify(mocks.recordSecurityEvent.mock.calls)).not.toContain(body.token);
  });

  it('allows no expiry', async () => {
    const response = await post({ name: 'Homepage', scopes: ['activity.view'], expiresInDays: null });
    expect(response.status).toBe(200);
    expect((await response.json()).expiresAt).toBeNull();
  });

  it('refuses a scope the owner does not hold', async () => {
    const response = await post({ name: 'x', scopes: ['activity.view', 'jellyfin.sessions'], expiresInDays: null });
    expect(response.status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([
    [{ name: 'x', scopes: [] }],
    [{ name: 'x', scopes: ['torrents.delete'] }],
    [{ name: 'x', scopes: ['activity.manage'] }],
    [{ name: 'x', scopes: ['activity.view', 'activity.view'] }],
    [{ name: 'x', scopes: 'activity.view' }],
    [{ name: '', scopes: ['activity.view'] }],
    [{ name: 'x'.repeat(61), scopes: ['activity.view'] }],
    [{ name: 'a\nb', scopes: ['activity.view'] }],
    [{ name: 'evil\u202Egnp.exe', scopes: ['activity.view'] }],
    [{ name: 'x', scopes: ['activity.view'], expiresInDays: 0 }],
    [{ name: 'x', scopes: ['activity.view'], expiresInDays: 366 }],
    [{ name: 'x', scopes: ['activity.view'], expiresInDays: 1.5 }],
    [{ name: 'x', scopes: ['activity.view'], expiresInDays: '30' }],
  ])('refuses %j', async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('makes nothing once the session has ended (a password change raced it)', async () => {
    mocks.sessionUpdateMany.mockResolvedValue({ count: 0 });
    expect((await post({ name: 'x', scopes: ['activity.view'] })).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();
  });

  it('caps the tokens per person', async () => {
    mocks.count.mockResolvedValue(MAX_API_TOKENS);
    expect((await post({ name: 'x', scopes: ['activity.view'] })).status).toBe(409);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('needs a session', async () => {
    mocks.requireUser.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
    expect((await post({ name: 'x', scopes: ['activity.view'] })).status).toBe(401);
  });
});

describe('GET /api/me/api-tokens', () => {
  it('lists only the owner’s tokens, never a hash, with the scopes they still hold', async () => {
    mocks.findMany.mockResolvedValue([{
      id: 'tok-1', name: 'iPhone', scopes: ['activity.view', 'jellyfin.sessions'], expiresAt: null, createdAt: NOW, lastUsedAt: null,
    }]);
    const body = await (await GET()).json();
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1' } }));
    expect(mocks.findMany.mock.calls[0][0].select).not.toHaveProperty('tokenHash');
    expect(body.tokens).toEqual([{
      id: 'tok-1', name: 'iPhone', scopes: ['activity.view', 'jellyfin.sessions'], activeScopes: ['activity.view'],
      expiresAt: null, createdAt: NOW.toISOString(), lastUsedAt: null,
    }]);
    expect(body.grantableScopes).not.toContain('jellyfin.sessions');
    expect(body.grantableScopes).toContain('activity.view');
  });
});

describe('DELETE /api/me/api-tokens/[id]', () => {
  const del = (id: string) => DELETE(
    new NextRequest(`http://localhost/api/me/api-tokens/${id}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id }) },
  );

  it('turns off one of the owner’s own tokens and audits it', async () => {
    expect((await del('tok-1')).status).toBe(200);
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { id: 'tok-1', userId: 'u1' } });
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.any(NextRequest), expect.objectContaining({
      action: 'API_TOKEN_REVOKED', targetType: 'api-token', targetId: 'tok-1', targetLabel: 'iPhone',
    }));
  });

  it('answers 404 for someone else’s token', async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.deleteMany.mockResolvedValue({ count: 0 });
    expect((await del('tok-other')).status).toBe(404);
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();
  });
});
