import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectServiceVersion, NotServiceApiError } from '@/lib/service-response';
import { REDIRECT_REFUSED_MESSAGE, RedirectRefusedError } from '@/lib/redirect-guard';

/**
 * Sonarr answers any unknown path with its web page and HTTP 200, so a URL
 * pasted from the browser (`http://host:8989/settings/general`) used to pass
 * Test with any API key: the status call returned the page, and the route
 * reported success with no version.
 */

const page = '<!doctype html><html><head><title>Sonarr</title></head><body></body></html>';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), status: vi.fn(), version: vi.fn(), tmdb: vi.fn(), jfUser: vi.fn(), create: vi.fn() }));

vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.auth }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/db', () => ({ prisma: { serviceConnection: { findFirst: vi.fn(), findUnique: vi.fn(), create: mocks.create } } }));
vi.mock('@/lib/sonarr-client', () => ({ SonarrClient: class { getSystemStatus = mocks.status; } }));
vi.mock('@/lib/radarr-client', () => ({ RadarrClient: class { getSystemStatus = mocks.status; } }));
vi.mock('@/lib/lidarr-client', () => ({ LidarrClient: class { getSystemStatus = mocks.status; } }));
vi.mock('@/lib/prowlarr-client', () => ({ ProwlarrClient: class { getSystemStatus = mocks.status; } }));
vi.mock('@/lib/qbittorrent-client', () => ({ QBittorrentClient: class { getVersion = mocks.version; } }));
vi.mock('@/lib/tmdb-client', () => ({ TmdbClient: class { testAddress = mocks.tmdb; } }));
vi.mock('@/lib/seerr-client', () => ({
  SeerrClient: class { verify = vi.fn().mockResolvedValue({ id: 1, displayName: 'me' }); getStatus = mocks.status; },
}));
vi.mock('@/lib/arr-instances', () => ({
  clearConnectionMemo: vi.fn(),
  ensureDefaultForType: vi.fn(),
  isArrType: (type: string) => ['SONARR', 'RADARR', 'LIDARR'].includes(type),
}));
vi.mock('@/lib/jellyfin-client', () => ({
  JellyfinClient: class {
    getSystemInfo = mocks.status;
    resolveCurrentUser = mocks.jfUser;
    hasAdminAccess = vi.fn().mockResolvedValue(true);
    getUsers = vi.fn().mockResolvedValue([]);
  },
}));

import { POST as testConnection } from '@/app/api/services/test/route';
import { POST as saveConnection } from '@/app/api/services/route';

