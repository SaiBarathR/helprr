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
import { FirstAdminBusyError, FirstAdminInputError, FirstAdminTakenError, isAllowedSetupOrigin, isLocalHostname, resetClaimSlots } from '@/lib/first-admin';

const post = (headers: Record<string, string> = {}, body: unknown = { username: 'admin', password: 'a-long-first-admin-password' }) =>
  POST(new NextRequest('http://helprr.lan:3050/api/setup/admin', {
    method: 'POST',
    headers: { host: 'helprr.lan:3050', origin: 'http://helprr.lan:3050', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  resetClaimSlots();
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

describe('isAllowedSetupOrigin', () => {
  const req = (headers: Record<string, string>) => new Request('http://helprr.lan/x', { headers });
  it.each([
    [{ host: 'helprr.lan', origin: 'http://helprr.lan' }, true],
    [{ host: '192.168.1.10:3050', origin: 'http://192.168.1.10:3050', 'sec-fetch-site': 'same-origin' }, true],
    [{ host: 'localhost:3050', origin: 'http://localhost:3050' }, true],
    [{ host: 'nas:3050', origin: 'http://nas:3050' }, true],
    [{ host: '[fd00::5]:3050', origin: 'http://[fd00::5]:3050' }, true],
    [{ host: 'helprr.lan', origin: 'http://other.lan' }, false],
    [{ host: 'helprr.lan' }, false],
    [{ host: 'helprr.lan', origin: 'http://helprr.lan', 'sec-fetch-site': 'same-site' }, false],
    [{ host: 'helprr.lan', origin: 'not a url' }, false],
    // DNS rebinding: the attacker's page looks same-origin, but its name is public.
    [{ host: 'evil.example:3050', origin: 'http://evil.example:3050', 'sec-fetch-site': 'same-origin' }, false],
    [{ host: '192.168.1.10.nip.io:3050', origin: 'http://192.168.1.10.nip.io:3050' }, false],
  ])('%j → %s', (headers, expected) => {
    expect(isAllowedSetupOrigin(req(headers))).toBe(expected);
  });

  it('accepts exactly APP_ORIGIN when it is set, even when a proxy rewrites Host', () => {
    vi.stubEnv('APP_ORIGIN', 'https://helprr.example.com');
    expect(isAllowedSetupOrigin(req({ host: 'helprr:3050', origin: 'https://helprr.example.com' }))).toBe(true);
    expect(isAllowedSetupOrigin(req({ host: 'helprr.lan', origin: 'http://helprr.lan' }))).toBe(false);
    expect(isAllowedSetupOrigin(req({ host: 'evil.example', origin: 'https://evil.example' }))).toBe(false);
  });

  it.each(['helprr.example.com:443', 'https://helprr.example.com/path', 'not a url'])('accepts nothing when APP_ORIGIN is %j', (value) => {
    vi.stubEnv('APP_ORIGIN', value);
    expect(isAllowedSetupOrigin(req({ host: 'helprr.example.com', origin: 'https://helprr.example.com' }))).toBe(false);
    expect(isAllowedSetupOrigin(req({ host: 'x', origin: 'x:y' }))).toBe(false);
  });

  it.each(['localhost', '10.0.0.4', '192.168.1.10', '100.101.1.2', '[::1]', '[fd00::1]', 'nas', 'box.local', 'router.home.arpa', 'pi.internal'])('treats %s as local', (name) => {
    expect(isLocalHostname(name)).toBe(true);
  });

  it.each(['helprr.example.com', 'attacker.example', 'host.tailnet.ts.net', '203.0.113.5', '8.8.8.8', '[2606:4700::1]'])('treats %s as public', (name) => {
    expect(isLocalHostname(name)).toBe(false);
  });
});

describe('POST /api/setup/admin limits', () => {
  it('says to wait when claims are busy', async () => {
    mocks.claim.mockRejectedValue(new FirstAdminBusyError());
    const res = await post();
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
  });

  it.each([[[1, 2]], [null], ['text']])('refuses the body %j', async (body) => {
    expect((await post({}, body)).status).toBe(400);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('refuses an oversized body', async () => {
    const res = await post({}, { username: 'admin', password: 'x'.repeat(20_000) });
    expect([400, 413]).toContain(res.status);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('points a refused origin at the local address or APP_ORIGIN', async () => {
    const res = await post({ origin: 'https://helprr.example.com', host: 'helprr.example.com' });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('set APP_ORIGIN');
  });
});
