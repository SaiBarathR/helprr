import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.stubEnv('JWT_SECRET', 'a-test-jwt-secret-that-is-long-enough-for-hs256');

import { proxy } from '@/proxy';

// A personal API token opens the two status API paths, for GET only, without a
// session. Sent anywhere else it is refused before any route runs, even with a
// valid session or on a public path. The status API never opens with a session.

const TOKEN = `hlp_${'a'.repeat(43)}`;
const passed = (response: Response) => response.headers.get('x-middleware-next') === '1';

async function sessionCookie(): Promise<string> {
  const jwt = await new SignJWT({ authenticated: true, sid: 'session-1', uid: 'u1', role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
  return `helprr-session=${jwt}`;
}

function request(path: string, init: { method?: string; authorization?: string; cookie?: string } = {}) {
  const headers: Record<string, string> = {};
  if (init.authorization) headers.authorization = init.authorization;
  if (init.cookie) headers.cookie = init.cookie;
  return new NextRequest(`http://localhost${path}`, { method: init.method ?? 'GET', headers });
}

describe('status API in the proxy', () => {
  it.each(['/api/v1/summary', '/api/v1/queue', '/api/v1/summary?x=1'])('lets a bearer token GET %s without a session', async (path) => {
    expect(passed(await proxy(request(path, { authorization: `Bearer ${TOKEN}` })))).toBe(true);
    expect(passed(await proxy(request(path, { authorization: `bearer ${TOKEN}` })))).toBe(true);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])('refuses %s to the status API, even with a token', async (method) => {
    const response = await proxy(request('/api/v1/summary', { method, authorization: `Bearer ${TOKEN}` }));
    expect(passed(response)).toBe(false);
    expect(response.status).toBe(401);
    // No CORS: nothing invites another site to read it.
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('does not open the status API with a session cookie', async () => {
    const cookie = await sessionCookie();
    for (const path of ['/api/v1/summary', '/api/v1/queue']) {
      const response = await proxy(request(path, { cookie }));
      expect(passed(response)).toBe(false);
      expect(response.status).toBe(401);
    }
    // The cookie itself is good: it opens an ordinary route.
    expect(passed(await proxy(request('/api/activity/queue', { cookie })))).toBe(true);
  });

  it.each([
    '/api/activity/queue',
    '/api/me',
    '/api/me/api-tokens',
    '/api/sessions',
    '/api/v1',
    '/api/v1/',
    '/api/v1/summary/',
    '/api/v1/summaryx',
    '/api/v1/other',
    '/api/V1/summary',
    '/api/health',
    '/api/auth/login',
    '/api/calendar/feed.ics',
    '/api/share',
    '/settings/sessions',
    '/login',
  ])('refuses a bearer token on %s, with or without a session', async (path) => {
    for (const cookie of [undefined, await sessionCookie()]) {
      const response = await proxy(request(path, { authorization: `Bearer ${TOKEN}`, cookie }));
      expect(passed(response), path).toBe(false);
      expect(response.status).toBe(401);
    }
  });

  it('leaves other Authorization headers to the usual rules', async () => {
    // A reverse proxy's basic auth must not lock anyone out.
    expect(passed(await proxy(request('/api/health', { authorization: 'Basic dXNlcjpwYXNz' })))).toBe(true);
    expect(passed(await proxy(request('/api/me', { authorization: 'Bearer some-other-token', cookie: await sessionCookie() })))).toBe(true);
    // And it never opens the status API.
    const response = await proxy(request('/api/v1/summary', { authorization: 'Bearer some-other-token' }));
    expect(response.status).toBe(401);
  });
});
