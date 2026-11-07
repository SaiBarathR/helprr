import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  userFindUnique: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  deleteMany: vi.fn(),
  recordSecurityEvent: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/security-audit', () => ({ recordSecurityEvent: mocks.recordSecurityEvent, coarseIp: () => null }));
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    apiToken: { findMany: mocks.findMany, findFirst: mocks.findFirst, deleteMany: mocks.deleteMany },
  },
}));

import { GET } from './route';
import { DELETE } from './[tokenId]/route';

const ADMIN = { id: 'admin-1', username: 'boss', role: 'admin', template: 'admin', permissions: {}, status: 'active' };
const CREATED = new Date('2026-11-01T00:00:00Z');
const forbidden = () => ({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });

const list = (id: string) => GET(
  new NextRequest(`http://localhost/api/users/${id}/api-tokens`),
  { params: Promise.resolve({ id }) },
);
const del = (id: string, tokenId: string) => DELETE(
  new NextRequest(`http://localhost/api/users/${id}/api-tokens/${tokenId}`, { method: 'DELETE' }),
  { params: Promise.resolve({ id, tokenId }) },
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ ok: true, user: ADMIN });
  mocks.userFindUnique.mockResolvedValue({ role: 'member', template: 'member', permissions: { 'api.tokens': true, 'calendar.view': false } });
  mocks.findMany.mockResolvedValue([{
    id: 'tok-1', name: 'Homepage', scopes: ['activity.view', 'calendar.view'], expiresAt: null, createdAt: CREATED, lastUsedAt: null,
  }]);
  mocks.findFirst.mockResolvedValue({ name: 'Homepage', user: { username: 'iso' } });
  mocks.deleteMany.mockResolvedValue({ count: 1 });
});

describe('GET /api/users/[id]/api-tokens', () => {
  it("lists the user's tokens, never a hash, with the scopes still used and whether tokens are allowed", async () => {
    const response = await list('u2');
    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u2' } }));
    expect(mocks.findMany.mock.calls[0][0].select).not.toHaveProperty('tokenHash');
    expect(await response.json()).toEqual({
      tokens: [{
        id: 'tok-1', name: 'Homepage', scopes: ['activity.view', 'calendar.view'], activeScopes: ['activity.view'],
        expiresAt: null, createdAt: CREATED.toISOString(), lastUsedAt: null,
      }],
      allowed: true,
    });
  });

  it('says a member without api.tokens is not allowed (the member default)', async () => {
    mocks.userFindUnique.mockResolvedValue({ role: 'member', template: 'member', permissions: {} });
    expect((await (await list('u2')).json()).allowed).toBe(false);
  });

  it('is admin-only', async () => {
    mocks.requireAdmin.mockResolvedValue(forbidden());
    expect((await list('u2')).status).toBe(403);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown user', async () => {
    mocks.userFindUnique.mockResolvedValue(null);
    expect((await list('nobody')).status).toBe(404);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/users/[id]/api-tokens/[tokenId]', () => {
  it("turns off the user's token and audits it naming the admin, the owner and the token", async () => {
    const response = await del('u2', 'tok-1');
    expect(response.status).toBe(200);
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'tok-1', userId: 'u2' } }));
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { id: 'tok-1', userId: 'u2' } });
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.any(NextRequest), {
      actor: ADMIN,
      action: 'API_TOKEN_REVOKED',
      targetType: 'user',
      targetId: 'u2',
      targetLabel: 'iso',
      fields: ['admin', 'Homepage'],
    });
  });

  it("answers 404 for a token of another user, and deletes nothing", async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect((await del('u2', 'tok-of-someone-else')).status).toBe(404);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();
  });

  it('records nothing when another admin turned it off first', async () => {
    mocks.deleteMany.mockResolvedValue({ count: 0 });
    expect((await del('u2', 'tok-1')).status).toBe(404);
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();
  });

  it('is admin-only', async () => {
    mocks.requireAdmin.mockResolvedValue(forbidden());
    expect((await del('u2', 'tok-1')).status).toBe(403);
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});
