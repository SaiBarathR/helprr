import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  requireUser: vi.fn(),
  verifyUserPassword: vi.fn(),
  hashPassword: vi.fn(),
  sessionUpdateMany: vi.fn(),
  userUpdateMany: vi.fn(),
  passwordLinkDeleteMany: vi.fn(),
  enforceLoginRateLimit: vi.fn(),
  enforceUsernameBackoff: vi.fn(),
  enforceGlobalLoginBackstop: vi.fn(),
  recordUsernameFailure: vi.fn(),
  recordGlobalLoginFailure: vi.fn(),
  clearUsernameBackoff: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireUser: mocks.requireUser,
  verifyUserPassword: mocks.verifyUserPassword,
}));
vi.mock('@/lib/password', () => ({ hashPassword: mocks.hashPassword }));
vi.mock('@/lib/db', () => {
  const tx = {
    session: { updateMany: (args: unknown) => (mocks.order.push('session'), mocks.sessionUpdateMany(args)) },
    user: { updateMany: (args: unknown) => (mocks.order.push('user'), mocks.userUpdateMany(args)) },
    passwordLink: { deleteMany: (args: unknown) => (mocks.order.push('link'), mocks.passwordLinkDeleteMany(args)) },
  };
  return { prisma: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } };
});
vi.mock('@/lib/login-rate-limit', () => ({
  getClientIp: () => '10.0.0.5',
  enforceLoginRateLimit: mocks.enforceLoginRateLimit,
  enforceUsernameBackoff: mocks.enforceUsernameBackoff,
  enforceGlobalLoginBackstop: mocks.enforceGlobalLoginBackstop,
  recordUsernameFailure: mocks.recordUsernameFailure,
  recordGlobalLoginFailure: mocks.recordGlobalLoginFailure,
  clearUsernameBackoff: mocks.clearUsernameBackoff,
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));

import { POST } from './route';

// Plain words rather than anything shaped like a real credential.
const CURRENT = 'the words typed at sign in';
const NEXT = 'a different long passphrase';

function post(body: unknown, contentType = 'application/json') {
  return POST(new NextRequest('http://localhost/api/me/password', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
}

function signedIn(passwordHash: string | null = 'stored-hash') {
  return {
    ok: true,
    user: { id: 'user-1', username: 'member', role: 'member', status: 'active', passwordHash },
    session: { id: 'session-current' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order.length = 0;
  mocks.requireUser.mockResolvedValue(signedIn());
  mocks.verifyUserPassword.mockImplementation(async (_u: unknown, plain: string) => plain === CURRENT);
  mocks.hashPassword.mockResolvedValue('new-hash');
  mocks.sessionUpdateMany.mockResolvedValue({ count: 1 });
  mocks.userUpdateMany.mockResolvedValue({ count: 1 });
  mocks.passwordLinkDeleteMany.mockResolvedValue({ count: 0 });
  for (const gate of [mocks.enforceLoginRateLimit, mocks.enforceUsernameBackoff, mocks.enforceGlobalLoginBackstop]) {
    gate.mockResolvedValue(null);
  }
});

describe('POST /api/me/password', () => {
  it('refuses a request without a valid session', async () => {
    mocks.requireUser.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    expect((await post({ currentPassword: CURRENT, newPassword: NEXT })).status).toBe(401);
    expect(mocks.verifyUserPassword).not.toHaveBeenCalled();
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
  });

  it('changes the password, revokes the other sessions and keeps this one', async () => {
    mocks.sessionUpdateMany
      .mockResolvedValueOnce({ count: 1 }) // this session is still live
      .mockResolvedValueOnce({ count: 2 }); // the other sessions
    const res = await post({ currentPassword: CURRENT, newPassword: NEXT });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revokedSessions: 2 });
    expect(mocks.hashPassword).toHaveBeenCalledWith(NEXT);
    expect(mocks.userUpdateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', status: 'active', passwordHash: 'stored-hash' },
      data: { passwordHash: 'new-hash' },
    });
    const [lockCall, revokeCall] = mocks.sessionUpdateMany.mock.calls.map(([args]) => args);
    expect(lockCall.where).toEqual({ id: 'session-current', userId: 'user-1', revokedAt: null });
    expect(lockCall.data).not.toHaveProperty('revokedAt');
    expect(revokeCall.where).toEqual({ userId: 'user-1', revokedAt: null, NOT: { id: 'session-current' } });
    expect(revokeCall.data.revokedAt).toBeInstanceOf(Date);
    // The cookie is neither cleared nor replaced: this session stays as it was.
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(mocks.clearUsernameBackoff).toHaveBeenCalledWith('member');
    // User row before sessions, like Settings -> Users, so concurrent writes can't deadlock.
    expect(mocks.order).toEqual(['user', 'session', 'session', 'link']);
    // An outstanding reset link can no longer override the new password.
    expect(mocks.passwordLinkDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(mocks.enforceLoginRateLimit).toHaveBeenCalledWith('10.0.0.5');
  });

  it('refuses a wrong current password with 403 and counts it like a failed sign-in', async () => {
    const res = await post({ currentPassword: 'not the right words', newPassword: NEXT });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Current password is incorrect' });
    expect(mocks.recordUsernameFailure).toHaveBeenCalledWith('member', 'not the right words');
    expect(mocks.recordGlobalLoginFailure).toHaveBeenCalledTimes(1);
    expect(mocks.clearUsernameBackoff).not.toHaveBeenCalled();
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
    expect(mocks.sessionUpdateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['the IP bucket', mocks.enforceLoginRateLimit],
    ['the username backoff', mocks.enforceUsernameBackoff],
    ['the global backstop', mocks.enforceGlobalLoginBackstop],
  ])('stops at %s before checking the password', async (_label, gate) => {
    gate.mockResolvedValue(NextResponse.json({ error: 'Too many login attempts.' }, { status: 429 }));
    expect((await post({ currentPassword: CURRENT, newPassword: NEXT })).status).toBe(429);
    expect(mocks.verifyUserPassword).not.toHaveBeenCalled();
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
  });

  it('keys the username backoff on the signed-in user, not the request', async () => {
    await post({ currentPassword: CURRENT, newPassword: NEXT, username: 'someone-else' });
    expect(mocks.enforceUsernameBackoff).toHaveBeenCalledWith('member');
  });

  it.each([
    ['a short new password', { currentPassword: CURRENT, newPassword: 'too short' }, /at least 15/],
    ['no new password', { currentPassword: CURRENT }, /New password is required/],
    ['no current password', { newPassword: NEXT }, /Current password is required/],
  ])('rejects %s with 400 without spending an attempt', async (_label, body, message) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(message);
    expect(mocks.enforceUsernameBackoff).not.toHaveBeenCalled();
    expect(mocks.verifyUserPassword).not.toHaveBeenCalled();
  });

  it('refuses a form post (not JSON)', async () => {
    const res = await post('currentPassword=x&newPassword=y', 'application/x-www-form-urlencoded');
    expect(res.status).toBe(415);
  });

  it('refuses a Jellyfin-only account, which has no Helprr password', async () => {
    mocks.requireUser.mockResolvedValue(signedIn(null));
    const res = await post({ currentPassword: CURRENT, newPassword: NEXT });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Jellyfin/);
    expect(mocks.verifyUserPassword).not.toHaveBeenCalled();
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
  });

  it('rolls back when this session was revoked during the request', async () => {
    mocks.sessionUpdateMany.mockResolvedValueOnce({ count: 0 });
    expect((await post({ currentPassword: CURRENT, newPassword: NEXT })).status).toBe(401);
    // The error is thrown inside the transaction callback, so Postgres rolls the hash write back.
    // The mocked transaction cannot prove the rollback itself; this checks the 401 and that no
    // other session is revoked.
    expect(mocks.sessionUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('answers 409 when Postgres ends the transaction as a deadlock or write conflict', async () => {
    mocks.sessionUpdateMany.mockRejectedValueOnce(Object.assign(new Error('Transaction failed'), { code: 'P2034' }));
    const res = await post({ currentPassword: CURRENT, newPassword: NEXT });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/try again/);
  });

  it('writes and revokes nothing when the account changed meanwhile', async () => {
    mocks.userUpdateMany.mockResolvedValue({ count: 0 });
    expect((await post({ currentPassword: CURRENT, newPassword: NEXT })).status).toBe(409);
    expect(mocks.sessionUpdateMany).not.toHaveBeenCalled();
  });

  it('never logs a password or hash when the write fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.userUpdateMany.mockRejectedValue(Object.assign(new Error(`bad arg new-hash ${NEXT}`), { code: 'P2000' }));
    const res = await post({ currentPassword: CURRENT, newPassword: NEXT });
    expect(res.status).toBe(500);
    const logged = consoleError.mock.calls.flat().join(' ');
    expect(logged).toContain('P2000');
    expect(logged).not.toContain(NEXT);
    expect(logged).not.toContain('new-hash');
    consoleError.mockRestore();
  });
});
