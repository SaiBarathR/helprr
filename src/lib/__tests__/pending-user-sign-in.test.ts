import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { hashPassword } from '@/lib/password';

// An invited user is pending until they use their link: the password sign-in
// must refuse them even with the right password (sessions of pending users are
// refused in auth-session-role.test.ts).

const mocks = vi.hoisted(() => ({
  users: [] as Array<{ id: string; username: string; role: string; status: string; passwordHash: string | null }>,
  createSession: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      // Honours the route's where clause, so the status filter is what is tested.
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        mocks.users.find((u) => Object.entries(where).every(([k, v]) => u[k as keyof typeof u] === v)) ?? null),
      updateMany: vi.fn(),
    },
  },
}));
vi.mock('@/lib/auth', async () => {
  const { verifyPasswordHash } = await import('@/lib/password');
  return {
    createSession: mocks.createSession,
    verifyUserPassword: async (user: { passwordHash: string | null }, plain: string) =>
      user.passwordHash ? verifyPasswordHash(plain, user.passwordHash) : false,
    COOKIE_NAME: 'helprr-session',
    SESSION_DURATION: 60,
  };
});
vi.mock('@/lib/login-rate-limit', () => ({
  getClientIp: () => undefined,
  enforceLoginRateLimit: async () => null,
  clearLoginAttempts: async () => undefined,
  enforceUsernameBackoff: async () => null,
  recordUsernameFailure: async () => undefined,
  clearUsernameBackoff: async () => undefined,
  enforceGlobalLoginBackstop: async () => null,
  recordGlobalLoginFailure: async () => undefined,
  enforceMalformedLoginBackstop: async () => null,
  recordMalformedLoginRequest: async () => null,
}));
vi.mock('@/lib/security-audit', () => ({ recordSecurityEvent: vi.fn(), recordFailedSignIn: vi.fn() }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));

import { POST as login } from '@/app/api/auth/login/route';

const PASSWORD = 'the right long password';

function signIn() {
  return login(new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'newbie', password: PASSWORD }),
  }));
}

describe('a pending (invited) user', () => {
  beforeEach(async () => {
    mocks.createSession.mockReset().mockResolvedValue('session-token');
    mocks.users = [{ id: 'u1', username: 'newbie', role: 'member', status: 'pending', passwordHash: await hashPassword(PASSWORD) }];
  });

  it('cannot sign in, even with the right password', async () => {
    const response = await signIn();
    expect(response.status).toBe(401);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('can once the account is active', async () => {
    mocks.users[0].status = 'active';
    expect((await signIn()).status).toBe(200);
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
  });
});
