import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  verifyUserPassword: vi.fn(),
  order: [] as string[],
  userUpdateMany: vi.fn(),
  executeRaw: vi.fn(),
  logging: [] as unknown[],
  userCount: vi.fn(),
  userDelete: vi.fn(),
  enforceLoginRateLimit: vi.fn(),
  enforceUsernameBackoff: vi.fn(),
  enforceGlobalLoginBackstop: vi.fn(),
  recordUsernameFailure: vi.fn(),
  recordGlobalLoginFailure: vi.fn(),
  clearUsernameBackoff: vi.fn(),
  recordSecurityEvent: vi.fn(),
  recordFailedSignIn: vi.fn(),
  inTransaction: false,
}));

vi.mock('@/lib/auth', () => ({
  COOKIE_NAME: 'helprr-session',
  requireUser: mocks.requireUser,
  verifyUserPassword: mocks.verifyUserPassword,
}));
vi.mock('@/lib/db', () => {
  const inTx = <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A) => {
    if (!mocks.inTransaction) throw new Error('user write outside the transaction');
    return fn(...args);
  };
  const tx = {
    $executeRaw: inTx((...args: unknown[]) => (mocks.order.push('guard-lock'), mocks.executeRaw(...args))),
    user: {
      updateMany: inTx((args: unknown) => (mocks.order.push('user-lock'), mocks.userUpdateMany(args))),
      count: inTx(mocks.userCount),
      delete: inTx((args: unknown) => (mocks.order.push('delete'), mocks.userDelete(args))),
    },
  };
  return {
    prisma: {
      $transaction: async (fn: (t: typeof tx) => unknown) => {
        mocks.inTransaction = true;
        try {
          return await fn(tx);
        } finally {
          mocks.inTransaction = false;
        }
      },
    },
  };
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
vi.mock('@/lib/security-audit', () => ({
  recordSecurityEvent: mocks.recordSecurityEvent,
  recordFailedSignIn: mocks.recordFailedSignIn,
}));
vi.mock('@/lib/request-utils', () => ({ isHttpsRequest: () => false }));
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (fn: unknown, name: string, options?: unknown) => (mocks.logging.push([name, options]), fn),
}));

import { DELETE } from './route';

// Plain words rather than anything shaped like a real credential.
const PASSWORD = 'the words typed at sign in';

function del(body: unknown, contentType = 'application/json') {
  return DELETE(new NextRequest('http://localhost/api/me', {
    method: 'DELETE',
    headers: { 'content-type': contentType },
    body: JSON.stringify(body),
  }));
}

function account(overrides: Record<string, unknown> = {}) {
  return { id: 'user-1', username: 'member', role: 'member', status: 'active', passwordHash: 'stored-hash', ...overrides };
}

function signedIn(overrides: Record<string, unknown> = {}) {
  return { ok: true, user: account(overrides), session: { id: 'session-current' } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order.length = 0;
  mocks.requireUser.mockResolvedValue(signedIn());
  mocks.verifyUserPassword.mockImplementation(async (_u: unknown, plain: string) => plain === PASSWORD);
  mocks.userUpdateMany.mockResolvedValue({ count: 1 });
  mocks.executeRaw.mockResolvedValue(1);
  mocks.userCount.mockResolvedValue(1);
  mocks.userDelete.mockResolvedValue({});
  for (const gate of [mocks.enforceLoginRateLimit, mocks.enforceUsernameBackoff, mocks.enforceGlobalLoginBackstop]) {
    gate.mockResolvedValue(null);
  }
});

