import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// A trusted-header session stays valid only while the proxy still names its
// user: at the request proxy and in server auth, with real signed tokens.

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
import { trustedSessionStillVouched } from '@/lib/trusted-session';

const ACTIVE_SESSION = {
  id: 'session-1',
  lastSeenAt: new Date(),
  revokedAt: null,
  userId: 'user-1',
  user: { id: 'user-1', username: 'Alice', role: 'member', status: 'active' },
};

async function tokenFor(trustedUsername?: string): Promise<string> {
  mocks.sessionCreate.mockResolvedValue({ id: 'session-1' });
  return createSession({ userId: 'user-1', role: 'member', ...(trustedUsername ? { trustedUsername } : {}) });
}

function pageRequest(token: string, headers: Record<string, string> = {}, path = '/movies'): NextRequest {
  return new NextRequest(`http://localhost${path}`, { headers: { cookie: `helprr-session=${token}`, ...headers } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('HELPRR_TRUSTED_AUTH_HEADER', 'Remote-User');
  mocks.sessionFindUnique.mockResolvedValue(ACTIVE_SESSION);
});

afterEach(() => {
  vi.stubEnv('HELPRR_TRUSTED_AUTH_HEADER', '');
});

describe('trustedSessionStillVouched', () => {
  const env = { HELPRR_TRUSTED_AUTH_HEADER: 'Remote-User' };
  const headers = (values: Record<string, string>) => new Headers(values);

  it('leaves every other session alone', () => {
    expect(trustedSessionStillVouched(undefined, headers({}), {})).toBe(true);
  });

  it('needs the proxy to name the same user, header name in any case', () => {
    expect(trustedSessionStillVouched('Alice', headers({ 'remote-user': 'Alice' }), env)).toBe(true);
    expect(trustedSessionStillVouched('Alice', headers({ 'REMOTE-USER': ' Alice ' }), env)).toBe(true);
    expect(trustedSessionStillVouched('Alice', headers({ 'Remote-User': 'Bob' }), env)).toBe(false);
    expect(trustedSessionStillVouched('Alice', headers({ 'Remote-User': 'alice' }), env)).toBe(false);
    expect(trustedSessionStillVouched('Alice', headers({}), env)).toBe(false);
  });

  it('ends the session once the feature is turned off, or the claim is malformed', () => {
    expect(trustedSessionStillVouched('Alice', headers({ 'Remote-User': 'Alice' }), {})).toBe(false);
    expect(trustedSessionStillVouched('', headers({ 'Remote-User': '' }), env)).toBe(false);
    expect(trustedSessionStillVouched(42, headers({ 'Remote-User': '42' }), env)).toBe(false);
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

  it('never reads the request headers for any other session', async () => {
    const auth = await asRequest(await tokenFor(), {});
    expect(auth.ok).toBe(true);
    expect(mocks.headers).not.toHaveBeenCalled();
  });
});
