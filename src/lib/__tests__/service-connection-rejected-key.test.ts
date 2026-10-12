import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The client signs the user out when this app's own API answers 401. The
 * connection routes passed a service's 401 straight through, so testing or
 * saving a connection with a mistyped key sent the user to the sign-in page.
 */

const mocks = vi.hoisted(() => ({ auth: vi.fn(), upstream: vi.fn(), findFirst: vi.fn() }));
const upstreamError = (status: number) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });

vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.auth }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/db', () => ({
  prisma: { serviceConnection: { findFirst: mocks.findFirst, findUnique: vi.fn(), update: vi.fn(), create: vi.fn() } },
}));
vi.mock('@/lib/sonarr-client', () => ({ SonarrClient: class { getSystemStatus = mocks.upstream; } }));
vi.mock('@/lib/radarr-client', () => ({ RadarrClient: class {} }));
vi.mock('@/lib/lidarr-client', () => ({ LidarrClient: class {} }));
vi.mock('@/lib/prowlarr-client', () => ({ ProwlarrClient: class {} }));
vi.mock('@/lib/qbittorrent-client', () => ({ QBittorrentClient: class {} }));
vi.mock('@/lib/tmdb-client', () => ({ TmdbClient: class {} }));
vi.mock('@/lib/seerr-client', () => ({ SeerrClient: class {} }));
vi.mock('@/lib/jellyfin-client', () => ({
  JellyfinClient: class {
    getSystemInfo = mocks.upstream;
    resolveCurrentUser = mocks.upstream;
    hasAdminAccess = mocks.upstream;
  },
}));
vi.mock('@/lib/arr-instances', () => ({
  clearConnectionMemo: vi.fn(),
  ensureDefaultForType: vi.fn(),
  isArrType: (type: string) => ['SONARR', 'RADARR', 'LIDARR'].includes(type),
}));
vi.mock('@/lib/settings/service-config', () => ({ findServiceByType: () => ({ label: 'Jellyfin' }) }));

import { POST as testConnection } from '@/app/api/services/test/route';
import { POST as saveConnection } from '@/app/api/services/route';

const post = (handler: (request: NextRequest) => Promise<Response>, path: string, body: unknown) =>
  handler(new NextRequest(`http://helprr.test${path}`, { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, user: { id: 'admin', role: 'admin' } });
  mocks.findFirst.mockResolvedValue(null);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a key the service turns down', () => {
  it('fails a connection test without looking like an expired session', async () => {
    mocks.upstream.mockRejectedValue(upstreamError(401));
    const res = await post(testConnection, '/api/services/test', { type: 'SONARR', url: 'http://sonarr.lan:8989', apiKey: 'mistyped' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'The service rejected the API key' });
  });

  it('keeps the Jellyfin wording for a Jellyfin test', async () => {
    mocks.upstream.mockRejectedValue(upstreamError(401));
    const res = await post(testConnection, '/api/services/test', { type: 'JELLYFIN', url: 'http://jellyfin.lan:8096', apiKey: 'mistyped' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'Invalid Jellyfin API key or Jellyfin rejected token auth' });
  });

  it('fails a Jellyfin save the same way', async () => {
    mocks.upstream.mockRejectedValue(upstreamError(401));
    const res = await post(saveConnection, '/api/services', { type: 'JELLYFIN', url: 'http://jellyfin.lan:8096', apiKey: 'mistyped' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid Jellyfin API key or Jellyfin rejected token auth' });
  });

  it.each([403, 404])('still passes a %i from the service through', async (status) => {
    mocks.upstream.mockRejectedValue(upstreamError(status));
    const res = await post(testConnection, '/api/services/test', { type: 'SONARR', url: 'http://sonarr.lan:8989', apiKey: 'typed' });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ success: false, error: 'Connection test failed' });
  });
});
