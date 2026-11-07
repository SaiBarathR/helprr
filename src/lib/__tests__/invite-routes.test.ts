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
    recordFailedLinkAttempt: vi.fn(),
    limits: {
      enforceInviteRateLimit: vi.fn(),
      enforceInviteFailureBackstop: vi.fn(),
      recordInviteFailure: vi.fn(),
    },
    // The sign-in throttles: the invite routes must leave them alone.
    login: {
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
vi.mock('@/lib/security-audit', () => ({
  recordSecurityEvent: mocks.recordSecurityEvent,
  recordFailedLinkAttempt: mocks.recordFailedLinkAttempt,
}));
vi.mock('@/lib/invite-rate-limit', () => mocks.limits);
vi.mock('@/lib/login-rate-limit', () => ({ getClientIp: () => '203.0.113.7', ...mocks.login }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/request-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/request-utils')>()),
  isHttpsRequest: () => false,
}));

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
  for (const gate of [...Object.values(mocks.limits), ...Object.values(mocks.login)]) gate.mockResolvedValue(null);
  mocks.requireAdmin.mockResolvedValue({ ok: true, user: ADMIN, session: { id: 'admin-session' } });
  mocks.createSession.mockResolvedValue('session-token');
  mocks.hashPassword.mockResolvedValue('new-hash');
  mocks.db.passwordLink.upsert.mockResolvedValue({});
});

