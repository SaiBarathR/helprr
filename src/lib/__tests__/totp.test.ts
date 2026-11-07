import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Secret, TOTP } from 'otpauth';

const mocks = vi.hoisted(() => ({ sessionFindUnique: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { session: { findUnique: mocks.sessionFindUnique } } }));
vi.mock('@/lib/redis', () => ({ getRedisClient: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { verifySession } from '@/lib/auth';
import {
  createMfaPendingToken,
  createTotpSetup,
  generateRecoveryCodes,
  hashRecoveryCode,
  matchTotpStep,
  readMfaPendingToken,
} from '@/lib/totp';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);

beforeEach(() => {
  vi.stubEnv('JWT_SECRET', 'a-valid-session-secret-that-is-longer-than-32-characters');
});
afterEach(() => vi.unstubAllEnvs());

describe('MFA pending token', () => {
  it('is never accepted as a session', async () => {
    const token = await createMfaPendingToken(
      { id: 'user-1', passwordHash: 'h', jellyfinUserId: null, totpEnabledAt: new Date() },
      'password',
    );
    expect(await readMfaPendingToken(token)).toMatchObject({ userId: 'user-1', method: 'password' });
    expect(await verifySession(token)).toBe(false);
    expect(mocks.sessionFindUnique).not.toHaveBeenCalled();
  });

  it('a token with an audience is never a session, even with a session id', async () => {
    const { SignJWT } = await import('jose');
    const token = await new SignJWT({ sid: 'session-1', authenticated: true })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('helprr:mfa-pending')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(process.env.JWT_SECRET));
    expect(await verifySession(token)).toBe(false);
    expect(mocks.sessionFindUnique).not.toHaveBeenCalled();
  });

  it('carries nothing of the password hash', async () => {
    const token = await createMfaPendingToken(
      { id: 'user-1', passwordHash: 'scrypt$secret-hash', jellyfinUserId: null, totpEnabledAt: new Date() },
      'password',
    );
    const payload = Buffer.from(token.split('.')[1], 'base64url').toString('utf8');
    expect(payload).not.toContain('scrypt');
    expect(payload).not.toContain('secret-hash');
  });
});

describe('authenticator codes', () => {
  it('match within one step either side, and not further', () => {
    const setup = createTotpSetup('member');
    const totp = new TOTP({ secret: Secret.fromBase32(setup.secret) });
    const step = Math.floor(NOW / 30_000);
    expect(matchTotpStep(setup.encryptedSecret, totp.generate({ timestamp: NOW }), NOW)).toBe(step);
    expect(matchTotpStep(setup.encryptedSecret, totp.generate({ timestamp: NOW + 30_000 }), NOW)).toBe(step + 1);
    expect(matchTotpStep(setup.encryptedSecret, totp.generate({ timestamp: NOW - 90_000 }), NOW)).toBeNull();
    expect(matchTotpStep(setup.encryptedSecret, 'abcdef', NOW)).toBeNull();
  });

  it('fail closed when the secret was encrypted under an older JWT_SECRET', () => {
    const setup = createTotpSetup('member');
    const code = new TOTP({ secret: Secret.fromBase32(setup.secret) }).generate({ timestamp: NOW });
    vi.stubEnv('JWT_SECRET', 'a-different-session-secret-that-is-also-long-enough');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(matchTotpStep(setup.encryptedSecret, code, NOW)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).not.toContain(setup.secret);
  });
});

describe('recovery codes', () => {
  it('are ten distinct 80-bit codes whose hash ignores case, spaces and dashes', () => {
    const { codes, hashes } = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(hashes[0]).toBe(hashRecoveryCode(codes[0].toLowerCase().replace(/-/g, ' ')));
    expect(hashes[0]).not.toContain(codes[0]);
  });
});
