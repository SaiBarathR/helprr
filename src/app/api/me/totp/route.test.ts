import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Secret, TOTP } from 'otpauth';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  verifyUserPassword: vi.fn(),
  userUpdateMany: vi.fn(),
  recoveryCount: vi.fn(),
  recoveryDeleteMany: vi.fn(),
  recoveryCreateMany: vi.fn(),
  transaction: vi.fn(),
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
  const db = {
    user: { updateMany: mocks.userUpdateMany },
    recoveryCode: { count: mocks.recoveryCount, deleteMany: mocks.recoveryDeleteMany, createMany: mocks.recoveryCreateMany },
    $transaction: mocks.transaction,
  };
  return { prisma: db };
});
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser, verifyUserPassword: mocks.verifyUserPassword }));
vi.mock('@/lib/login-rate-limit', () => ({ getClientIp: () => undefined, ...mocks.limits }));
vi.mock('@/lib/security-audit', () => ({
  recordFailedSignIn: mocks.recordFailedSignIn,
  recordSecurityEvent: mocks.recordSecurityEvent,
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/redis', () => ({ getRedisClient: async () => ({ eval: mocks.redisEval, del: mocks.redisDel }) }));

import { GET, DELETE } from './route';
import { POST as setupPost } from './setup/route';
import { POST as enablePost } from './enable/route';
import { prisma } from '@/lib/db';
import { createTotpSetup, hashRecoveryCode } from '@/lib/totp';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
let user: Record<string, unknown>;
let secret: { secret: string; encryptedSecret: string };

function code(ms = NOW): string {
  return new TOTP({ secret: Secret.fromBase32(secret.secret) }).generate({ timestamp: ms });
}

function req(method: string, body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/me/totp', {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('JWT_SECRET', 'a-valid-session-secret-that-is-longer-than-32-characters');
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  for (const fn of Object.values(mocks.limits)) fn.mockResolvedValue(null);
  mocks.verifyUserPassword.mockResolvedValue(true);
  mocks.userUpdateMany.mockResolvedValue({ count: 1 });
  mocks.recoveryDeleteMany.mockResolvedValue({ count: 0 });
  mocks.recoveryCreateMany.mockResolvedValue({ count: 10 });
  mocks.recoveryCount.mockResolvedValue(10);
  mocks.redisEval.mockResolvedValue(['ok', '0']);
  mocks.redisDel.mockResolvedValue(1);
  mocks.transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as unknown[]));
  secret = createTotpSetup('member');
  user = {
    id: 'user-1',
    username: 'member',
    status: 'active',
    passwordHash: 'stored-hash',
    jellyfinUserId: null,
    totpSecret: null,
    totpEnabledAt: null,
    totpLastUsedStep: null,
  };
  mocks.requireUser.mockImplementation(async () => ({ ok: true, user, session: { id: 'session-1' } }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('GET /api/me/totp', () => {
  it('says off, and that a local account can turn it on', async () => {
    expect(await (await GET()).json()).toEqual({ available: true, enabled: false, recoveryCodesLeft: 0 });
  });

  it('never returns the secret', async () => {
    user = { ...user, totpSecret: secret.encryptedSecret, totpEnabledAt: new Date() };
    const text = await (await GET()).text();
    expect(JSON.parse(text)).toEqual({ available: true, enabled: true, recoveryCodesLeft: 10 });
    expect(text).not.toContain(secret.encryptedSecret);
    expect(text).not.toContain(secret.secret);
  });

  it('requires a session', async () => {
    mocks.requireUser.mockResolvedValue({ ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) });
    expect((await GET()).status).toBe(401);
  });
});

describe('setup and enable', () => {
  it('setup needs the current password and counts a wrong one as a failed sign-in', async () => {
    mocks.verifyUserPassword.mockResolvedValue(false);
    const response = await setupPost(req('POST', { currentPassword: 'wrong password here' }));
    expect(response.status).toBe(403);
    expect(mocks.limits.recordUsernameFailure).toHaveBeenCalledWith('member', 'wrong password here');
    expect(mocks.recordFailedSignIn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'password', actor: user }));
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
  });

  it('setup is refused for a Jellyfin-only account and when already on', async () => {
    user = { ...user, passwordHash: null };
    expect((await setupPost(req('POST', { currentPassword: 'x' }))).status).toBe(409);
    user = { ...user, passwordHash: 'stored-hash', totpEnabledAt: new Date() };
    expect((await setupPost(req('POST', { currentPassword: 'x' }))).status).toBe(409);
    expect(mocks.verifyUserPassword).not.toHaveBeenCalled();
  });

  it('setup stores an encrypted secret, not yet on, and returns it once', async () => {
    const response = await setupPost(req('POST', { currentPassword: 'correct horse battery' }));
    const data = await response.json();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(data.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(data.uri).toContain('otpauth://totp/Helprr:member?');
    const write = mocks.userUpdateMany.mock.calls[0][0];
    expect(write.where).toEqual({ id: 'user-1', status: 'active', totpEnabledAt: null });
    expect(write.data.totpSecret).toMatch(/^enc:v1:/);
    expect(write.data.totpSecret).not.toContain(data.secret);
    expect(write.data).not.toHaveProperty('totpEnabledAt');
  });

  it('enable refuses a wrong code and turns nothing on', async () => {
    user = { ...user, totpSecret: secret.encryptedSecret };
    const response = await enablePost(req('POST', { code: code(NOW + 10 * 60_000) }));
    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('enable with a right code turns it on, stores ten hashed recovery codes and returns them once', async () => {
    user = { ...user, totpSecret: secret.encryptedSecret };
    const response = await enablePost(req('POST', { code: code() }));
    const { recoveryCodes } = await response.json();

    expect(response.status).toBe(200);
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    for (const c of recoveryCodes) expect(c).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
    expect(mocks.userUpdateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', status: 'active', totpEnabledAt: null, totpSecret: secret.encryptedSecret },
      data: { totpEnabledAt: expect.any(Date), totpLastUsedStep: Math.floor(NOW / 30_000) },
    });
    const stored = mocks.recoveryCreateMany.mock.calls[0][0].data as Array<{ codeHash: string }>;
    expect(stored.map((row) => row.codeHash)).toEqual(recoveryCodes.map(hashRecoveryCode));
    expect(JSON.stringify(stored)).not.toContain(recoveryCodes[0]);
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'MFA_ENABLED' }));
  });

  it('enable tries count toward the hourly code cap', async () => {
    user = { ...user, totpSecret: secret.encryptedSecret };
    mocks.redisEval.mockResolvedValue(['locked', '60000']);
    const response = await enablePost(req('POST', { code: code() }));
    expect(response.status).toBe(429);
    expect(mocks.redisEval.mock.calls[0][1].keys[0]).toBe('login:mfa-account:user-1');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('enable refuses when there is no setup to confirm or it is already on', async () => {
    expect((await enablePost(req('POST', { code: code() }))).status).toBe(409);
    user = { ...user, totpSecret: secret.encryptedSecret, totpEnabledAt: new Date() };
    expect((await enablePost(req('POST', { code: code() }))).status).toBe(409);
  });

  it('enable returns a conflict when the setup changed meanwhile', async () => {
    user = { ...user, totpSecret: secret.encryptedSecret };
    mocks.userUpdateMany.mockResolvedValue({ count: 0 });
    expect((await enablePost(req('POST', { code: code() }))).status).toBe(409);
    expect(mocks.recoveryCreateMany).not.toHaveBeenCalled();
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/me/totp', () => {
  beforeEach(() => {
    user = { ...user, totpSecret: secret.encryptedSecret, totpEnabledAt: new Date('2026-11-01T00:00:00Z') };
  });

  it('needs the current password', async () => {
    mocks.verifyUserPassword.mockResolvedValue(false);
    const response = await DELETE(req('DELETE', { currentPassword: 'wrong password here', code: code() }));
    expect(response.status).toBe(403);
    expect((await response.json()).field).toBeUndefined();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('needs a code: a wrong one is a failed sign-in and keeps the backoff', async () => {
    const response = await DELETE(req('DELETE', { currentPassword: 'correct horse battery', code: code(NOW + 10 * 60_000) }));
    expect(response.status).toBe(403);
    expect((await response.json()).field).toBe('code');
    expect(mocks.limits.recordUsernameFailure).toHaveBeenCalled();
    expect(mocks.recordFailedSignIn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'totp', actor: user }));
    expect(mocks.limits.clearUsernameBackoff).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('with both, turns it off, deletes the recovery codes and records it', async () => {
    const response = await DELETE(req('DELETE', { currentPassword: 'correct horse battery', code: code() }));
    expect(response.status).toBe(200);
    expect(mocks.userUpdateMany).toHaveBeenLastCalledWith({
      where: { id: 'user-1' },
      data: { totpSecret: null, totpEnabledAt: null, totpLastUsedStep: null },
    });
    expect(mocks.recoveryDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'MFA_DISABLED' }));
  });

  it('accepts a recovery code instead, and records its use', async () => {
    mocks.recoveryDeleteMany.mockResolvedValueOnce({ count: 1 });
    const response = await DELETE(req('DELETE', { currentPassword: 'correct horse battery', code: 'ABCD-EFGH-IJKL-MNOP' }));
    expect(response.status).toBe(200);
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'MFA_RECOVERY_CODE_USED' }));
  });

  it('stops at the hourly code cap', async () => {
    mocks.redisEval.mockResolvedValue(['locked', '60000']);
    const response = await DELETE(req('DELETE', { currentPassword: 'correct horse battery', code: code() }));
    expect(response.status).toBe(429);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('is refused when already off', async () => {
    user = { ...user, totpSecret: null, totpEnabledAt: null };
    expect((await DELETE(req('DELETE', { currentPassword: 'x', code: '123456' }))).status).toBe(409);
  });
});