describe('POST /api/invite/accept', () => {
  it('sets the password, signs the person in and records the use', async () => {
    mocks.redeemPasswordLink.mockResolvedValue({ id: 'u1', username: 'newbie', role: 'member', purpose: 'invite', revokedSessions: 0, mfaEnabled: false });

    const response = await acceptInvite(post('/api/invite/accept', { token: TOKEN, password: PASSWORD }));

    expect(response.status).toBe(200);
    expect(mocks.redeemPasswordLink).toHaveBeenCalledWith(TOKEN, 'new-hash');
    expect(response.cookies.get('helprr-session')?.value).toBe('session-token');
    expect(mocks.createSession).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', role: 'member' }));
    expect(mocks.login.clearUsernameBackoff).toHaveBeenCalledWith('newbie');
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'INVITE_ACCEPTED', actor: { id: 'u1', username: 'newbie' }, targetId: 'u1',
    }));
  });

  it('a reset for an account with two-step sign-in sets the password but makes no session', async () => {
    mocks.redeemPasswordLink.mockResolvedValue({ id: 'u1', username: 'member', role: 'member', purpose: 'reset', revokedSessions: 2, mfaEnabled: true });

    const response = await acceptInvite(post('/api/invite/accept', { token: TOKEN, password: PASSWORD }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, signInWithCode: true });
    expect(response.cookies.get('helprr-session')).toBeUndefined();
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'RESET_LINK_USED' }));
  });

  it('records a reset with the sessions it signed out', async () => {
    mocks.redeemPasswordLink.mockResolvedValue({ id: 'u1', username: 'member', role: 'member', purpose: 'reset', revokedSessions: 3, mfaEnabled: false });
    await acceptInvite(post('/api/invite/accept', { token: TOKEN, password: PASSWORD }));
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'RESET_LINK_USED', count: 3,
    }));
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'CALENDAR_FEED_REVOKED' }));
  });

  it('records the calendar feed link a reset ended', async () => {
    mocks.redeemPasswordLink.mockResolvedValue({ id: 'u1', username: 'member', role: 'member', purpose: 'reset', revokedSessions: 0, feedRevoked: true, mfaEnabled: false });
    await acceptInvite(post('/api/invite/accept', { token: TOKEN, password: PASSWORD }));
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'CALENDAR_FEED_REVOKED', targetId: 'u1', fields: ['password'],
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
    expect(mocks.limits.recordInviteFailure).toHaveBeenCalledTimes(2);
    // Audited without the token, and the sign-in budget is untouched.
    expect(mocks.recordFailedLinkAttempt).toHaveBeenCalledTimes(2);
    for (const [, ...rest] of mocks.recordFailedLinkAttempt.mock.calls) expect(rest).toEqual([]);
    for (const login of Object.values(mocks.login)) expect(login).not.toHaveBeenCalled();
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
    ['per-IP bucket', 'enforceInviteRateLimit'],
    ['failed-attempt backstop', 'enforceInviteFailureBackstop'],
  ] as const)('is throttled by the invite %s before the link is looked at', async (_name, gate) => {
    mocks.limits[gate].mockResolvedValue(NextResponse.json({ error: 'Too many' }, { status: 429 }));
    const response = await acceptInvite(post('/api/invite/accept', { token: TOKEN, password: PASSWORD }));
    expect(response.status).toBe(429);
    expect(mocks.hashPassword).not.toHaveBeenCalled();
    expect(mocks.redeemPasswordLink).not.toHaveBeenCalled();
  });

  it('takes JSON only, and counts other bodies as failed attempts', async () => {
    const response = await acceptInvite(new NextRequest('http://localhost/api/invite/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `token=${TOKEN}&password=x`,
    }));
    expect(response.status).toBe(415);
    expect(mocks.limits.enforceInviteRateLimit).toHaveBeenCalledWith('203.0.113.7');
    expect(mocks.limits.recordInviteFailure).toHaveBeenCalledTimes(1);
    expect(mocks.login.recordMalformedLoginRequest).not.toHaveBeenCalled();
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
    expect(mocks.limits.recordInviteFailure).toHaveBeenCalledTimes(1);
    expect(mocks.recordFailedLinkAttempt).toHaveBeenCalledTimes(1);
    expect(mocks.login.recordGlobalLoginFailure).not.toHaveBeenCalled();
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

  it('send the configured APP_ORIGIN with a new link, and null when it is unset', async () => {
    mocks.db.user.create.mockImplementation(async ({ data }) => ({
      id: 'u1', permissions: {}, jellyfinToken: null, createdAt: new Date(), updatedAt: new Date(), ...data,
    }));
    mocks.db.user.findUnique.mockResolvedValue({ id: 'u1', username: 'member', status: 'active', passwordHash: 'h', passwordLink: null });
    try {
      vi.stubEnv('APP_ORIGIN', 'https://helprr.example.com');
      const created = await (await createUser(post('/api/users', { username: 'newbie', displayName: 'New', invite: true }))).json();
      expect(created.linkOrigin).toBe('https://helprr.example.com');
      const issued = await (await issueLink(post('/api/users/u1/password-link', {}), params('u1'))).json();
      expect(issued.origin).toBe('https://helprr.example.com');

      vi.stubEnv('APP_ORIGIN', '');
      expect((await (await issueLink(post('/api/users/u1/password-link', {}), params('u1'))).json()).origin).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('make no link, and no invited user, when APP_ORIGIN is set but invalid', async () => {
    mocks.db.user.findUnique.mockResolvedValue({ id: 'u1', username: 'member', status: 'active', passwordHash: 'h', passwordLink: null });
    try {
      for (const value of ['not a url', 'https://helprr.example.com/path']) {
        vi.stubEnv('APP_ORIGIN', value);
        const issued = await issueLink(post('/api/users/u1/password-link', {}), params('u1'));
        expect(issued.status).toBe(500);
        expect((await issued.json()).error).toMatch(/APP_ORIGIN/);
        expect((await createUser(post('/api/users', { username: 'newbie', displayName: 'New', invite: true }))).status).toBe(500);
      }
      expect(mocks.db.passwordLink.upsert).not.toHaveBeenCalled();
      expect(mocks.db.user.create).not.toHaveBeenCalled();
      expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
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

  it('make a link only from a JSON request, so a same-site form cannot replace one', async () => {
    mocks.db.user.findUnique.mockResolvedValue({ id: 'u1', username: 'member', status: 'active', passwordHash: 'h', passwordLink: null });
    const form = new NextRequest('http://localhost/api/users/u1/password-link', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'x=1',
    });
    // A byte body gets no default Content-Type.
    const bare = new NextRequest('http://localhost/api/users/u1/password-link', { method: 'POST', body: new Uint8Array([123, 125]) });
    expect(bare.headers.get('content-type')).toBeNull();
    for (const request of [form, bare]) expect((await issueLink(request, params('u1'))).status).toBe(415);
    expect(mocks.db.user.findUnique).not.toHaveBeenCalled();
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
