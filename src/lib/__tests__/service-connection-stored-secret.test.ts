import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The settings API never returns a stored API key, only a mask of it, and
 * treats that mask coming back as "keep the stored key". Honoured with a URL
 * the caller chose, that sends the real key there: someone allowed to manage
 * instances could read a key they are not shown.
 */

const STORED_URL = 'http://sonarr.lan:8989';
const STORED_KEY = 'abcd1234efgh5678ijkl';
const MASK = 'abcd****ijkl';
const STORED_HEADER = 'cf-access-secret-0123456789';
const HEADER_MASK = 'cf-a****6789';
const ELSEWHERE = 'https://collector.example';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  clients: [] as Array<{ url: string; apiKey: string; headers?: Record<string, string> }>,
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
}));

function arrClient() {
  return class {
    constructor(url: string, apiKey: string, headers?: Record<string, string>) {
      mocks.clients.push({ url, apiKey, headers });
    }
    getSystemStatus = async () => ({ version: '4.0.0' });
  };
}

vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.auth }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/db', () => ({
  prisma: {
    serviceConnection: {
      findFirst: mocks.findFirst,
      findUnique: mocks.findUnique,
      update: mocks.update,
      create: mocks.create,
    },
  },
}));
vi.mock('@/lib/sonarr-client', () => ({ SonarrClient: arrClient() }));
vi.mock('@/lib/radarr-client', () => ({ RadarrClient: arrClient() }));
vi.mock('@/lib/lidarr-client', () => ({ LidarrClient: arrClient() }));
vi.mock('@/lib/prowlarr-client', () => ({ ProwlarrClient: arrClient() }));
vi.mock('@/lib/qbittorrent-client', () => ({ QBittorrentClient: class {} }));
vi.mock('@/lib/jellyfin-client', () => ({ JellyfinClient: class {} }));
vi.mock('@/lib/tmdb-client', () => ({ TmdbClient: class {} }));
vi.mock('@/lib/seerr-client', () => ({ SeerrClient: class {} }));
vi.mock('@/lib/arr-instances', () => ({
  clearConnectionMemo: vi.fn(),
  ensureDefaultForType: vi.fn(),
  isArrType: (type: string) => ['SONARR', 'RADARR', 'LIDARR'].includes(type),
}));
vi.mock('@/lib/settings/service-config', () => ({ findServiceByType: () => ({ label: 'Sonarr' }) }));

import { POST as testConnection } from '@/app/api/services/test/route';
import { POST as saveConnection } from '@/app/api/services/route';
import { parseCustomHeaders, REENTER_SECRET_MESSAGE, resolveCustomHeaders } from '@/lib/service-connection-secrets';

const stored = {
  id: 'conn-1',
  type: 'SONARR',
  label: 'Main',
  isDefault: true,
  url: STORED_URL,
  externalUrl: null,
  username: null,
  apiKey: STORED_KEY,
  customHeaders: { 'CF-Access-Client-Secret': STORED_HEADER },
  tokenExpiresAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const post = (handler: (request: NextRequest) => Promise<Response>, path: string, body: unknown) =>
  handler(new NextRequest(`http://helprr.test${path}`, { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.clients.length = 0;
  mocks.auth.mockResolvedValue({ ok: true, user: { id: 'member', role: 'member' } });
  mocks.findFirst.mockResolvedValue(stored);
  mocks.findUnique.mockResolvedValue(stored);
  mocks.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...stored, ...data }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/services/test', () => {
  const test = (body: Record<string, unknown>) =>
    post(testConnection, '/api/services/test', { type: 'SONARR', instanceId: 'conn-1', ...body });

  it('uses the stored key when its mask comes back with the stored URL', async () => {
    const res = await test({ url: `${STORED_URL}/`, apiKey: MASK });
    expect(res.status).toBe(200);
    expect(mocks.clients).toEqual([{ url: STORED_URL, apiKey: STORED_KEY, headers: undefined }]);
  });

  it.each([ELSEWHERE, 'http://sonarr.lan:8990', `${STORED_URL}/sonarr`, 'https://sonarr.lan:8989'])(
    'does not send the stored key to %s',
    async (url) => {
      const res = await test({ url, apiKey: MASK });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ success: false, error: REENTER_SECRET_MESSAGE });
      expect(mocks.clients).toEqual([]);
    },
  );

  it('tests another URL with a key that was typed in', async () => {
    const res = await test({ url: ELSEWHERE, apiKey: 'a-new-key-typed-by-hand' });
    expect(res.status).toBe(200);
    expect(mocks.clients).toEqual([{ url: ELSEWHERE, apiKey: 'a-new-key-typed-by-hand', headers: undefined }]);
  });

  it('does not send a stored header value to another URL', async () => {
    vi.stubEnv('HELPRR_CUSTOM_HEADERS', 'true');
    const customHeaders = { 'CF-Access-Client-Secret': HEADER_MASK };
    const elsewhere = await test({ url: ELSEWHERE, apiKey: 'a-new-key-typed-by-hand', customHeaders });
    expect(elsewhere.status).toBe(400);
    expect(mocks.clients).toEqual([]);

    const same = await test({ url: STORED_URL, apiKey: MASK, customHeaders });
    expect(same.status).toBe(200);
    expect(mocks.clients).toEqual([
      { url: STORED_URL, apiKey: STORED_KEY, headers: { 'CF-Access-Client-Secret': STORED_HEADER } },
    ]);
  });
});

