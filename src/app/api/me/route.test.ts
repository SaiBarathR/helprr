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
  queryRaw: vi.fn(),
  enforceLoginRateLimit: vi.fn(),
  enforceUsernameBackoff: vi.fn(),
  enforceGlobalLoginBackstop: vi.fn(),
  recordUsernameFailure: vi.fn(),
  recordGlobalLoginFailure: vi.fn(),
  clearUsernameBackoff: vi.fn(),
  recordSecurityEvent: vi.fn(),
  recordFailedSignIn: vi.fn(),
  getJellyfinClientContext: vi.fn(),
  getJellyfinUser: vi.fn(),
  authenticateByName: vi.fn(),
  storeJellyfinToken: vi.fn(),
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
    $queryRaw: inTx(() => (mocks.order.push('row-lock'), mocks.queryRaw())),
    user: {
      updateMany: inTx((args: unknown) => (mocks.order.push('user-lock'), mocks.userUpdateMany(args))),
      count: inTx(mocks.userCount),
      deleteMany: inTx((args: unknown) => (mocks.order.push('delete'), mocks.userDelete(args))),
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
vi.mock('@/lib/service-helpers', () => ({ getJellyfinClientContext: mocks.getJellyfinClientContext }));
vi.mock('@/lib/jellyfin-client', () => ({ JellyfinClient: { authenticateByName: mocks.authenticateByName } }));
vi.mock('@/lib/jellyfin-token', () => ({ storeJellyfinToken: mocks.storeJellyfinToken }));
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
  mocks.userDelete.mockResolvedValue({ count: 1 });
  // The row as it is under the lock: the signed-in user's own role, still active.
  mocks.queryRaw.mockImplementation(async () => {
    const auth = await mocks.requireUser.mock.results.at(-1)?.value;
    return [{ role: auth?.user?.role ?? 'member', status: 'active' }];
  });
  for (const gate of [mocks.enforceLoginRateLimit, mocks.enforceUsernameBackoff, mocks.enforceGlobalLoginBackstop]) {
    gate.mockResolvedValue(null);
  }
  mocks.getJellyfinClientContext.mockResolvedValue({
    client: { getUser: mocks.getJellyfinUser },
    connection: { url: 'http://jellyfin.test' },
  });
  mocks.getJellyfinUser.mockResolvedValue({ Id: 'jf-1', Name: 'Member JF' });
  mocks.storeJellyfinToken.mockResolvedValue(undefined);
  mocks.authenticateByName.mockImplementation(async (_url: string, _name: string, plain: string) => (
    plain === PASSWORD
      ? { ok: true, userId: 'jf-1', accessToken: 'jf-token', userName: 'Member JF' }
      : { ok: false, reason: 'invalid_credentials' }
  ));
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
    expect(mocks.order).toEqual(['user-lock', 'guard-lock', 'row-lock', 'delete']);
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

  it("refuses the APP_PASSWORD recovery admin, which would come back on restart", async () => {
    // Any non-empty value; built at runtime so secret scanners don't read it as a password.
    vi.stubEnv('APP_PASSWORD', ['configured', 'by', 'env'].join('-'));
    try {
      mocks.requireUser.mockResolvedValue({ ok: true, user: account({ id: 'user-bootstrap-admin', role: 'admin' }), session: { id: 'session-1' } });
      const res = await del({ currentPassword: PASSWORD });
      expect(res.status).toBe(409);
      expect(mocks.userDelete).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('refuses the last active admin', async () => {
    mocks.requireUser.mockResolvedValue(signedIn({ role: 'admin' }));
    mocks.userCount.mockResolvedValue(0);
    const res = await del({ currentPassword: PASSWORD });
    expect(res.status).toBe(409);
    expect(mocks.userCount).toHaveBeenCalledWith({ where: { role: 'admin', status: 'active', NOT: { id: 'user-1' } } });
    // The guard lock before the row lock, the order Settings -> Users takes them.
    expect(mocks.order).toEqual(['guard-lock', 'user-lock', 'guard-lock', 'row-lock']);
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
      mocks.requireUser.mockResolvedValue(signedIn({ passwordHash: null, jellyfinUserId: 'jf-1' }));
    });

    it('confirms with its Jellyfin password, checked as the linked Jellyfin user', async () => {
      const res = await del({ currentPassword: PASSWORD });
      expect(res.status).toBe(200);
      expect(mocks.getJellyfinUser).toHaveBeenCalledWith('jf-1');
      expect(mocks.authenticateByName).toHaveBeenCalledWith('http://jellyfin.test', 'Member JF', PASSWORD);
      // Both the Helprr name's and the Jellyfin name's backoff, the one Jellyfin sign-in uses.
      expect(mocks.enforceUsernameBackoff.mock.calls).toEqual([['member'], ['Member JF']]);
      expect(mocks.clearUsernameBackoff.mock.calls).toEqual([['member'], ['member jf']]);
      // The new playback token is kept, in case the delete is refused after the check.
      expect(mocks.storeJellyfinToken).toHaveBeenCalledWith('user-1', 'jf-token');
      // The lock also holds the Jellyfin link that was just checked.
      const where = mocks.userUpdateMany.mock.calls[0][0].where;
      expect(where.passwordHash).toBeNull();
      expect(where.jellyfinUserId).toBe('jf-1');
      expect(mocks.userDelete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
      expect(mocks.verifyUserPassword).not.toHaveBeenCalled();
    });

    it('refuses a wrong Jellyfin password and counts it like a failed sign-in', async () => {
      const res = await del({ currentPassword: 'not it' });
      expect(res.status).toBe(403);
      expect(mocks.recordUsernameFailure.mock.calls).toEqual([['member', 'not it'], ['member jf', 'not it']]);
      expect(mocks.storeJellyfinToken).not.toHaveBeenCalled();
      expect(mocks.recordGlobalLoginFailure).toHaveBeenCalledOnce();
      expect(mocks.recordFailedSignIn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'jellyfin' }));
      expect(mocks.userDelete).not.toHaveBeenCalled();
    });

    it('no longer accepts a typed username', async () => {
      expect((await del({ confirmUsername: 'member' })).status).toBe(400);
      expect(mocks.authenticateByName).not.toHaveBeenCalled();
      expect(mocks.userDelete).not.toHaveBeenCalled();
    });

    it('refuses a password Jellyfin accepts for a different Jellyfin user', async () => {
      mocks.authenticateByName.mockResolvedValue({ ok: true, userId: 'jf-other', accessToken: 't', userName: 'x' });
      expect((await del({ currentPassword: PASSWORD })).status).toBe(403);
      expect(mocks.userDelete).not.toHaveBeenCalled();
    });

    it('answers 502 and counts nothing when Jellyfin cannot be reached', async () => {
      mocks.authenticateByName.mockResolvedValue({ ok: false, reason: 'unavailable' });
      expect((await del({ currentPassword: PASSWORD })).status).toBe(502);
      mocks.getJellyfinUser.mockRejectedValue(new Error('down'));
      expect((await del({ currentPassword: PASSWORD })).status).toBe(502);
      mocks.getJellyfinUser.mockResolvedValue({ Id: 'jf-1' });
      expect((await del({ currentPassword: PASSWORD })).status).toBe(502);
      expect(mocks.recordUsernameFailure).not.toHaveBeenCalled();
      expect(mocks.userDelete).not.toHaveBeenCalled();
    });

    it('answers a throttled attempt without asking Jellyfin for the password', async () => {
      mocks.enforceUsernameBackoff.mockResolvedValue(NextResponse.json({ error: 'Too many' }, { status: 429 }));
      expect((await del({ currentPassword: PASSWORD })).status).toBe(429);
      // Locked out under the Jellyfin name only (from Jellyfin sign-in).
      mocks.enforceUsernameBackoff.mockImplementation(async (name: string) => (
        name === 'Member JF' ? NextResponse.json({ error: 'Too many' }, { status: 429 }) : null
      ));
      expect((await del({ currentPassword: PASSWORD })).status).toBe(429);
      expect(mocks.authenticateByName).not.toHaveBeenCalled();
    });

    it('deletes nothing when the Jellyfin link changed after the check', async () => {
      mocks.userUpdateMany.mockResolvedValue({ count: 0 });
      expect((await del({ currentPassword: PASSWORD })).status).toBe(409);
      expect(mocks.userDelete).not.toHaveBeenCalled();
    });

    it('refuses an account with neither a password nor a Jellyfin link', async () => {
      mocks.requireUser.mockResolvedValue(signedIn({ passwordHash: null, jellyfinUserId: null }));
      expect((await del({ currentPassword: PASSWORD })).status).toBe(409);
      expect(mocks.userDelete).not.toHaveBeenCalled();
    });
  });
});
