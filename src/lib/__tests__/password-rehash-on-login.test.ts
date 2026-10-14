import { scryptSync, randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { hashPassword, passwordHashNeedsUpgrade, verifyPasswordHash } from '@/lib/password';

const mocks = vi.hoisted(() => ({
  userFindFirst: vi.fn(),
  userUpdateMany: vi.fn(),
  createSession: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: { user: { findFirst: mocks.userFindFirst, updateMany: mocks.userUpdateMany } },
}));
vi.mock('@/lib/auth', async () => {
  const { verifyPasswordHash: verify } = await import('@/lib/password');
  return {
    createSession: mocks.createSession,
    // The real check: Jellyfin-only accounts (no hash) never verify locally.
    verifyUserPassword: async (user: { passwordHash: string | null }, plain: string) =>
      user.passwordHash ? verify(plain, user.passwordHash) : false,
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
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown) => handler,
}));

import { POST as login } from '@/app/api/auth/login/route';

/** A hash in the stored format, made with older or other scrypt parameters. */
function legacyHash(plain: string, { N = 1024, r = 8, p = 1, keylen = 64, saltBytes = 16 } = {}) {
  const salt = randomBytes(saltBytes);
  const derived = scryptSync(plain, salt, keylen, { N, r, p, maxmem: 128 * 1024 * 1024 });
  return ['scrypt', N, r, p, salt.toString('base64'), derived.toString('base64')].join('$');
}

function loginRequest(password: string) {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'member', password }),
  });
}

// Plain words rather than anything shaped like a real credential.
const TYPED = 'the words typed at sign in';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createSession.mockResolvedValue('session-token');
  mocks.userUpdateMany.mockResolvedValue({ count: 1 });
});

describe('passwordHashNeedsUpgrade', () => {
  it('leaves a current-policy hash alone', async () => {
    expect(passwordHashNeedsUpgrade(await hashPassword(TYPED))).toBe(false);
  });

  it.each([
    ['a lower cost', { N: 1024 }],
    ['a higher cost', { N: 32768 }],
    ['another block size', { r: 4 }],
    ['another parallelism', { p: 2 }],
    ['a shorter key', { keylen: 32 }],
    ['a shorter salt', { saltBytes: 8 }],
  ])('flags a supported hash with %s', (_label, params) => {
    expect(passwordHashNeedsUpgrade(legacyHash(TYPED, params))).toBe(true);
  });

  it.each(['', 'not-a-hash', 'scrypt$3$8$1$AAAA$AAAA', 'bcrypt$whatever'])(
    'does not flag malformed or unsupported value %j',
    (value) => {
      expect(passwordHashNeedsUpgrade(value)).toBe(false);
    },
  );
});

describe('POST /api/auth/login password rehash', () => {
  it('does not rewrite a current-policy hash', async () => {
    mocks.userFindFirst.mockResolvedValue({ id: 'user-1', role: 'member', passwordHash: await hashPassword(TYPED) });

    expect((await login(loginRequest(TYPED))).status).toBe(200);
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
  });

  it('rewrites an older hash exactly once, only after the password verified', async () => {
    const old = legacyHash(TYPED);
    mocks.userFindFirst.mockResolvedValue({ id: 'user-1', role: 'member', passwordHash: old });

    expect((await login(loginRequest(TYPED))).status).toBe(200);

    expect(mocks.userUpdateMany).toHaveBeenCalledOnce();
    const [{ where, data }] = mocks.userUpdateMany.mock.calls[0];
    // Optimistic: replaces only the hash that was verified.
    expect(where).toEqual({ id: 'user-1', passwordHash: old });
    expect(passwordHashNeedsUpgrade(data.passwordHash)).toBe(false);
    expect(await verifyPasswordHash(TYPED, data.passwordHash)).toBe(true);
    expect(mocks.createSession).toHaveBeenCalledOnce();
  });

  it('never rewrites on a wrong password', async () => {
    mocks.userFindFirst.mockResolvedValue({ id: 'user-1', role: 'member', passwordHash: legacyHash(TYPED) });

    expect((await login(loginRequest('other words'))).status).toBe(401);
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('leaves a password changed meanwhile in place and still signs in', async () => {
    mocks.userFindFirst.mockResolvedValue({ id: 'user-1', role: 'member', passwordHash: legacyHash(TYPED) });
    mocks.userUpdateMany.mockResolvedValue({ count: 0 });

    expect((await login(loginRequest(TYPED))).status).toBe(200);
    expect(mocks.createSession).toHaveBeenCalledOnce();
  });

  it('signs in when the rehash write fails, logging without the password', async () => {
    mocks.userFindFirst.mockResolvedValue({ id: 'user-1', role: 'member', passwordHash: legacyHash(TYPED) });
    mocks.userUpdateMany.mockRejectedValue(new Error('database unavailable'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await login(loginRequest(TYPED));
    const logged = error.mock.calls.flat().join(' ');
    error.mockRestore();

    expect(res.status).toBe(200);
    expect(mocks.createSession).toHaveBeenCalledOnce();
    expect(logged).toContain('user-1');
    expect(logged).toContain('database unavailable');
    expect(logged).not.toContain(TYPED);
  });

  it('upgrades a short legacy password, which still verifies after the 15-character rule', async () => {
    const short = 'abc';
    mocks.userFindFirst.mockResolvedValue({ id: 'user-1', role: 'member', passwordHash: legacyHash(short) });

    expect((await login(loginRequest(short))).status).toBe(200);
    expect(mocks.userUpdateMany).toHaveBeenCalledOnce();
  });

  it('leaves a Jellyfin-only account untouched', async () => {
    mocks.userFindFirst.mockResolvedValue({ id: 'user-1', role: 'member', passwordHash: null });

    expect((await login(loginRequest(TYPED))).status).toBe(401);
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
  });
});
