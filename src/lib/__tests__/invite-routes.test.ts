import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The public invite routes and the admin routes that make and end links. The
// link rules themselves are covered in password-links.test.ts.

const mocks = vi.hoisted(() => {
  const db = {
    user: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    passwordLink: { upsert: vi.fn(), delete: vi.fn() },
  };
  return {
    db,
    requireAdmin: vi.fn(),
    createSession: vi.fn(),
    hashPassword: vi.fn(),
    describePasswordLink: vi.fn(),
    redeemPasswordLink: vi.fn(),
    recordSecurityEvent: vi.fn(),
    limits: {
      enforceLoginRateLimit: vi.fn(),
      enforceGlobalLoginBackstop: vi.fn(),
      enforceMalformedLoginBackstop: vi.fn(),
      recordMalformedLoginRequest: vi.fn(),
      recordGlobalLoginFailure: vi.fn(),
      clearUsernameBackoff: vi.fn(),
    },
  };
});

vi.mock('@/lib/db', () => ({
  prisma: { ...mocks.db, $transaction: (fn: (tx: typeof mocks.db) => unknown) => fn(mocks.db) },
}));
vi.mock('@/lib/auth', () => ({
  COOKIE_NAME: 'helprr-session',
  SESSION_DURATION: 60,
  requireAdmin: mocks.requireAdmin,
  createSession: mocks.createSession,
}));
vi.mock('@/lib/password', () => ({ hashPassword: mocks.hashPassword }));
vi.mock('@/lib/password-links', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/password-links')>()),
  describePasswordLink: mocks.describePasswordLink,
  redeemPasswordLink: mocks.redeemPasswordLink,
}));
vi.mock('@/lib/security-audit', () => ({ recordSecurityEvent: mocks.recordSecurityEvent }));
vi.mock('@/lib/login-rate-limit', () => ({ getClientIp: () => '203.0.113.7', ...mocks.limits }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/request-utils', () => ({ isHttpsRequest: () => false }));

import { POST as acceptInvite } from '@/app/api/invite/accept/route';
import { POST as inviteState } from '@/app/api/invite/state/route';
import { POST as createUser } from '@/app/api/users/route';
import { POST as issueLink, DELETE as revokeLink } from '@/app/api/users/[id]/password-link/route';
import { INVALID_LINK_MESSAGE } from '@/lib/server/invite-request';

const TOKEN = 'A'.repeat(43);
const PASSWORD = 'a long enough passphrase';
const ADMIN = { id: 'admin-1', username: 'admin', role: 'admin' };

function post(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  for (const gate of Object.values(mocks.limits)) gate.mockResolvedValue(null);
  mocks.requireAdmin.mockResolvedValue({ ok: true, user: ADMIN, session: { id: 'admin-session' } });
  mocks.createSession.mockResolvedValue('session-token');
  mocks.hashPassword.mockResolvedValue('new-hash');
  mocks.db.passwordLink.upsert.mockResolvedValue({});
});

describe('POST /api/invite/accept', () => {
  it('sets the password, signs the person in and records the use', async () => {
    mocks.redeemPasswordLink.mockResolvedValue({ id: 'u1', username: 'newbie', role: 'member', purpose: 'invite', revokedSessions: 0 });

    const response = await acceptInvite(post('/api/invite/accept', { token: TOKEN, password: PASSWORD }));

    expect(response.status).toBe(200);
    expect(mocks.redeemPasswordLink).toHaveBeenCalledWith(TOKEN, 'new-hash');
    expect(response.cookies.get('helprr-session')?.value).toBe('session-token');
    expect(mocks.createSession).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', role: 'member' }));
    expect(mocks.limits.clearUsernameBackoff).toHaveBeenCalledWith('newbie');
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'INVITE_ACCEPTED', actor: { id: 'u1', username: 'newbie' }, targetId: 'u1',
    }));
  });

  it('records a reset with the sessions it signed out', async () => {
    mocks.redeemPasswordLink.mockResolvedValue({ id: 'u1', username: 'member', role: 'member', purpose: 'reset', revokedSessions: 3 });
    await acceptInvite(post('/api/invite/accept', { token: TOKEN, password: PASSWORD }));
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'RESET_LINK_USED', count: 3,
    }));
  });

  it('answers an unusable link and a malformed one the same way, and counts both as failures', async () => {
    mocks.redeemPasswordLink.mockResolvedValue(null);
    const unknown = await acceptInvite(post('/api/invite/accept', { token: TOKEN, password: PASSWORD }));
    const malformed = await acceptInvite(post('/api/invite/accept', { token: 'nope', password: PASSWORD }));

    for (const response of [unknown, malformed]) {
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: INVALID_LINK_MESSAGE });
      expect(response.cookies.get('helprr-session')).toBeUndefined();
    }
    expect(mocks.limits.recordGlobalLoginFailure).toHaveBeenCalledTimes(2);
    // The malformed token is refused before any scrypt work.
    expect(mocks.hashPassword).toHaveBeenCalledTimes(1);
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();
  });

  it('holds the new password to the 15-character policy', async () => {
    const response = await acceptInvite(post('/api/invite/accept', { token: TOKEN, password: 'too short' }));
    expect(response.status).toBe(400);
    expect(mocks.redeemPasswordLink).not.toHaveBeenCalled();
  });

  it.each([
    ['per-IP bucket', 'enforceLoginRateLimit'],
    ['global failed-attempt backstop', 'enforceGlobalLoginBackstop'],
    ['malformed-request backstop', 'enforceMalformedLoginBackstop'],
  ] as const)('is throttled by the sign-in %s before the link is looked at', async (_name, gate) => {
    mocks.limits[gate].mockResolvedValue(NextResponse.json({ error: 'Too many' }, { status: 429 }));
    const response = await acceptInvite(post('/api/invite/accept', { token: TOKEN, password: PASSWORD }));
    expect(response.status).toBe(429);
    expect(mocks.hashPassword).not.toHaveBeenCalled();
    expect(mocks.redeemPasswordLink).not.toHaveBeenCalled();
  });

  it('takes JSON only, and counts other bodies as malformed', async () => {
    const response = await acceptInvite(new NextRequest('http://localhost/api/invite/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `token=${TOKEN}&password=x`,
    }));
    expect(response.status).toBe(415);
    expect(mocks.limits.recordMalformedLoginRequest).toHaveBeenCalledTimes(1);
    expect(mocks.redeemPasswordLink).not.toHaveBeenCalled();
  });
});