const test = (type: string, url = 'http://host.lan:8989/settings/general') =>
  testConnection(new NextRequest('http://helprr.test/api/services/test', {
    method: 'POST',
    body: JSON.stringify({ type, url, apiKey: 'any-key' }),
  }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, user: { id: 'admin', role: 'admin' } });
  mocks.jfUser.mockResolvedValue({ Id: 'u1', Name: 'me' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('expectServiceVersion', () => {
  it.each(['4.0.20.3014', 'v5.0.1', 'v4.6.0\n', '10.11.2', 'develop-1a2b3c'])('accepts %j', (value) => {
    expect(expectServiceVersion(value)).toBe(value.trim());
  });

  it.each([undefined, null, '', '   ', 42, {}, page, 'x'.repeat(65), 'two words'])('refuses %j', (value) => {
    expect(() => expectServiceVersion(value)).toThrow(NotServiceApiError);
  });
});

describe('an address that answers with a web page', () => {
  it.each(['SONARR', 'RADARR', 'LIDARR', 'PROWLARR', 'SEERR'])('fails a %s test whatever the key', async (type) => {
    mocks.status.mockResolvedValue(page);
    const res = await test(type);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/answered, but not like .+ API\. Remove anything after the port/);
  });

  it('fails a Jellyfin test whose system info is a page', async () => {
    mocks.status.mockResolvedValue(page);
    const res = await test('JELLYFIN', 'http://host.lan:8096/web');
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(false);
  });

  it('fails a qBittorrent test whose version is a page', async () => {
    mocks.version.mockResolvedValue(page);
    const res = await test('QBITTORRENT', 'http://host.lan:8080/foo');
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(false);
  });

  it('fails a status without a version', async () => {
    mocks.status.mockResolvedValue({ appName: 'Sonarr' });
    expect((await (await test('SONARR')).json()).success).toBe(false);
  });

  it('points a wrong TMDB address at the real one', async () => {
    mocks.tmdb.mockRejectedValue(new NotServiceApiError());
    const res = await test('TMDB', 'https://example.com/3');
    expect(res.status).toBe(200);
    expect((await res.json()).error).toContain('https://api.themoviedb.org/3');
  });
});

describe('a real API answer', () => {
  it('still passes with the version', async () => {
    mocks.status.mockResolvedValue({ appName: 'Sonarr', version: '4.0.20.3014' });
    const res = await test('SONARR', 'http://host.lan:8989');
    expect(await res.json()).toEqual({ success: true, version: '4.0.20.3014' });
  });

  it('still passes Jellyfin with its version and server name', async () => {
    mocks.status.mockResolvedValue({ Version: '10.11.2', ServerName: 'home' });
    const body = await (await test('JELLYFIN', 'http://host.lan:8096')).json();
    expect(body).toMatchObject({ success: true, version: '10.11.2', serverName: 'home', userId: 'u1' });
  });

  it.each(['3.5.0', 'develop-1a2b3c'])('still passes Seerr %s', async (version) => {
    mocks.status.mockResolvedValue({ version });
    const body = await (await test('SEERR', 'http://host.lan:5055')).json();
    expect(body).toMatchObject({ success: true, version });
  });

  it('still passes qBittorrent with its plain-text version', async () => {
    mocks.version.mockResolvedValue('v5.0.1');
    const res = await test('QBITTORRENT', 'http://host.lan:8080');
    expect(await res.json()).toEqual({ success: true, version: 'v5.0.1' });
  });
});

describe('a Jellyfin page in place of the user', () => {
  it('fails the test even when the version looks real', async () => {
    mocks.status.mockResolvedValue({ Version: '10.11.2' });
    mocks.jfUser.mockResolvedValue(page);
    const body = await (await test('JELLYFIN', 'http://host.lan:8096')).json();
    expect(body).toEqual({ success: false, error: 'Unable to resolve Jellyfin user for this API key.' });
  });
});

describe('saving Jellyfin from a wrong path', () => {
  it('refuses a page in place of the current user', async () => {
    mocks.jfUser.mockResolvedValue(page);
    const res = await saveConnection(new NextRequest('http://helprr.test/api/services', {
      method: 'POST',
      body: JSON.stringify({ type: 'JELLYFIN', url: 'http://host.lan:8096/web', apiKey: 'any-key' }),
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Unable to resolve Jellyfin user for this API key.' });
  });
});

describe('a failure Helprr can explain', () => {
  it('returns the hint instead of the generic message', async () => {
    mocks.status.mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND sonarr'), { code: 'ENOTFOUND' }));
    const res = await test('SONARR', 'http://sonarr:8989');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toMatch(/can't find that name/);
    expect(body.error).not.toContain('getaddrinfo');
  });

  it('adds http:// to an address typed without it', async () => {
    mocks.status.mockResolvedValue({ version: '4.0.20.3014' });
    const res = await test('SONARR', '192.168.0.124:8990');
    expect(await res.json()).toEqual({ success: true, version: '4.0.20.3014' });
  });

  it('keeps the generic message for an error it cannot explain', async () => {
    mocks.status.mockRejectedValue(new Error('boom'));
    expect((await (await test('SONARR', 'http://host.lan:8989')).json()).error).toBe('Connection test failed');
  });
});

describe('hint order', () => {
  it('still names a refused redirect first', async () => {
    const error = Object.assign(new Error('Redirect refused'), { code: 'ECONNRESET', cause: new RedirectRefusedError() });
    mocks.status.mockRejectedValue(error);
    const res = await test('SONARR', 'http://host.lan:8989');
    expect(res.status).toBe(200);
    expect((await res.json()).error).toBe(REDIRECT_REFUSED_MESSAGE);
  });

  it('keeps the generic message for a 403', async () => {
    mocks.status.mockRejectedValue(Object.assign(new Error('Request failed with status code 403'), { response: { status: 403 } }));
    const res = await test('SONARR', 'http://host.lan:8989');
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Connection test failed');
  });
});

describe('saving an address typed without http://', () => {
  it('stores it with http:// in front', async () => {
    mocks.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'c1', isDefault: true, ...data }));
    const res = await saveConnection(new NextRequest('http://helprr.test/api/services', {
      method: 'POST',
      body: JSON.stringify({ type: 'TMDB', url: 'api.themoviedb.org/3/', apiKey: 'v3key' }),
    }));
    expect(res.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ url: 'http://api.themoviedb.org/3' }),
    }));
  });
});

// Cloudflare Tunnel and similar proxies replace a 502 from the app with their own
// "Bad gateway" page, so no failure here may answer 502.
describe('status codes a reverse proxy passes through', () => {
  it('answers an unreachable service with 200 and success false', async () => {
    mocks.status.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    const res = await test('SONARR', 'http://192.168.0.124:8999');
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(false);
  });

  it('answers a Jellyfin save behind a refused redirect with 400', async () => {
    mocks.jfUser.mockRejectedValue(Object.assign(new Error('Redirect refused'), { cause: new RedirectRefusedError() }));
    const res = await saveConnection(new NextRequest('http://helprr.test/api/services', {
      method: 'POST',
      body: JSON.stringify({ type: 'JELLYFIN', url: 'http://host.lan:8096', apiKey: 'any-key' }),
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: REDIRECT_REFUSED_MESSAGE });
  });
});
