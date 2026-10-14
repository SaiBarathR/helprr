import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireUserCapability: vi.fn(),
  exchangeCodeForToken: vi.fn(),
  loadAniListConnection: vi.fn(),
  persistTokenResponse: vi.fn(),
  setAniListConnectionMetadata: vi.fn(),
  fetchViewer: vi.fn(),
  resolveApiKeyForService: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: mocks.requireAuth,
  requireUserCapability: mocks.requireUserCapability,
}));
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown) => handler,
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    serviceConnection: {
      findFirst: mocks.findFirst,
      update: mocks.update,
      create: mocks.create,
      updateMany: mocks.updateMany,
    },
  },
}));
vi.mock('@/lib/anilist-oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/anilist-oauth')>()),
  exchangeCodeForToken: mocks.exchangeCodeForToken,
  loadAniListConnection: mocks.loadAniListConnection,
  persistTokenResponse: mocks.persistTokenResponse,
  setAniListConnectionMetadata: mocks.setAniListConnectionMetadata,
}));
vi.mock('@/lib/anilist-mutations', () => ({ fetchViewer: mocks.fetchViewer }));
vi.mock('@/lib/service-connection-secrets', () => ({
  isNonEmptyString: (value: unknown) => typeof value === 'string' && value.trim().length > 0,
  resolveApiKeyForService: mocks.resolveApiKeyForService,
}));

import { resolvePublicAppOrigin } from '@/lib/request-utils';
import { GET as callbackGet } from '@/app/api/services/anilist/callback/route';
import { POST as authorizePost } from '@/app/api/services/anilist/authorize/route';

const CONFIGURED = 'https://helprr.example.com';
const SPOOFED = { 'x-forwarded-host': 'attacker.example', 'x-forwarded-proto': 'https' };

function callbackRequest(query: string, headers: Record<string, string> = {}, state = 'state-1') {
  return new NextRequest(`http://10.0.0.5:3050/api/services/anilist/callback?${query}`, {
    headers: { ...headers, cookie: `helprr-anilist-oauth-state=${state}` },
  });
}

function authorizeRequest(headers: Record<string, string> = {}) {
  return new NextRequest('http://10.0.0.5:3050/api/services/anilist/authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ clientId: 'client-1', clientSecret: 'not-a-real-secret' }),
  });
}

function originOf(location: string | null) {
  return location ? new URL(location).origin : null;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(null);
  mocks.requireUserCapability.mockResolvedValue({ ok: true, user: { id: 'admin', role: 'admin' } });
  mocks.loadAniListConnection.mockResolvedValue({ clientId: 'client-1', clientSecret: 'not-a-real-secret' });
  mocks.exchangeCodeForToken.mockResolvedValue({ access_token: 'token' });
  mocks.fetchViewer.mockResolvedValue({ id: 1, name: 'viewer' });
  mocks.resolveApiKeyForService.mockResolvedValue('not-a-real-secret');
  mocks.findFirst.mockResolvedValue({ id: 'anilist-1' });
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolvePublicAppOrigin', () => {
  it('uses only the configured HTTPS origin in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_ORIGIN', `${CONFIGURED}/`);
    vi.stubEnv('TRUST_FORWARDED_PROTO', 'true');
    expect(resolvePublicAppOrigin(callbackRequest('', SPOOFED))).toBe(CONFIGURED);
  });

  it.each([
    ['missing', undefined],
    ['http', 'http://helprr.example.com'],
    ['malformed', 'not a url'],
    ['with a path', 'https://helprr.example.com/app'],
    ['with a query', 'https://helprr.example.com/?next=1'],
    ['with credentials', ['https://user:pass', 'helprr.example.com'].join('@')],
  ])('fails closed in production when APP_ORIGIN is %s', (_label, value) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_ORIGIN', value);
    expect(resolvePublicAppOrigin(callbackRequest('', SPOOFED))).toBeNull();
  });

  it('uses the request origin in development and ignores untrusted forwarded headers', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('TRUST_FORWARDED_PROTO', undefined);
    const request = new NextRequest('http://localhost:3050/api/services/anilist/callback', { headers: SPOOFED });
    expect(resolvePublicAppOrigin(request)).toBe('http://localhost:3050');
  });

  it('honours one valid forwarded origin in development only with the trusted-proxy flag', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('TRUST_FORWARDED_PROTO', 'true');
    const request = (headers: Record<string, string>) =>
      new NextRequest('http://localhost:3050/x', { headers });
    expect(resolvePublicAppOrigin(request({ 'x-forwarded-host': 'dev.example:8443', 'x-forwarded-proto': 'https' })))
      .toBe('https://dev.example:8443');
    for (const headers of [
      { 'x-forwarded-host': 'a.example, b.example', 'x-forwarded-proto': 'https' },
      { 'x-forwarded-host': 'a.example', 'x-forwarded-proto': 'https, http' },
      { 'x-forwarded-host': 'a.example/path', 'x-forwarded-proto': 'https' },
      { 'x-forwarded-host': 'a.example', 'x-forwarded-proto': 'javascript' },
      { 'x-forwarded-host': ['user', 'a.example'].join('@'), 'x-forwarded-proto': 'https' },
    ]) {
      expect(resolvePublicAppOrigin(request(headers))).toBe('http://localhost:3050');
    }
  });
});