describe('POST /api/invite/state', () => {
  it('says who a usable link is for', async () => {
    mocks.describePasswordLink.mockResolvedValue({ purpose: 'invite', username: 'newbie', displayName: 'New' });
    const response = await inviteState(post('/api/invite/state', { token: TOKEN }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ purpose: 'invite', username: 'newbie', displayName: 'New' });
  });

  it('gives the generic answer for any other link and counts it as a failure', async () => {
    mocks.describePasswordLink.mockResolvedValue(null);
    const response = await inviteState(post('/api/invite/state', { token: TOKEN }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: INVALID_LINK_MESSAGE });
    expect(mocks.limits.recordGlobalLoginFailure).toHaveBeenCalledTimes(1);
  });
});

describe('admin link routes', () => {
  it('refuse members', async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });

    expect((await createUser(post('/api/users', { username: 'x', displayName: 'X', invite: true }))).status).toBe(403);
    expect((await issueLink(post('/api/users/u1/password-link', {}), params('u1'))).status).toBe(403);
    expect((await revokeLink(new NextRequest('http://localhost/api/users/u1/password-link', { method: 'DELETE' }), params('u1'))).status).toBe(403);
    expect(mocks.db.user.create).not.toHaveBeenCalled();
    expect(mocks.db.passwordLink.upsert).not.toHaveBeenCalled();
    expect(mocks.db.passwordLink.delete).not.toHaveBeenCalled();
  });

  it('create an invited user as pending, with no password, and return the link once', async () => {
    mocks.db.user.create.mockImplementation(async ({ data }) => ({
      id: 'u1', permissions: {}, jellyfinToken: null, createdAt: new Date(), updatedAt: new Date(), ...data,
    }));

    const response = await createUser(post('/api/users', { username: 'newbie', displayName: 'New', invite: true }));

    expect(response.status).toBe(201);
    expect(mocks.db.user.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'pending', passwordHash: null }) });
    const body = await response.json();
    expect(body.linkToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.passwordLink.purpose).toBe('invite');
    expect(mocks.db.passwordLink.upsert.mock.calls[0][0].create.tokenHash).not.toBe(body.linkToken);
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'INVITE_CREATED' }));
  });

  it('refuse an invite that also sets a password', async () => {
    const response = await createUser(post('/api/users', { username: 'newbie', displayName: 'New', invite: true, password: PASSWORD }));
    expect(response.status).toBe(400);
    expect(mocks.db.user.create).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 'pending', passwordHash: null, passwordLink: null }, 'invite', 'INVITE_CREATED'],
    [{ status: 'pending', passwordHash: null, passwordLink: { purpose: 'invite' } }, 'invite', 'INVITE_REGENERATED'],
    [{ status: 'active', passwordHash: 'h', passwordLink: null }, 'reset', 'RESET_LINK_CREATED'],
  ])('issue the right link for %o', async (user, purpose, action) => {
    mocks.db.user.findUnique.mockResolvedValue({ id: 'u1', username: 'member', ...user });
    const response = await issueLink(post('/api/users/u1/password-link', {}), params('u1'));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ purpose });
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action, targetId: 'u1' }));
  });

  it.each([
    [{ status: 'disabled', passwordHash: 'h' }],
    [{ status: 'active', passwordHash: null }],
  ])('refuse a link for %o', async (user) => {
    mocks.db.user.findUnique.mockResolvedValue({ id: 'u1', username: 'member', passwordLink: null, ...user });
    expect((await issueLink(post('/api/users/u1/password-link', {}), params('u1'))).status).toBe(409);
    expect(mocks.db.passwordLink.upsert).not.toHaveBeenCalled();
  });

  it('revoke a link and record which kind it was', async () => {
    mocks.db.user.findUnique.mockResolvedValue({ id: 'u1', username: 'member' });
    mocks.db.passwordLink.delete.mockResolvedValue({ purpose: 'reset' });
    const del = () => revokeLink(new NextRequest('http://localhost/api/users/u1/password-link', { method: 'DELETE' }), params('u1'));

    await expect((await del()).json()).resolves.toEqual({ revoked: true });
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'RESET_LINK_REVOKED' }));

    mocks.recordSecurityEvent.mockClear();
    mocks.db.passwordLink.delete.mockRejectedValue(Object.assign(new Error('none'), { code: 'P2025' }));
    await expect((await del()).json()).resolves.toEqual({ revoked: false });
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();
  });
});
