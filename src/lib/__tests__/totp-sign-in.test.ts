import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SignJWT } from 'jose';
import { Secret, TOTP } from 'otpauth';

// Two-step sign-in across the three sign-in routes, with the real TOTP and
// pending-token code and the database, Redis and throttles mocked.

const mocks = vi.hoisted(() => ({
  userFindFirst: vi.fn(),
  userUpdateMany: vi.fn(),
  userUpdate: vi.fn(),
  recoveryDeleteMany: vi.fn(),
  connectionFindFirst: vi.fn(),
  createSession: vi.fn(),
  verifyUserPassword: vi.fn(),
  authenticateByName: vi.fn(),
  redisSet: vi.fn(),
  redisEval: vi.fn(),
  redisDel: vi.fn(),
  recordFailedSignIn: vi.fn(),
  recordSecurityEvent: vi.fn(),
  limits: {
    enforceLoginRateLimit: vi.fn(),
    clearLoginAttempts: vi.fn(),
    enforceUsernameBackoff: vi.fn(),
    recordUsernameFailure: vi.fn(),
    clearUsernameBackoff: vi.fn(),
    enforceGlobalLoginBackstop: vi.fn(),
    recordGlobalLoginFailure: vi.fn(),
    enforceMalformedLoginBackstop: vi.fn(),
    recordMalformedLoginRequest: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findFirst: mocks.userFindFirst, updateMany: mocks.userUpdateMany, update: mocks.userUpdate },
    recoveryCode: { deleteMany: mocks.recoveryDeleteMany },
    serviceConnection: { findFirst: mocks.connectionFindFirst },
  },
}));
vi.mock('@/lib/auth', () => ({
  createSession: mocks.createSession,
  verifyUserPassword: mocks.verifyUserPassword,
  COOKIE_NAME: 'helprr-session',
  SESSION_DURATION: 60,
}));
vi.mock('@/lib/password', () => ({
  verifyPasswordHash: vi.fn(),
  getDummyPasswordHash: vi.fn(),
  passwordHashNeedsUpgrade: () => false,
  hashPassword: vi.fn(),
}));
vi.mock('@/lib/login-rate-limit', () => ({ getClientIp: () => '203.0.113.9', ...mocks.limits }));
vi.mock('@/lib/redis', () => ({ getRedisClient: async () => ({ set: mocks.redisSet, eval: mocks.redisEval, del: mocks.redisDel }) }));
vi.mock('@/lib/jellyfin-client', () => ({ JellyfinClient: { authenticateByName: mocks.authenticateByName } }));
vi.mock('@/lib/security-audit', () => ({
  recordFailedSignIn: mocks.recordFailedSignIn,
  recordSecurityEvent: mocks.recordSecurityEvent,
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/request-utils', () => ({ isHttpsRequest: () => false }));

import { POST as passwordLogin } from '@/app/api/auth/login/route';
import { POST as jellyfinLogin } from '@/app/api/auth/jellyfin/route';
import { POST as codeLogin } from '@/app/api/auth/login/totp/route';
import { createTotpSetup, hashRecoveryCode } from '@/lib/totp';
import { getJwtSecret } from '@/lib/jwt-secret';

const JWT = 'a-valid-session-secret-that-is-longer-than-32-characters';
const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const STEP = Math.floor(NOW / 30_000);

let setup: { secret: string; encryptedSecret: string };
let user: Record<string, unknown>;

function codeAt(ms: number): string {
  return new TOTP({ secret: Secret.fromBase32(setup.secret), digits: 6, period: 30, algorithm: 'SHA1' }).generate({ timestamp: ms });
}

function post(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

async function firstStep(): Promise<string> {
  const response = await passwordLogin(post('/api/auth/login', { username: 'member', password: 'correct horse battery' }));
  const data = await response.json();
  expect(data.mfaRequired).toBe(true);
  return data.mfaToken as string;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('JWT_SECRET', JWT);
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  for (const fn of Object.values(mocks.limits)) fn.mockResolvedValue(null);
  mocks.createSession.mockResolvedValue('session-token');
  mocks.verifyUserPassword.mockResolvedValue(true);
  mocks.userUpdateMany.mockResolvedValue({ count: 1 });
  mocks.userUpdate.mockResolvedValue({});
  mocks.recoveryDeleteMany.mockResolvedValue({ count: 0 });
  mocks.redisSet.mockResolvedValue('OK');
  mocks.redisEval.mockResolvedValue(['ok', '0']);
  mocks.redisDel.mockResolvedValue(1);
  mocks.connectionFindFirst.mockResolvedValue({ url: 'http://jf.lan' });
  setup = createTotpSetup('member');
  user = {
    id: 'user-1',
    username: 'member',
    role: 'member',
    passwordHash: 'stored-hash',
    jellyfinUserId: 'jf-1',
    totpSecret: setup.encryptedSecret,
    totpEnabledAt: new Date('2026-11-01T00:00:00Z'),
  };
  mocks.userFindFirst.mockImplementation(async () => user);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('accounts without two-step sign-in', () => {
  it('sign in with a password exactly as before: a session, and the throttles cleared', async () => {
    user = { ...user, totpSecret: null, totpEnabledAt: null };
    const response = await passwordLogin(post('/api/auth/login', { username: 'member', password: 'correct horse battery' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(response.cookies.get('helprr-session')?.value).toBe('session-token');
    expect(mocks.createSession).toHaveBeenCalledOnce();
    expect(mocks.limits.clearUsernameBackoff).toHaveBeenCalledWith('member');
    expect(mocks.limits.clearLoginAttempts).toHaveBeenCalledWith('203.0.113.9');
  });

  it('sign in with Jellyfin exactly as before', async () => {
    user = { ...user, totpSecret: null, totpEnabledAt: null };
    mocks.authenticateByName.mockResolvedValue({ ok: true, userId: 'jf-1', accessToken: 'jf-token' });
    const response = await jellyfinLogin(post('/api/auth/jellyfin', { username: 'member', password: 'correct horse battery' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(response.cookies.get('helprr-session')?.value).toBe('session-token');
  });

  it('a pending setup that was never confirmed does not ask for a code', async () => {
    user = { ...user, totpEnabledAt: null };
    const response = await passwordLogin(post('/api/auth/login', { username: 'member', password: 'correct horse battery' }));
    expect(await response.json()).toEqual({ success: true });
  });
});

describe('the first step with two-step sign-in on', () => {
  it('a right password returns a pending token, not a session, and clears no throttle', async () => {
    const response = await passwordLogin(post('/api/auth/login', { username: 'member', password: 'correct horse battery' }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ mfaRequired: true, mfaToken: expect.any(String) });
    expect(response.cookies.get('helprr-session')).toBeUndefined();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.limits.clearUsernameBackoff).not.toHaveBeenCalled();
    expect(mocks.limits.clearLoginAttempts).not.toHaveBeenCalled();
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();
  });

  it('a wrong password still says only that the password is wrong', async () => {
    mocks.verifyUserPassword.mockResolvedValue(false);
    const response = await passwordLogin(post('/api/auth/login', { username: 'member', password: 'wrong password here' }));
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain('mfa');
  });

  it('Jellyfin sign-in asks for the code too', async () => {
    mocks.authenticateByName.mockResolvedValue({ ok: true, userId: 'jf-1', accessToken: 'jf-token' });
    const response = await jellyfinLogin(post('/api/auth/jellyfin', { username: 'jfmember', password: 'correct horse battery' }));
    const data = await response.json();

    expect(data).toEqual({ mfaRequired: true, mfaToken: expect.any(String) });
    expect(response.cookies.get('helprr-session')).toBeUndefined();
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.limits.clearUsernameBackoff).not.toHaveBeenCalled();

    const second = await codeLogin(post('/api/auth/login/totp', { mfaToken: data.mfaToken, code: codeAt(NOW) }));
    expect(second.status).toBe(200);
    // Failed Jellyfin passwords count under the typed name; it is cleared too.
    expect(mocks.limits.clearUsernameBackoff).toHaveBeenCalledWith('member');
    expect(mocks.limits.clearUsernameBackoff).toHaveBeenCalledWith('jfmember');
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'LOGIN_SUCCEEDED', fields: ['jellyfin', 'totp'],
    }));
  });
});

describe('the code step', () => {
  it('a right code makes the session, clears the throttles and records the sign-in', async () => {
    const mfaToken = await firstStep();
    const response = await codeLogin(post('/api/auth/login/totp', { mfaToken, code: codeAt(NOW) }));

    expect(response.status).toBe(200);
    expect(response.cookies.get('helprr-session')?.value).toBe('session-token');
    expect(mocks.createSession).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', role: 'member' }));
    expect(mocks.limits.enforceUsernameBackoff).toHaveBeenCalledWith('member');
    expect(mocks.limits.clearUsernameBackoff).toHaveBeenCalledWith('member');
    expect(mocks.limits.clearLoginAttempts).toHaveBeenCalledWith('203.0.113.9');
    // The step is used up in the same conditional write that checks it is new.
    expect(mocks.userUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'user-1',
        OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: STEP } }],
      }),
      data: { totpLastUsedStep: STEP },
    });
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'LOGIN_SUCCEEDED', fields: ['password', 'totp'],
    }));
  });

  it('accepts a code from the step before, for a phone clock a little behind', async () => {
    const mfaToken = await firstStep();
    const response = await codeLogin(post('/api/auth/login/totp', { mfaToken, code: codeAt(NOW - 30_000) }));
    expect(response.status).toBe(200);
    expect(mocks.userUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { totpLastUsedStep: STEP - 1 } }));
  });

  it('a wrong code counts as a failed sign-in and makes no session', async () => {
    const mfaToken = await firstStep();
    const response = await codeLogin(post('/api/auth/login/totp', { mfaToken, code: codeAt(NOW + 5 * 60_000) }));

    expect(response.status).toBe(401);
    expect(response.cookies.get('helprr-session')).toBeUndefined();
    expect(mocks.createSession).not.toHaveBeenCalled();
    // Every wrong code counts: never the code itself, which the backoff would dedupe.
    expect(mocks.limits.recordUsernameFailure).toHaveBeenCalledWith('member', expect.any(String));
    expect(mocks.limits.recordUsernameFailure.mock.calls[0][1]).not.toBe(codeAt(NOW + 5 * 60_000));
    expect(mocks.limits.recordGlobalLoginFailure).toHaveBeenCalledOnce();
    expect(mocks.recordFailedSignIn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'totp', username: 'member' }));
    expect(mocks.limits.clearUsernameBackoff).not.toHaveBeenCalled();
  });

  it('refuses a code already used in this step (replay)', async () => {
    const mfaToken = await firstStep();
    // The conditional write finds the step already taken.
    mocks.userUpdateMany.mockResolvedValue({ count: 0 });
    const response = await codeLogin(post('/api/auth/login/totp', { mfaToken, code: codeAt(NOW) }));
    expect(response.status).toBe(401);
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.limits.recordUsernameFailure).toHaveBeenCalled();
  });

  it('stops at the username backoff before checking the code', async () => {
    const mfaToken = await firstStep();
    mocks.limits.enforceUsernameBackoff.mockResolvedValue(Response.json({ error: 'Too many' }, { status: 429 }));
    const response = await codeLogin(post('/api/auth/login/totp', { mfaToken, code: codeAt(NOW) }));
    expect(response.status).toBe(429);
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('counts the attempt for the account and the token before checking the code, and clears it on success', async () => {
    const mfaToken = await firstStep();
    await codeLogin(post('/api/auth/login/totp', { mfaToken, code: codeAt(NOW) }));
    const [, { keys, arguments: args }] = mocks.redisEval.mock.calls[0];
    expect(keys[0]).toBe('login:mfa-account:user-1');
    expect(args.slice(1, 2)).toEqual(['10']);
    expect(args[3]).toBe('5');
    // An authenticator code counts against the account's hourly cap.
    expect(args[5]).toBe('1');
    expect(mocks.redisEval.mock.invocationCallOrder[0]).toBeLessThan(mocks.userUpdateMany.mock.invocationCallOrder[0]);
    expect(mocks.redisDel).toHaveBeenCalledWith('login:mfa-account:user-1');
  });

  it('stops at the hourly cap with a countdown, without checking the code', async () => {
    const mfaToken = await firstStep();
    mocks.redisEval.mockResolvedValue(['locked', '120000']);
    const response = await codeLogin(post('/api/auth/login/totp', { mfaToken, code: codeAt(NOW) }));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('120');
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it.each(['used', 'spent'])('a %s pending token asks for the password again and uses up no code', async (reason) => {
    const mfaToken = await firstStep();
    mocks.redisEval.mockResolvedValue([reason, '0']);
    const response = await codeLogin(post('/api/auth/login/totp', { mfaToken, code: codeAt(NOW) }));
    expect(response.status).toBe(401);
    expect((await response.json()).mfaExpired).toBe(true);
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
    expect(mocks.recoveryDeleteMany).not.toHaveBeenCalled();
    expect(mocks.limits.recordUsernameFailure).not.toHaveBeenCalled();
  });

  it('fails closed when the attempt count cannot be kept', async () => {
    const mfaToken = await firstStep();
    mocks.redisEval.mockRejectedValue(new Error('down'));
    const response = await codeLogin(post('/api/auth/login/totp', { mfaToken, code: codeAt(NOW) }));
    expect(response.status).toBe(503);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('a pending token signs in once', async () => {
    const mfaToken = await firstStep();
    mocks.redisSet.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    expect((await codeLogin(post('/api/auth/login/totp', { mfaToken, code: codeAt(NOW) }))).status).toBe(200);
    vi.setSystemTime(NOW + 30_000);
    const again = await codeLogin(post('/api/auth/login/totp', { mfaToken, code: codeAt(NOW + 30_000) }));
    expect(again.status).toBe(401);
    expect((await again.json()).mfaExpired).toBe(true);
    expect(mocks.createSession).toHaveBeenCalledOnce();
  });

  it('fails closed when Redis cannot record the token as used', async () => {
    const mfaToken = await firstStep();
    mocks.redisSet.mockRejectedValue(new Error('down'));
    const response = await codeLogin(post('/api/auth/login/totp', { mfaToken, code: codeAt(NOW) }));
    expect(response.status).toBe(503);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('a pending token expires after five minutes', async () => {
    const mfaToken = await firstStep();
    vi.setSystemTime(NOW + 5 * 60_000 + 1_000);
    const response = await codeLogin(post('/api/auth/login/totp', { mfaToken, code: codeAt(NOW + 5 * 60_000 + 1_000) }));
    expect(response.status).toBe(401);
    expect((await response.json()).mfaExpired).toBe(true);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it.each([
    ['the password changed', () => { user = { ...user, passwordHash: 'new-hash' }; }],
    ['two-step sign-in was turned off', () => { user = { ...user, totpEnabledAt: null }; }],
    ['it was turned off and on again', () => { user = { ...user, totpEnabledAt: new Date('2026-11-07T11:59:00Z') }; }],
    ['the Jellyfin link changed', () => { user = { ...user, jellyfinUserId: 'jf-2' }; }],
    ['the account was disabled', () => { mocks.userFindFirst.mockResolvedValue(null); }],
  ])('a pending token ends when %s', async (_label, change) => {
    const mfaToken = await firstStep();
    change();
    const response = await codeLogin(post('/api/auth/login/totp', { mfaToken, code: codeAt(NOW) }));
    expect(response.status).toBe(401);
    expect((await response.json()).mfaExpired).toBe(true);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('only looks up an active account', async () => {
    const mfaToken = await firstStep();
    await codeLogin(post('/api/auth/login/totp', { mfaToken, code: codeAt(NOW) }));
    expect(mocks.userFindFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: 'user-1', status: 'active' } }));
  });

  it.each([
    ['a session token', async () => new SignJWT({ authenticated: true, sid: 'session-1', uid: 'user-1', role: 'member' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(getJwtSecret())],
    ['a token signed with another secret', async () => new SignJWT({ uid: 'user-1', method: 'password', stamp: 'x' })
      .setProtectedHeader({ alg: 'HS256' }).setAudience('helprr:mfa-pending').setJti('j').setIssuedAt().setExpirationTime('5m')
      .sign(new TextEncoder().encode('another-secret-that-is-also-long-enough-to-sign'))],
    ['a forged stamp', async () => new SignJWT({ uid: 'user-1', method: 'password', stamp: 'forged' })
      .setProtectedHeader({ alg: 'HS256' }).setAudience('helprr:mfa-pending').setJti('j').setIssuedAt().setExpirationTime('5m')
      .sign(getJwtSecret())],
    ['garbage', async () => 'not-a-jwt'],
  ])('refuses %s as a pending token', async (_label, make) => {
    const response = await codeLogin(post('/api/auth/login/totp', { mfaToken: await make(), code: codeAt(NOW) }));
    expect(response.status).toBe(401);
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
  });

  it('a recovery code signs in once and is recorded', async () => {
    const mfaToken = await firstStep();
    mocks.recoveryDeleteMany.mockResolvedValue({ count: 1 });
    const response = await codeLogin(post('/api/auth/login/totp', { mfaToken, code: 'abcd efgh-ijkl-mnop' }));

    expect(response.status).toBe(200);
    expect(mocks.recoveryDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1', codeHash: hashRecoveryCode('ABCDEFGHIJKLMNOP') } });
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'MFA_RECOVERY_CODE_USED' }));
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'LOGIN_SUCCEEDED', fields: ['password', 'recovery-code'],
    }));
  });

  it('a recovery code skips the hourly account cap but still counts for the pending token and the throttles', async () => {
    const mfaToken = await firstStep();
    mocks.recoveryDeleteMany.mockResolvedValue({ count: 0 });
    const response = await codeLogin(post('/api/auth/login/totp', { mfaToken, code: 'ABCD-EFGH-IJKL-MNOP' }));
    expect(response.status).toBe(401);
    const [, { keys, arguments: args }] = mocks.redisEval.mock.calls[0];
    expect(args[4]).toBe('1'); // per-token count on
    expect(args[5]).toBe('0'); // account cap off
    expect(keys[2]).toMatch(/^login:mfa-token-attempts:/);
    expect(mocks.limits.enforceUsernameBackoff).toHaveBeenCalledWith('member');
    expect(mocks.limits.enforceLoginRateLimit).toHaveBeenCalled();
    expect(mocks.limits.recordUsernameFailure).toHaveBeenCalled();
    expect(mocks.limits.recordGlobalLoginFailure).toHaveBeenCalled();
  });

  it('an unknown or used recovery code is a failed sign-in', async () => {
    const mfaToken = await firstStep();
    mocks.recoveryDeleteMany.mockResolvedValue({ count: 0 });
    const response = await codeLogin(post('/api/auth/login/totp', { mfaToken, code: 'ABCD-EFGH-IJKL-MNOP' }));
    expect(response.status).toBe(401);
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.recordFailedSignIn).toHaveBeenCalled();
  });

  it('treats a missing token or code as a malformed request', async () => {
    const response = await codeLogin(post('/api/auth/login/totp', { code: '123456' }));
    expect(response.status).toBe(400);
    expect(mocks.limits.recordMalformedLoginRequest).toHaveBeenCalledOnce();
    expect(mocks.userFindFirst).not.toHaveBeenCalled();
  });
});
