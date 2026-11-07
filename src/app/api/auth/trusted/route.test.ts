import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Trusted-header sign-in with the real config and secret check, and the
// database, sessions, throttles and audit mocked.

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  createSession: vi.fn(),
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

vi.mock('@/lib/db', () => ({ prisma: { user: { findUnique: mocks.findUnique } } }));
vi.mock('@/lib/auth', () => ({ createSession: mocks.createSession, COOKIE_NAME: 'helprr-session', SESSION_DURATION: 60 }));
vi.mock('@/lib/login-rate-limit', () => ({ getClientIp: () => '203.0.113.9', ...mocks.limits }));
vi.mock('@/lib/security-audit', () => ({
  recordFailedSignIn: mocks.recordFailedSignIn,
  recordSecurityEvent: mocks.recordSecurityEvent,
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/request-utils', () => ({ isHttpsRequest: () => false }));

import { GET, POST } from './route';

const SECRET = 'proxy-secret-0123456789abcdefghijklmnop';
const ACTIVE = { id: 'user-1', username: 'Alice', role: 'member', status: 'active' };

function post(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/auth/trusted', {
    method: 'POST',
    body: '{}',
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function get(cookie?: string): NextRequest {
  return new NextRequest('http://localhost/api/auth/trusted', cookie ? { headers: { cookie } } : undefined);
}

function fromProxy(user: string, extra: Record<string, string> = {}): NextRequest {
  return post({ 'Remote-User': user, 'X-Helprr-Proxy-Secret': SECRET, ...extra });
}

function enable(env: Record<string, string> = {}) {
  vi.stubEnv('HELPRR_TRUSTED_AUTH_HEADER', 'Remote-User');
  vi.stubEnv('HELPRR_TRUSTED_AUTH_SECRET', SECRET);
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('HELPRR_TRUSTED_AUTH_HEADER', '');
  vi.stubEnv('HELPRR_TRUSTED_AUTH_SECRET_HEADER', '');
  vi.stubEnv('HELPRR_TRUSTED_AUTH_SECRET', '');
  vi.stubEnv('JWT_SECRET', 'a-valid-session-secret-that-is-longer-than-32-characters');
  for (const fn of Object.values(mocks.limits)) fn.mockResolvedValue(null);
  mocks.createSession.mockResolvedValue('session-token');
  mocks.findUnique.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function expectNoSession(response: Response) {
  expect(mocks.createSession).not.toHaveBeenCalled();
  expect(response.headers.get('set-cookie')).toBeNull();
}

describe('trusted-header sign-in', () => {
  it('is off by default: GET says so, POST is a 404 that touches nothing', async () => {
    expect(await (await GET(get())).json()).toEqual({ enabled: false });
    const response = await POST(fromProxy('Alice'));
    expect(response.status).toBe(404);
    expectNoSession(response);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.limits.enforceLoginRateLimit).not.toHaveBeenCalled();
  });

  it.each([
    ['a short secret', { HELPRR_TRUSTED_AUTH_SECRET: 'too-short' }],
    ['no user header', { HELPRR_TRUSTED_AUTH_HEADER: '' }],
    ['a placeholder secret', { HELPRR_TRUSTED_AUTH_SECRET: 'change-me-0123456789abcdefghijklmnopqr' }],
    ['the session secret reused', { HELPRR_TRUSTED_AUTH_SECRET: 'a-valid-session-secret-that-is-longer-than-32-characters' }],
    ['the same header twice', { HELPRR_TRUSTED_AUTH_SECRET_HEADER: 'remote-user' }],
  ])('stays off with %s', async (_label, env) => {
    enable(env);
    expect(await (await GET(get())).json()).toEqual({ enabled: false });
    const response = await POST(fromProxy('Alice'));
    expect(response.status).toBe(404);
    expectNoSession(response);
  });

  it('signs an active user in with a normal session and an audit row', async () => {
    enable();
    mocks.findUnique.mockResolvedValue(ACTIVE);
    expect(await (await GET(get())).json()).toEqual({ enabled: true, signedOut: false });

    const response = await POST(fromProxy('Alice', { 'user-agent': 'Safari' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toContain('helprr-session=session-token');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(mocks.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { username: 'Alice' } }));
    expect(mocks.createSession).toHaveBeenCalledWith({
      userId: 'user-1',
      role: 'member',
      userAgent: 'Safari',
      ip: '203.0.113.9',
      trusted: { username: 'Alice', sessionStamp: expect.stringMatching(/^[\w-]{22}$/) },
    });
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'LOGIN_SUCCEEDED',
      targetId: 'user-1',
      fields: ['trusted-header'],
    }));
    expect(mocks.limits.clearUsernameBackoff).toHaveBeenCalledWith('Alice');
    expect(mocks.limits.clearLoginAttempts).toHaveBeenCalledWith('203.0.113.9');
  });

  it('after a sign-out, GET says so, yet a deliberate POST still signs in and clears the marker', async () => {
    enable();
    mocks.findUnique.mockResolvedValue(ACTIVE);
    expect(await (await GET(get('helprr-signed-out=1'))).json()).toEqual({ enabled: true, signedOut: true });

    const response = await POST(fromProxy('Alice', { cookie: 'helprr-signed-out=1' }));
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith('helprr-session=session-token'))).toBe(true);
    expect(cookies.some((c) => c.startsWith('helprr-signed-out=;') && c.includes('Max-Age=0'))).toBe(true);
  });

  it('says nothing about the marker while proxy sign-in is off', async () => {
    expect(await (await GET(get('helprr-signed-out=1'))).json()).toEqual({ enabled: false });
  });

  it('skips two-step sign-in: the proxy is the second factor', async () => {
    enable();
    mocks.findUnique.mockResolvedValue({ ...ACTIVE, totpEnabledAt: new Date('2026-11-01T00:00:00Z') });
    const response = await POST(fromProxy('Alice'));
    const body = await response.json();
    expect(body).toEqual({ success: true });
    expect(body.mfaRequired).toBeUndefined();
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
  });

  it('refuses a request without the secret header, quietly, as not from the proxy', async () => {
    enable();
    mocks.findUnique.mockResolvedValue(ACTIVE);
    const response = await POST(post({ 'Remote-User': 'Alice' }));
    expect(response.status).toBe(401);
    expectNoSession(response);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.limits.recordMalformedLoginRequest).toHaveBeenCalledTimes(1);
    expect(mocks.limits.recordGlobalLoginFailure).not.toHaveBeenCalled();
    // Loading the login page some other way spends no sign-in attempts.
    expect(mocks.limits.enforceLoginRateLimit).not.toHaveBeenCalled();
  });

  it.each([
    ['a wrong secret of the same length', `${SECRET.slice(0, -1)}X`],
    ['a shorter secret', SECRET.slice(0, 20)],
    ['a longer secret', `${SECRET}x`],
    ['the secret after a client-sent copy', `forged, ${SECRET}`],
    ['an empty secret', ''],
  ])('refuses %s and counts it as a failed sign-in', async (_label, secret) => {
    enable();
    mocks.findUnique.mockResolvedValue(ACTIVE);
    const response = await POST(post({ 'Remote-User': 'Alice', 'X-Helprr-Proxy-Secret': secret }));
    expect(response.status).toBe(401);
    expectNoSession(response);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.limits.recordGlobalLoginFailure).toHaveBeenCalledTimes(1);
    expect(mocks.recordFailedSignIn).toHaveBeenCalledWith(expect.anything(), {
      username: 'Alice',
      method: 'trusted-header-secret',
      user: null,
    });
    // The response never echoes what was sent.
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain(SECRET);
    if (secret) expect(text).not.toContain(secret);
  });

  it('honors the throttles before checking anything', async () => {
    enable();
    mocks.limits.enforceGlobalLoginBackstop.mockResolvedValue(Response.json({ error: 'Too many' }, { status: 429 }));
    const response = await POST(fromProxy('Alice'));
    expect(response.status).toBe(429);
    expectNoSession(response);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('honors the per-IP limit once the request carries a secret', async () => {
    enable();
    mocks.limits.enforceLoginRateLimit.mockResolvedValue(Response.json({ error: 'Too many' }, { status: 429 }));
    const response = await POST(fromProxy('Alice'));
    expect(response.status).toBe(429);
    expectNoSession(response);
    expect(mocks.limits.enforceLoginRateLimit).toHaveBeenCalledWith('203.0.113.9');
  });

  it('ignores the password backoff: the proxy vouched for the name, so nobody is guessing', async () => {
    enable();
    mocks.findUnique.mockResolvedValue(ACTIVE);
    mocks.limits.enforceUsernameBackoff.mockResolvedValue(Response.json({ error: 'Too many' }, { status: 429 }));
    const response = await POST(fromProxy('Alice'));
    expect(response.status).toBe(200);
    expect(mocks.limits.enforceUsernameBackoff).not.toHaveBeenCalled();
  });

  it('reads the headers whatever case the setting and the request use', async () => {
    enable({ HELPRR_TRUSTED_AUTH_HEADER: 'REMOTE-USER', HELPRR_TRUSTED_AUTH_SECRET_HEADER: 'x-proxy-key' });
    mocks.findUnique.mockResolvedValue(ACTIVE);
    const response = await POST(post({ 'remote-user': 'Alice', 'X-PROXY-KEY': SECRET }));
    expect(response.status).toBe(200);
    // The default secret header no longer counts once another is named.
    const defaultHeader = await POST(fromProxy('Alice'));
    expect(defaultHeader.status).toBe(401);
  });

  it('matches the name exactly, as password sign-in does: no case folding, no wildcards', async () => {
    enable();
    mocks.findUnique.mockImplementation(async ({ where }: { where: { username: string } }) => (
      where.username === 'Alice' ? ACTIVE : null
    ));
    for (const name of ['alice', 'ALICE', 'A_ice', 'Al%', '%']) {
      const response = await POST(fromProxy(name));
      expect(response.status).toBe(403);
      expectNoSession(response);
    }
    expect(mocks.findUnique.mock.calls.map(([args]) => args.where)).toEqual(
      ['alice', 'ALICE', 'A_ice', 'Al%', '%'].map((username) => ({ username })),
    );
    // Surrounding spaces are trimmed, as for a typed name.
    expect((await POST(fromProxy('  Alice  '))).status).toBe(200);
  });

  it.each(['disabled', 'pending'])('refuses a %s account', async (status) => {
    enable();
    mocks.findUnique.mockResolvedValue({ ...ACTIVE, status });
    const response = await POST(fromProxy('Alice'));
    expect(response.status).toBe(403);
    expectNoSession(response);
  });

  it('never creates an account for an unknown name, and records the failure', async () => {
    enable();
    const response = await POST(fromProxy('mallory'));
    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain('no active Helprr account');
    expectNoSession(response);
    expect(mocks.limits.recordUsernameFailure).not.toHaveBeenCalled();
    expect(mocks.limits.recordGlobalLoginFailure).not.toHaveBeenCalled();
    expect(mocks.recordFailedSignIn).toHaveBeenCalledWith(expect.anything(), {
      username: 'mallory',
      method: 'trusted-header-no-account',
      nameIsAccount: true,
    });
  });

  it.each([['no name', ''], ['a blank name', '   ']])('says the proxy sent %s', async (_label, name) => {
    enable();
    const response = await POST(fromProxy(name));
    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain('sent no username');
    expectNoSession(response);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('refuses an overlong name without looking it up, and audits it masked', async () => {
    enable();
    const response = await POST(fromProxy('x'.repeat(65)));
    expect(response.status).toBe(403);
    expectNoSession(response);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.recordFailedSignIn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ user: null }));
  });

  it.each([
    ['a form post', { 'content-type': 'application/x-www-form-urlencoded' }],
    ['a plain-text post', { 'content-type': 'text/plain' }],
    ['a cross-site request', { 'sec-fetch-site': 'cross-site' }],
    ['a same-site request from another origin', { 'sec-fetch-site': 'same-site' }],
  ])('refuses %s (CSRF)', async (_label, headers) => {
    enable();
    mocks.findUnique.mockResolvedValue(ACTIVE);
    const response = await POST(fromProxy('Alice', headers));
    expect(response.status).toBe(403);
    expectNoSession(response);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('accepts a same-origin fetch', async () => {
    enable();
    mocks.findUnique.mockResolvedValue(ACTIVE);
    const response = await POST(fromProxy('Alice', { 'sec-fetch-site': 'same-origin' }));
    expect(response.status).toBe(200);
  });

  it('never writes the secret to the console', async () => {
    enable();
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => undefined));
    mocks.limits.clearLoginAttempts.mockRejectedValue(new Error('redis down'));
    mocks.findUnique.mockResolvedValue(ACTIVE);
    await POST(fromProxy('Alice'));
    await POST(post({ 'Remote-User': 'Alice', 'X-Helprr-Proxy-Secret': `${SECRET}x` }));
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
      spy.mockRestore();
    }
  });
});
