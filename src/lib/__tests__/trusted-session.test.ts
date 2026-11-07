import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// A trusted-header session stays valid only while trusted-header sign-in is
// validly on with the same secret and the proxy still names its user: at the
// request proxy and in server auth, with real signed tokens.

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  cookies: vi.fn(),
  sessionCreate: vi.fn(),
  sessionFindUnique: vi.fn(),
}));

vi.mock('react', () => ({ cache: (fn: unknown) => fn }));
vi.mock('next/headers', () => ({ cookies: mocks.cookies, headers: mocks.headers }));
vi.mock('@/lib/db', () => ({
  prisma: { session: { create: mocks.sessionCreate, findUnique: mocks.sessionFindUnique, update: vi.fn() } },
}));

vi.stubEnv('JWT_SECRET', 'a-valid-session-secret-that-is-longer-than-32-characters');

import { createSession, requireUser } from '@/lib/auth';
import { proxy } from '@/proxy';
import { getTrustedAuthConfig } from '@/lib/trusted-auth';
import { trustedSessionStillVouched } from '@/lib/trusted-session';

const SECRET = 'proxy-secret-0123456789abcdefghijklmnop';
const ENV = { HELPRR_TRUSTED_AUTH_HEADER: 'Remote-User', HELPRR_TRUSTED_AUTH_SECRET: SECRET };
const ACTIVE_SESSION = {
  id: 'session-1',
  lastSeenAt: new Date(),
  revokedAt: null,
  userId: 'user-1',
  user: { id: 'user-1', username: 'Alice', role: 'member', status: 'active' },
};

function stamp(env: Record<string, string> = ENV): string {
  return getTrustedAuthConfig(env)!.sessionStamp;
}

async function tokenFor(trustedUsername?: string): Promise<string> {
  mocks.sessionCreate.mockResolvedValue({ id: 'session-1' });
  return createSession({
    userId: 'user-1',
    role: 'member',
    ...(trustedUsername ? { trusted: { username: trustedUsername, sessionStamp: stamp() } } : {}),
  });
}