describe('POST /api/services', () => {
  const save = (body: Record<string, unknown>) =>
    post(saveConnection, '/api/services', { type: 'SONARR', id: 'conn-1', label: 'Main', ...body });

  it('keeps the stored key when its mask comes back with the stored URL', async () => {
    const res = await save({ url: STORED_URL, apiKey: MASK });
    expect(res.status).toBe(200);
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({ url: STORED_URL, apiKey: STORED_KEY });
    expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty('customHeaders');
  });

  it('refuses to move the stored key to another URL', async () => {
    const res = await save({ url: ELSEWHERE, apiKey: MASK });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: REENTER_SECRET_MESSAGE });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('refuses to move a stored header value to another URL', async () => {
    vi.stubEnv('HELPRR_CUSTOM_HEADERS', 'true');
    const res = await save({
      url: ELSEWHERE,
      apiKey: 'a-new-key-typed-by-hand',
      customHeaders: { 'CF-Access-Client-Secret': HEADER_MASK },
    });
    expect(res.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('drops stored headers the request did not carry when the URL changes', async () => {
    const res = await save({ url: ELSEWHERE, apiKey: 'a-new-key-typed-by-hand' });
    expect(res.status).toBe(200);
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({
      url: ELSEWHERE,
      apiKey: 'a-new-key-typed-by-hand',
      customHeaders: {},
    });
  });

  it('does not hand a new instance the default instance\'s key for another URL', async () => {
    const res = await save({ id: undefined, label: 'Second', url: ELSEWHERE, apiKey: MASK });
    expect(res.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

// With `Host` set, the HTTP client resolves a relative redirect against it and
// sends the key there, so the stored URL alone would not confine the request.
describe('a Host custom header', () => {
  it.each(['Host', 'host', 'HOST', ' Host '])('is dropped when sent as %j', (name) => {
    expect(parseCustomHeaders({ [name]: 'collector.example:8989', 'X-Token': 'value' })).toEqual({ 'X-Token': 'value' });
  });

  it('does not reach a connection test', async () => {
    vi.stubEnv('HELPRR_CUSTOM_HEADERS', 'true');
    const res = await post(testConnection, '/api/services/test', {
      type: 'SONARR',
      instanceId: 'conn-1',
      url: STORED_URL,
      apiKey: MASK,
      customHeaders: { Host: 'collector.example:8989', 'CF-Access-Client-Secret': HEADER_MASK },
    });
    expect(res.status).toBe(200);
    expect(mocks.clients).toEqual([
      { url: STORED_URL, apiKey: STORED_KEY, headers: { 'CF-Access-Client-Secret': STORED_HEADER } },
    ]);
  });
});

describe('resolveCustomHeaders', () => {
  const existing = { 'X-Token': STORED_HEADER };

  it('swaps a mask for the stored value only for the same URL', () => {
    expect(resolveCustomHeaders(existing, { 'X-Token': HEADER_MASK })).toEqual(existing);
    expect(resolveCustomHeaders(existing, { 'X-Token': HEADER_MASK }, false)).toBeNull();
  });

  it('passes typed values through for any URL', () => {
    expect(resolveCustomHeaders(existing, { 'X-Token': 'typed', 'X-New': 'value' }, false))
      .toEqual({ 'X-Token': 'typed', 'X-New': 'value' });
  });
});