describe('DELETE /api/me', () => {
  it('refuses a request without a valid session', async () => {
    mocks.requireUser.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    expect((await del({ currentPassword: PASSWORD })).status).toBe(401);
    expect(mocks.verifyUserPassword).not.toHaveBeenCalled();
    expect(mocks.userDelete).not.toHaveBeenCalled();
  });

  it('deletes the signed-in user, audits it and clears the cookie', async () => {
    const res = await del({ currentPassword: PASSWORD });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // Locks the row only if it is the account just confirmed, from a session that is still live.
    expect(mocks.userUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'user-1',
        status: 'active',
        role: 'member',
        passwordHash: 'stored-hash',
        sessions: { some: { id: 'session-current', revokedAt: null } },
      },
      data: { updatedAt: expect.any(Date) },
    });
    // A member takes no admin guard lock.
    expect(mocks.order).toEqual(['user-lock', 'delete']);
    // The same delete Settings -> Users makes; the schema cascades the rest.
    expect(mocks.userDelete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), {
      actor: expect.objectContaining({ id: 'user-1', username: 'member' }),
      action: 'USER_DELETED',
      targetType: 'user',
      targetId: 'user-1',
      targetLabel: 'member',
    });
    expect(res.headers.get('set-cookie')).toMatch(/helprr-session=;.*Max-Age=0/i);
    expect(mocks.clearUsernameBackoff).toHaveBeenCalledWith('member');
    expect(mocks.enforceLoginRateLimit).toHaveBeenCalledWith('10.0.0.5');
  });

  it('ignores an id in the body and acts only on the session user', async () => {
    const res = await del({ currentPassword: PASSWORD, id: 'user-2', userId: 'user-2' });
    expect(res.status).toBe(200);
    expect(mocks.userDelete).toHaveBeenCalledTimes(1);
    expect(mocks.userDelete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    expect(mocks.userUpdateMany.mock.calls[0][0].where.id).toBe('user-1');
  });

  it('refuses a wrong password with 403 and counts it like a failed sign-in', async () => {
    const res = await del({ currentPassword: 'not the right words' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Current password is incorrect' });
    expect(mocks.recordUsernameFailure).toHaveBeenCalledWith('member', 'not the right words');
    expect(mocks.recordGlobalLoginFailure).toHaveBeenCalledTimes(1);
    expect(mocks.recordFailedSignIn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      username: 'member', method: 'password',
    }));
    expect(mocks.userDelete).not.toHaveBeenCalled();
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('requires the password and does not accept a typed username instead', async () => {
    const res = await del({ confirmUsername: 'member' });
    expect(res.status).toBe(400);
    expect(mocks.userDelete).not.toHaveBeenCalled();
  });

  it('answers a throttled attempt without checking the password', async () => {
    mocks.enforceUsernameBackoff.mockResolvedValue(NextResponse.json({ error: 'Too many attempts' }, { status: 429 }));
    const res = await del({ currentPassword: PASSWORD });
    expect(res.status).toBe(429);
    expect(mocks.verifyUserPassword).not.toHaveBeenCalled();
    expect(mocks.userDelete).not.toHaveBeenCalled();
  });

  it('refuses the last active admin', async () => {
    mocks.requireUser.mockResolvedValue(signedIn({ role: 'admin' }));
    mocks.userCount.mockResolvedValue(0);
    const res = await del({ currentPassword: PASSWORD });
    expect(res.status).toBe(409);
    expect(mocks.userCount).toHaveBeenCalledWith({ where: { role: 'admin', status: 'active', NOT: { id: 'user-1' } } });
    // The guard lock before the row lock, the order Settings -> Users takes them.
    expect(mocks.order).toEqual(['guard-lock', 'user-lock', 'guard-lock']);
    expect(mocks.userDelete).not.toHaveBeenCalled();
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('lets an admin go while another active admin remains', async () => {
    mocks.requireUser.mockResolvedValue(signedIn({ role: 'admin' }));
    mocks.userCount.mockResolvedValue(1);
    expect((await del({ currentPassword: PASSWORD })).status).toBe(200);
    expect(mocks.userDelete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
  });

  it('deletes nothing when the account or session changed after the check', async () => {
    mocks.userUpdateMany.mockResolvedValue({ count: 0 });
    const res = await del({ currentPassword: PASSWORD });
    expect(res.status).toBe(409);
    expect(mocks.userDelete).not.toHaveBeenCalled();
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();
  });

  it('keeps the password out of the API log', () => {
    expect(mocks.logging).toContainEqual(['api/me', { logBodies: false }]);
  });

  it('needs JSON', async () => {
    const res = await del({ currentPassword: PASSWORD }, 'text/plain');
    expect(res.status).toBe(415);
    expect(mocks.userDelete).not.toHaveBeenCalled();
  });

  describe('a Jellyfin-only account (no Helprr password)', () => {
    beforeEach(() => {
      mocks.requireUser.mockResolvedValue(signedIn({ passwordHash: null }));
    });

    it('confirms by typing its username', async () => {
      const res = await del({ confirmUsername: ' member ' });
      expect(res.status).toBe(200);
      expect(mocks.userUpdateMany.mock.calls[0][0].where.passwordHash).toBeNull();
      expect(mocks.userDelete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
      expect(mocks.verifyUserPassword).not.toHaveBeenCalled();
    });

    it('refuses a different or missing username', async () => {
      expect((await del({ confirmUsername: 'someone-else' })).status).toBe(403);
      expect((await del({})).status).toBe(403);
      expect(mocks.userDelete).not.toHaveBeenCalled();
    });
  });
});
