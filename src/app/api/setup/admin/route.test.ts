import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ needs: vi.fn(), claim: vi.fn(), session: vi.fn(), limit: vi.fn(), backstop: vi.fn() }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/auth', () => ({ COOKIE_NAME: 'helprr-session', SESSION_DURATION: 3600, createSession: mocks.session }));
vi.mock('@/lib/login-rate-limit', () => ({
  getClientIp: () => '10.0.0.5',
  enforceLoginRateLimit: mocks.limit,
  enforceGlobalLoginBackstop: mocks.backstop,
}));
vi.mock('@/lib/first-admin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/first-admin')>();
  return { ...actual, needsFirstAdmin: mocks.needs, claimFirstAdmin: mocks.claim };
});

import { POST } from './route';
import { GET as state } from '../state/route';
import { FirstAdminInputError, FirstAdminTakenError, isSameOriginRequest } from '@/lib/first-admin';

const post = (headers: Record<string, string> = {}, body: unknown = { username: 'admin', password: 'a-long-first-admin-password' }) =>
  POST(new NextRequest('http://helprr.lan:3050/api/setup/admin', {
    method: 'POST',
    headers: { host: 'helprr.lan:3050', origin: 'http://helprr.lan:3050', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.needs.mockResolvedValue(true);
  mocks.claim.mockResolvedValue({ id: 'user-bootstrap-admin', role: 'admin' });
  mocks.session.mockResolvedValue('token-123');
  mocks.limit.mockResolvedValue(null);
  mocks.backstop.mockResolvedValue(null);
});

describe('POST /api/setup/admin', () => {
  it('creates the admin and signs them in with the normal cookie', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('helprr-session=token-123');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(mocks.session).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-bootstrap-admin', role: 'admin' }));
  });

  it('is gone once any user exists', async () => {
    mocks.needs.mockResolvedValue(false);
    expect((await post()).status).toBe(404);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it.each([
    ['another site', { origin: 'https://evil.example' }],
    ['no origin', { origin: '' }],
    ['a cross-site fetch', { 'sec-fetch-site': 'cross-site' }],
  ])('refuses %s', async (_label, headers) => {
    expect((await post(headers)).status).toBe(403);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('refuses a form post (not JSON)', async () => {
    expect((await post({ 'content-type': 'application/x-www-form-urlencoded' })).status).toBe(415);
  });

  it('is rate limited like sign-in', async () => {
    mocks.limit.mockResolvedValue(new Response(null, { status: 429 }));
    expect((await post()).status).toBe(429);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('says what is wrong with the input', async () => {
    mocks.claim.mockRejectedValue(new FirstAdminInputError('Password must contain at least 15 characters'));
    const res = await post();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Password must contain at least 15 characters' });
  });

  it('tells the loser of a race to sign in', async () => {
    mocks.claim.mockRejectedValue(new FirstAdminTakenError());
    expect((await post()).status).toBe(409);
    expect(mocks.session).not.toHaveBeenCalled();
  });
});

describe('GET /api/setup/state', () => {
  it('says only whether the first admin is needed', async () => {
    mocks.needs.mockResolvedValue(true);
    expect(await (await (state as unknown as () => Promise<Response>)()).json()).toEqual({ needsAdmin: true });
  });
});

describe('isSameOriginRequest', () => {
  const req = (headers: Record<string, string>) => new Request('http://helprr.lan/x', { headers });
  it.each([
    [{ host: 'helprr.lan', origin: 'http://helprr.lan' }, true],
    [{ host: 'helprr.lan', origin: 'http://helprr.lan', 'sec-fetch-site': 'same-origin' }, true],
    [{ host: 'helprr.lan', origin: 'http://other.lan' }, false],
    [{ host: 'helprr.lan' }, false],
    [{ host: 'helprr.lan', origin: 'http://helprr.lan', 'sec-fetch-site': 'same-site' }, false],
    [{ host: 'helprr.lan', origin: 'not a url' }, false],
  ])('%j → %s', (headers, expected) => {
    expect(isSameOriginRequest(req(headers))).toBe(expected);
  });
});
