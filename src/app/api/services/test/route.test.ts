import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A passing connection test of a saved Arr instance ends its polling skip (R11),
// but only when it tested the connection as stored.

const mocks = vi.hoisted(() => ({ auth: vi.fn(), status: vi.fn(), findFirst: vi.fn() }));

vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.auth }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/db', () => ({ prisma: { serviceConnection: { findFirst: mocks.findFirst } } }));
vi.mock('@/lib/sonarr-client', () => ({ SonarrClient: class { getSystemStatus = mocks.status; } }));
vi.mock('@/lib/radarr-client', () => ({ RadarrClient: class { getSystemStatus = mocks.status; } }));
vi.mock('@/lib/lidarr-client', () => ({ LidarrClient: class { getSystemStatus = mocks.status; } }));
vi.mock('@/lib/prowlarr-client', () => ({ ProwlarrClient: class {} }));
vi.mock('@/lib/qbittorrent-client', () => ({ QBittorrentLoginError: class extends Error {}, QBittorrentClient: class {} }));
vi.mock('@/lib/tmdb-client', () => ({ TmdbClient: class {} }));
vi.mock('@/lib/seerr-client', () => ({ SeerrClient: class {} }));
vi.mock('@/lib/jellyfin-client', () => ({ JellyfinClient: class {} }));

import { POST } from './route';
import { arrInstanceBackoff } from '@/lib/polling-cycle';

const KEY = ['stored', 'arr', 'key'].join('-');
const stored = { id: 'sonarr-2', type: 'SONARR', url: 'http://sonarr.lan:8989', apiKey: KEY, customHeaders: null };
const instance = { id: 'sonarr-2', version: 1 };

function skipInstance() {
  arrInstanceBackoff.clear(instance.id);
  arrInstanceBackoff.recordFailure(instance, new Error('timeout'), Date.now());
  arrInstanceBackoff.recordFailure(instance, new Error('timeout'), Date.now());
  expect(arrInstanceBackoff.remainingMs(instance)).toBeGreaterThan(0);
}

const test = (body: Record<string, unknown>) => POST(new NextRequest('http://helprr.test/api/services/test', {
  method: 'POST',
  body: JSON.stringify({ type: 'SONARR', url: stored.url, apiKey: KEY, instanceId: stored.id, ...body }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, user: { id: 'admin', role: 'admin' } });
  mocks.findFirst.mockResolvedValue(stored);
  mocks.status.mockResolvedValue({ version: '4.0.10' });
  skipInstance();
});

describe('connection test and the polling skip', () => {
  it('ends the skip when the saved connection passes', async () => {
    const res = await test({});
    expect(await res.json()).toEqual({ success: true, version: '4.0.10' });
    expect(arrInstanceBackoff.remainingMs(instance)).toBe(0);
    expect(mocks.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: 'sonarr-2', type: 'SONARR' } }));
  });

  it('keeps the skip when another address or key was tested', async () => {
    await test({ url: 'http://other.lan:8989' });
    await test({ apiKey: 'a-different-key' });
    expect(arrInstanceBackoff.remainingMs(instance)).toBeGreaterThan(0);
  });

  it('keeps the skip when other custom headers were tested', async () => {
    vi.stubEnv('HELPRR_CUSTOM_HEADERS', 'true');
    mocks.findFirst.mockResolvedValue({ ...stored, customHeaders: { 'X-Token': 'old' } });
    expect((await (await test({ customHeaders: { 'X-Token': 'new' } })).json()).success).toBe(true);
    expect(arrInstanceBackoff.remainingMs(instance)).toBeGreaterThan(0);
    await test({ customHeaders: { 'X-Token': 'old' } });
    expect(arrInstanceBackoff.remainingMs(instance)).toBe(0);
    vi.unstubAllEnvs();
  });

  it('still passes the test when the skip lookup fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.findFirst.mockResolvedValueOnce(stored).mockRejectedValueOnce(new Error('db down'));
    expect(await (await test({})).json()).toEqual({ success: true, version: '4.0.10' });
  });

  it('keeps the skip when the test fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.status.mockRejectedValue(new Error('connect ECONNREFUSED'));
    expect((await (await test({})).json()).success).toBe(false);
    expect(arrInstanceBackoff.remainingMs(instance)).toBeGreaterThan(0);
  });

  it('keeps the skip for a test without an instance id', async () => {
    await test({ instanceId: undefined });
    expect(arrInstanceBackoff.remainingMs(instance)).toBeGreaterThan(0);
  });
});
