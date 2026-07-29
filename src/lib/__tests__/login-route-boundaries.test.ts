import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { LOGIN_BODY_MAX_BYTES } from '@/lib/server/login-input';

const mocks = vi.hoisted(() => ({
  userFindFirst: vi.fn(),
  userUpdate: vi.fn(),
  createSession: vi.fn(),
  verifyUserPassword: vi.fn(),
  verifyPasswordHash: vi.fn(),
  getDummyPasswordHash: vi.fn(),
  getClientIp: vi.fn(),
  enforceLoginRateLimit: vi.fn(),
  clearLoginAttempts: vi.fn(),
  enforceUsernameBackoff: vi.fn(),
  recordUsernameFailure: vi.fn(),
  clearUsernameBackoff: vi.fn(),
  enforceGlobalLoginBackstop: vi.fn(),
  recordGlobalLoginFailure: vi.fn(),
  enforceMalformedLoginBackstop: vi.fn(),
  recordMalformedLoginRequest: vi.fn(),
  authenticateByName: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findFirst: mocks.userFindFirst,
      update: mocks.userUpdate,
    },
    serviceConnection: {
      findFirst: vi.fn(),
    },
  },
}));
vi.mock('@/lib/auth', () => ({
  createSession: mocks.createSession,
  verifyUserPassword: mocks.verifyUserPassword,
  COOKIE_NAME: 'helprr-session',
  SESSION_DURATION: 60,
}));
vi.mock('@/lib/password', () => ({
  verifyPasswordHash: mocks.verifyPasswordHash,
  getDummyPasswordHash: mocks.getDummyPasswordHash,
}));
vi.mock('@/lib/login-rate-limit', () => ({
  getClientIp: mocks.getClientIp,
  enforceLoginRateLimit: mocks.enforceLoginRateLimit,
  clearLoginAttempts: mocks.clearLoginAttempts,
  enforceUsernameBackoff: mocks.enforceUsernameBackoff,
  recordUsernameFailure: mocks.recordUsernameFailure,
  clearUsernameBackoff: mocks.clearUsernameBackoff,
  enforceGlobalLoginBackstop: mocks.enforceGlobalLoginBackstop,
  recordGlobalLoginFailure: mocks.recordGlobalLoginFailure,
  enforceMalformedLoginBackstop: mocks.enforceMalformedLoginBackstop,
  recordMalformedLoginRequest: mocks.recordMalformedLoginRequest,
}));
vi.mock('@/lib/jellyfin-client', () => ({
  JellyfinClient: { authenticateByName: mocks.authenticateByName },
}));
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown) => handler,
}));
vi.mock('@/lib/request-utils', () => ({ isHttpsRequest: () => false }));

import { prisma } from '@/lib/db';
import { POST as localLogin } from '@/app/api/auth/login/route';
import { POST as jellyfinLogin } from '@/app/api/auth/jellyfin/route';

function jsonRequest(raw: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    body: raw,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function exactSizeLoginBody(size: number): string {
  const base = JSON.stringify({ username: 'member', password: 'password', padding: '' });
  const paddingLength = size - Buffer.byteLength(base, 'utf8');
  if (paddingLength < 0) throw new Error('Requested body size is too small');
  return JSON.stringify({
    username: 'member',
    password: 'password',
    padding: 'x'.repeat(paddingLength),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClientIp.mockReturnValue(undefined);
  mocks.enforceLoginRateLimit.mockResolvedValue(null);
  mocks.enforceUsernameBackoff.mockResolvedValue(null);
  mocks.enforceGlobalLoginBackstop.mockResolvedValue(null);
  mocks.enforceMalformedLoginBackstop.mockResolvedValue(null);
  mocks.recordMalformedLoginRequest.mockResolvedValue(null);
  mocks.createSession.mockResolvedValue('session-token');
  mocks.verifyUserPassword.mockResolvedValue(true);
  mocks.getDummyPasswordHash.mockResolvedValue('dummy-hash');
  mocks.verifyPasswordHash.mockResolvedValue(false);
  mocks.userFindFirst.mockResolvedValue({
    id: 'user-1',
    role: 'member',
    passwordHash: 'stored-hash',
  });
});

describe('credential route request boundaries', () => {
  it('accepts a valid credential JSON body exactly at 8 KiB', async () => {
    const raw = exactSizeLoginBody(LOGIN_BODY_MAX_BYTES);
    expect(Buffer.byteLength(raw, 'utf8')).toBe(LOGIN_BODY_MAX_BYTES);

    const response = await localLogin(jsonRequest(raw));

    expect(response.status).toBe(200);
    expect(mocks.userFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { username: 'member', status: 'active' },
    }));
  });

  it.each([
    ['declared', { 'content-length': String(LOGIN_BODY_MAX_BYTES + 1) }],
    ['spoofed', { 'content-length': '1' }],
    ['missing', {}],
  ])('rejects a one-byte-over %s body before username, Prisma, or password work', async (
    _label,
    headers,
  ) => {
    const raw = exactSizeLoginBody(LOGIN_BODY_MAX_BYTES + 1);
    const response = await localLogin(jsonRequest(raw, headers));

    expect(response.status).toBe(413);
    expect(mocks.enforceUsernameBackoff).not.toHaveBeenCalled();
    expect(mocks.userFindFirst).not.toHaveBeenCalled();
    expect(mocks.verifyUserPassword).not.toHaveBeenCalled();
    expect(mocks.verifyPasswordHash).not.toHaveBeenCalled();
    expect(mocks.recordMalformedLoginRequest).toHaveBeenCalledOnce();
  });

  it.each([
    ['wrong content type', 'username=member', { 'content-type': 'application/x-www-form-urlencoded' }, 415],
    ['malformed JSON', '{"username":', {}, 400],
    ['empty password', JSON.stringify({ username: 'member', password: '' }), {}, 400],
    ['long username', JSON.stringify({ username: '🧪'.repeat(65), password: 'password' }), {}, 400],
    ['long UTF-8 password', JSON.stringify({ username: 'member', password: '🧪'.repeat(257) }), {}, 400],
  ])('rejects %s before credential verification', async (
    _label,
    raw,
    headers,
    status,
  ) => {
    const response = await localLogin(jsonRequest(raw, headers));

    expect(response.status).toBe(status);
    expect(mocks.userFindFirst).not.toHaveBeenCalled();
    expect(mocks.enforceUsernameBackoff).not.toHaveBeenCalled();
    expect(mocks.recordMalformedLoginRequest).toHaveBeenCalledOnce();
  });

  it('applies the same bounded input validation to Jellyfin login', async () => {
    const response = await jellyfinLogin(jsonRequest(
      exactSizeLoginBody(LOGIN_BODY_MAX_BYTES + 1),
      { 'content-length': '1' },
    ));

    expect(response.status).toBe(413);
    expect(prisma.serviceConnection.findFirst).not.toHaveBeenCalled();
    expect(mocks.authenticateByName).not.toHaveBeenCalled();
  });
});