function pageRequest(token: string, headers: Record<string, string> = {}, path = '/movies'): NextRequest {
  return new NextRequest(`http://localhost${path}`, { headers: { cookie: `helprr-session=${token}`, ...headers } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('HELPRR_TRUSTED_AUTH_HEADER', ENV.HELPRR_TRUSTED_AUTH_HEADER);
  vi.stubEnv('HELPRR_TRUSTED_AUTH_SECRET', ENV.HELPRR_TRUSTED_AUTH_SECRET);
  vi.stubEnv('HELPRR_TRUSTED_AUTH_SECRET_HEADER', '');
  mocks.sessionFindUnique.mockResolvedValue(ACTIVE_SESSION);
});

describe('trustedSessionStillVouched', () => {
  const headers = (values: Record<string, string>) => new Headers(values);
  const claims = (tu: unknown, ts: unknown = stamp()) => ({ tu, ts });

  it('leaves every other session alone', () => {
    expect(trustedSessionStillVouched({ sid: 's' }, headers({}), {})).toBe(true);
  });

  it('needs the proxy to name the same user, header name in any case', () => {
    expect(trustedSessionStillVouched(claims('Alice'), headers({ 'remote-user': 'Alice' }), ENV)).toBe(true);
    expect(trustedSessionStillVouched(claims('Alice'), headers({ 'REMOTE-USER': ' Alice ' }), ENV)).toBe(true);
    expect(trustedSessionStillVouched(claims('Alice'), headers({ 'Remote-User': 'Bob' }), ENV)).toBe(false);
    expect(trustedSessionStillVouched(claims('Alice'), headers({ 'Remote-User': 'alice' }), ENV)).toBe(false);
    expect(trustedSessionStillVouched(claims('Alice'), headers({}), ENV)).toBe(false);
  });

  it('ends the session when the secret changes, the feature is off or invalid, or a claim is malformed', () => {
    const named = headers({ 'Remote-User': 'Alice' });
    const other = { ...ENV, HELPRR_TRUSTED_AUTH_SECRET: `${SECRET}-rotated` };
    expect(stamp(other)).not.toBe(stamp());
    expect(trustedSessionStillVouched(claims('Alice'), named, other)).toBe(false);
    expect(trustedSessionStillVouched(claims('Alice'), named, { HELPRR_TRUSTED_AUTH_HEADER: 'Remote-User' })).toBe(false);
    expect(trustedSessionStillVouched(claims('Alice'), named, { ...ENV, HELPRR_TRUSTED_AUTH_SECRET: 'short' })).toBe(false);
    expect(trustedSessionStillVouched(claims('Alice'), named, {})).toBe(false);
    expect(trustedSessionStillVouched({ tu: 'Alice' }, named, ENV)).toBe(false);
    expect(trustedSessionStillVouched({ ts: stamp() }, named, ENV)).toBe(false);
    expect(trustedSessionStillVouched(claims('Alice', null), named, ENV)).toBe(false);
    expect(trustedSessionStillVouched(claims(''), headers({ 'Remote-User': '' }), ENV)).toBe(false);
    expect(trustedSessionStillVouched(claims(42), headers({ 'Remote-User': '42' }), ENV)).toBe(false);
  });

  it('stamps the session with an HMAC that reveals nothing of the secret', () => {
    expect(stamp()).toMatch(/^[\w-]{22}$/);
    expect(SECRET).not.toContain(stamp());
  });
});

describe('the request proxy', () => {
  it('lets a trusted session through while the proxy names its user', async () => {
    const response = await proxy(pageRequest(await tokenFor('Alice'), { 'Remote-User': 'Alice' }));
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('sends a page to Login once the proxy names someone else, or no one', async () => {
    const token = await tokenFor('Alice');
    for (const headers of [{ 'Remote-User': 'Bob' }, {}] as Record<string, string>[]) {
      const response = await proxy(pageRequest(token, headers));
      expect(response.headers.get('x-middleware-next')).toBeNull();
      expect(response.headers.get('location')).toContain('/login');
    }
  });

  it('ends a trusted session once the secret is changed', async () => {
    const token = await tokenFor('Alice');
    vi.stubEnv('HELPRR_TRUSTED_AUTH_SECRET', `${SECRET}-rotated`);
    const response = await proxy(pageRequest(token, { 'Remote-User': 'Alice' }, '/api/me'));
    expect(response.status).toBe(401);
  });

  it('answers an API call 401 once the proxy names someone else', async () => {
    const response = await proxy(pageRequest(await tokenFor('Alice'), { 'Remote-User': 'Bob' }, '/api/me'));
    expect(response.status).toBe(401);
  });

  it('keeps a password session whatever the header says', async () => {
    const response = await proxy(pageRequest(await tokenFor(), { 'Remote-User': 'Bob' }));
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
});

describe('server auth', () => {
  async function asRequest(token: string, headerValues: Record<string, string>) {
    mocks.cookies.mockResolvedValue({ get: () => ({ value: token }) });
    mocks.headers.mockResolvedValue(new Headers(headerValues));
    return requireUser();
  }

  it('accepts a trusted session while the proxy names its user', async () => {
    const auth = await asRequest(await tokenFor('Alice'), { 'Remote-User': 'Alice' });
    expect(auth.ok).toBe(true);
  });

  it('refuses it once the proxy names someone else, before loading the session', async () => {
    const auth = await asRequest(await tokenFor('Alice'), { 'Remote-User': 'Bob' });
    expect(auth.ok).toBe(false);
    expect(mocks.sessionFindUnique).not.toHaveBeenCalled();
  });

  it('refuses it once the feature is turned off', async () => {
    const token = await tokenFor('Alice');
    vi.stubEnv('HELPRR_TRUSTED_AUTH_SECRET', '');
    const auth = await asRequest(token, { 'Remote-User': 'Alice' });
    expect(auth.ok).toBe(false);
  });

  it('never reads the request headers for any other session', async () => {
    const auth = await asRequest(await tokenFor(), {});
    expect(auth.ok).toBe(true);
    expect(mocks.headers).not.toHaveBeenCalled();
  });
});
