import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Secret, TOTP } from 'otpauth';

// A reset link for your own account while your two-step sign-in is on: it
// turns two-step sign-in off when used, so making one needs your password and
// a code, checked as turning it off checks them. The real password/code check
// and TOTP, with the database, Redis, throttles and audit mocked.

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  verifyUserPassword: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdateMany: vi.fn(),
  recoveryDeleteMany: vi.fn(),
  linkUpsert: vi.fn(),
  txLinkUpsert: vi.fn(),
  queryRaw: vi.fn(),
  lockedTwoStep: vi.fn(),
  recordFailedSignIn: vi.fn(),
  recordSecurityEvent: vi.fn(),
  redisEval: vi.fn(),
  redisDel: vi.fn(),
  limits: {
    enforceLoginRateLimit: vi.fn(),
    enforceUsernameBackoff: vi.fn(),
    recordUsernameFailure: vi.fn(),
    clearUsernameBackoff: vi.fn(),
    enforceGlobalLoginBackstop: vi.fn(),
    recordGlobalLoginFailure: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => {
  // The transaction client is its own object, so a link made outside it shows.
  const tx = {
    // The row lock on your own account: answers its two-step state as it is now.
    $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
      mocks.queryRaw(sql.join('?'), values);
      return [{ totpEnabledAt: mocks.lockedTwoStep() }];
    },
    passwordLink: { upsert: mocks.txLinkUpsert },
  };
  const prisma = {
    user: { findUnique: mocks.userFindUnique, updateMany: mocks.userUpdateMany },
    recoveryCode: { deleteMany: mocks.recoveryDeleteMany },
    passwordLink: { upsert: mocks.linkUpsert },
    $transaction: async (fn: (client: unknown) => unknown) => fn(tx),
  };
  return { prisma };
});
vi.mock('@/lib/auth', () => ({ requireAdmin: mocks.requireAdmin, verifyUserPassword: mocks.verifyUserPassword }));
vi.mock('@/lib/login-rate-limit', () => ({ getClientIp: () => undefined, ...mocks.limits }));
vi.mock('@/lib/security-audit', () => ({
  recordFailedSignIn: mocks.recordFailedSignIn,
  recordSecurityEvent: mocks.recordSecurityEvent,
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/redis', () => ({ getRedisClient: async () => ({ eval: mocks.redisEval, del: mocks.redisDel }) }));

import { POST } from './route';
import { createTotpSetup } from '@/lib/totp';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const PASSWORD = 'the admin password, long enough';
let secret: { secret: string; encryptedSecret: string };
let admin: Record<string, unknown>;

function code(): string {
  return new TOTP({ secret: Secret.fromBase32(secret.secret) }).generate({ timestamp: NOW });
}

function issue(id: string, body: unknown = {}) {
  return POST(
    new NextRequest(`http://localhost/api/users/${id}/password-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function account(id: string) {
  return { id, username: id, status: 'active', passwordHash: 'stored-hash', passwordLink: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('JWT_SECRET', 'a-valid-session-secret-that-is-longer-than-32-characters');
  vi.stubEnv('APP_ORIGIN', '');
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  for (const fn of Object.values(mocks.limits)) fn.mockResolvedValue(null);
  mocks.verifyUserPassword.mockImplementation(async (_user: unknown, password: string) => password === PASSWORD);
  mocks.userUpdateMany.mockResolvedValue({ count: 1 });
  mocks.recoveryDeleteMany.mockResolvedValue({ count: 1 });
  mocks.linkUpsert.mockResolvedValue({});
  mocks.txLinkUpsert.mockResolvedValue({});
  mocks.redisEval.mockResolvedValue(['ok', '0']);
  mocks.redisDel.mockResolvedValue(1);
  secret = createTotpSetup('boss');
  admin = {
    id: 'admin-1',
    username: 'boss',
    role: 'admin',
    status: 'active',
    passwordHash: 'stored-hash',
    jellyfinUserId: null,
    totpSecret: secret.encryptedSecret,
    totpEnabledAt: new Date(NOW - 86_400_000),
    totpLastUsedStep: null,
  };
  mocks.requireAdmin.mockImplementation(async () => ({ ok: true, user: admin }));
  mocks.lockedTwoStep.mockImplementation(() => admin.totpEnabledAt);
  mocks.userFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => account(where.id));
});

function expectNoLink() {
  expect(mocks.linkUpsert).not.toHaveBeenCalled();
  expect(mocks.txLinkUpsert).not.toHaveBeenCalled();
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('POST /api/users/[id]/password-link for your own account, two-step sign-in on', () => {
  it.each([
    ['nothing', {}],
    ['a code without the password', { code: '123456' }],
    ['the password without a code', { currentPassword: PASSWORD }],
  ])('refuses %s with 403 and a clear message, and makes no link', async (_label, body) => {
    const response = await issue('admin-1', body);
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.needsSecondFactor).toBe(true);
    expect(data.error).toMatch(/current password and a code/);
    expectNoLink();
    expect(mocks.verifyUserPassword).not.toHaveBeenCalled();
  });

  it('refuses a wrong password, counted as a failed sign-in', async () => {
    const response = await issue('admin-1', { currentPassword: 'not it', code: code() });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('Current password is incorrect');
    expect(mocks.limits.recordUsernameFailure).toHaveBeenCalledWith('boss', 'not it');
    expect(mocks.limits.recordGlobalLoginFailure).toHaveBeenCalled();
    expect(mocks.recordFailedSignIn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'password' }));
    expectNoLink();
  });

  it('refuses a wrong code with 403, counted against the code cap and as a failed sign-in', async () => {
    const wrong = code() === '000000' ? '111111' : '000000';
    const response = await issue('admin-1', { currentPassword: PASSWORD, code: wrong });
    expect(response.status).toBe(403);
    expect((await response.json()).field).toBe('code');
    // The account's hourly code count was taken before the code was checked.
    expect(mocks.redisEval).toHaveBeenCalledTimes(1);
    expect(mocks.redisEval.mock.calls[0][1].keys[0]).toContain('admin-1');
    expect(mocks.limits.recordUsernameFailure).toHaveBeenCalledWith('boss', expect.any(String));
    expect(mocks.limits.recordGlobalLoginFailure).toHaveBeenCalled();
    expect(mocks.recordFailedSignIn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'totp' }));
    expect(mocks.redisDel).not.toHaveBeenCalled();
    expectNoLink();
  });

  it('honors the hourly code cap', async () => {
    mocks.redisEval.mockResolvedValue(['locked', '600000']);
    const response = await issue('admin-1', { currentPassword: PASSWORD, code: code() });
    expect(response.status).toBe(429);
    expectNoLink();
  });

  it('fails closed when Redis is down', async () => {
    mocks.redisEval.mockRejectedValue(new Error('down'));
    expect((await issue('admin-1', { currentPassword: PASSWORD, code: code() })).status).toBe(503);
    expectNoLink();
  });

  it('makes the link with the right password and code, holding your user row, and clears the counts', async () => {
    const response = await issue('admin-1', { currentPassword: PASSWORD, code: code() });
    expect(response.status).toBe(201);
    expect((await response.json()).token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mocks.queryRaw).toHaveBeenCalledWith(expect.stringMatching(/FROM "User" WHERE "id" = \? FOR UPDATE/), ['admin-1']);
    expect(mocks.linkUpsert).not.toHaveBeenCalled();
    expect(mocks.txLinkUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ userId: 'admin-1', purpose: 'reset', createdById: 'admin-1' }),
    }));
    expect(mocks.redisDel).toHaveBeenCalled();
    expect(mocks.limits.clearUsernameBackoff).toHaveBeenCalledWith('boss');
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'RESET_LINK_CREATED' }));
  });

  it('accepts a recovery code instead, uses it up and records it', async () => {
    const response = await issue('admin-1', { currentPassword: PASSWORD, code: 'ABCD-EFGH-JKLM-NPQR' });
    expect(response.status).toBe(201);
    expect(mocks.recoveryDeleteMany).toHaveBeenCalled();
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'MFA_RECOVERY_CODE_USED', targetId: 'admin-1', fields: ['reset-link'],
    }));
  });
});

describe('POST /api/users/[id]/password-link, unchanged cases', () => {
  it('makes your own link with no password or code while your two-step sign-in is off', async () => {
    admin = { ...admin, totpSecret: null, totpEnabledAt: null };
    expect((await issue('admin-1')).status).toBe(201);
    expect(mocks.verifyUserPassword).not.toHaveBeenCalled();
    expect(mocks.redisEval).not.toHaveBeenCalled();
  });

  it('refuses, under the lock, when two-step sign-in was turned on after this request read it', async () => {
    admin = { ...admin, totpSecret: null, totpEnabledAt: null };
    mocks.lockedTwoStep.mockReturnValue(new Date(NOW));
    const response = await issue('admin-1');
    expect(response.status).toBe(403);
    expect((await response.json()).needsSecondFactor).toBe(true);
    expectNoLink();
  });

  it('refuses, under the lock, when two-step sign-in was turned off and on again after the code was checked', async () => {
    mocks.lockedTwoStep.mockReturnValue(new Date(NOW));
    const response = await issue('admin-1', { currentPassword: PASSWORD, code: code() });
    expect(response.status).toBe(403);
    expect((await response.json()).needsSecondFactor).toBe(true);
    expectNoLink();
  });

  it("makes someone else's link with no password or code, even with the admin's two-step sign-in on", async () => {
    const response = await issue('u2');
    expect(response.status).toBe(201);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.txLinkUpsert).not.toHaveBeenCalled();
    expect(mocks.linkUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ userId: 'u2', createdById: 'admin-1' }),
    }));
    expect(mocks.verifyUserPassword).not.toHaveBeenCalled();
    expect(mocks.redisEval).not.toHaveBeenCalled();
  });
});