describe('AniList OAuth routes in production', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_ORIGIN', CONFIGURED);
  });

  it('callback redirects to the configured origin despite spoofed forwarded headers', async () => {
    const res = await callbackGet(callbackRequest('code=abc&state=state-1', SPOOFED));
    expect(res.status).toBe(307);
    expect(originOf(res.headers.get('location'))).toBe(CONFIGURED);
    expect(new URL(res.headers.get('location')!).searchParams.get('anilist')).toBe('connected');
    expect(mocks.exchangeCodeForToken).toHaveBeenCalledWith(expect.objectContaining({
      redirectUri: `${CONFIGURED}/api/services/anilist/callback`,
    }));
  });

  it('callback keeps the state check and redirects a mismatch to the configured origin', async () => {
    const res = await callbackGet(callbackRequest('code=abc&state=other', SPOOFED));
    const location = new URL(res.headers.get('location')!);
    expect(location.origin).toBe(CONFIGURED);
    expect(location.searchParams.get('reason')).toBe('state_mismatch');
    expect(mocks.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('callback reports a failed token exchange on the configured origin', async () => {
    mocks.exchangeCodeForToken.mockRejectedValueOnce(new Error('exchange failed'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await callbackGet(callbackRequest('code=abc&state=state-1', SPOOFED));
    error.mockRestore();
    const location = new URL(res.headers.get('location')!);
    expect(location.origin).toBe(CONFIGURED);
    expect(location.searchParams.get('reason')).toBe('exchange_failed');
  });

  it('callback fails closed without a usable APP_ORIGIN and never redirects to a header host', async () => {
    vi.stubEnv('APP_ORIGIN', 'http://helprr.example.com');
    const res = await callbackGet(callbackRequest('code=abc&state=state-1', SPOOFED));
    expect(res.status).toBe(500);
    expect(res.headers.get('location')).toBeNull();
    const body = await res.json();
    expect(body.error).toMatch(/APP_ORIGIN/);
    expect(JSON.stringify(body)).not.toContain('helprr.example.com');
    expect(mocks.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('authorize builds the redirect URI from the configured origin', async () => {
    const res = await authorizePost(authorizeRequest(SPOOFED));
    expect(res.status).toBe(200);
    const { authorizeUrl } = await res.json();
    expect(new URL(authorizeUrl).searchParams.get('redirect_uri'))
      .toBe(`${CONFIGURED}/api/services/anilist/callback`);
  });

  it('authorize fails closed with a malformed APP_ORIGIN', async () => {
    vi.stubEnv('APP_ORIGIN', 'https://helprr.example.com/sub');
    const res = await authorizePost(authorizeRequest(SPOOFED));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/APP_ORIGIN/);
  });
});

describe('AniList OAuth routes in development', () => {
  it('produce a usable localhost callback', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('TRUST_FORWARDED_PROTO', undefined);
    const res = await authorizePost(new NextRequest('http://localhost:3050/api/services/anilist/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: 'client-1', clientSecret: 'not-a-real-secret' }),
    }));
    const { authorizeUrl } = await res.json();
    expect(new URL(authorizeUrl).searchParams.get('redirect_uri'))
      .toBe('http://localhost:3050/api/services/anilist/callback');

    const callback = await callbackGet(new NextRequest(
      'http://localhost:3050/api/services/anilist/callback?code=abc&state=s',
      { headers: { cookie: 'helprr-anilist-oauth-state=s' } },
    ));
    expect(originOf(callback.headers.get('location'))).toBe('http://localhost:3050');
  });
});
