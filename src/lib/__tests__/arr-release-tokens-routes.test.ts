import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Interactive search hands the browser a token for each release's guid (a guid
// can be a download link with a passkey) and the grab routes resolve it, only
// for the user who searched and only on the instance searched. Real token
// store over an in-memory Redis.

const mocks = vi.hoisted(() => {
  const store = new Map<string, string>();
  const ttls = new Map<string, number | undefined>();
  const release = (guid: string) => ({
    guid, indexerId: 8, title: `Show S01E03 ${guid.slice(-4)}`, indexer: 'Example', infoUrl: 'https://tracker.example/details/1',
    quality: { quality: { id: 3, name: 'WEBDL-1080p' } }, downloadAllowed: true,
  });
  const client = () => ({ getReleases: vi.fn(), grabRelease: vi.fn(), getDownloadClients: vi.fn() });
  return {
    store,
    ttls,
    release,
    user: { id: 'alice' },
    // The default instance of each app, which resolveConnection returns without an instance id.
    defaults: {} as Record<string, string>,
    sonarr: client(),
    radarr: client(),
    lidarr: client(),
    redis: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      multi: vi.fn(() => {
        const batch = {
          set: vi.fn((key: string, value: string, options?: { EX?: number }) => {
            store.set(key, value);
            ttls.set(key, options?.EX);
            return batch;
          }),
          exec: vi.fn(async () => []),
        };
        return batch;
      }),
    },
  };
});

vi.mock('@/lib/redis', () => ({ getRedisClient: vi.fn(async () => mocks.redis) }));
vi.mock('@/lib/arr-instances', () => ({
  resolveConnection: vi.fn(async (type: string, instanceId?: string | null) => {
    if (instanceId === 'missing') throw new Error(`No ${type} instance found for id "missing".`);
    return { id: instanceId || mocks.defaults[type] };
  }),
}));
vi.mock('@/lib/auth', () => {
  const ok = async () => ({ ok: true, user: mocks.user, session: {} });
  return { requireUserCapability: vi.fn(ok), requireUserAllCapabilities: vi.fn(ok) };
});
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/service-helpers', () => ({
  getSonarrClient: vi.fn(async () => mocks.sonarr),
  getRadarrClient: vi.fn(async () => mocks.radarr),
  getLidarrClient: vi.fn(async () => mocks.lidarr),
}));

import { GET as sonarrSearch, POST as sonarrGrab } from '@/app/api/sonarr/release/route';
import { GET as radarrSearch, POST as radarrGrab } from '@/app/api/radarr/release/route';
import { GET as lidarrSearch, POST as lidarrGrab } from '@/app/api/lidarr/release/route';
import { GET as sonarrClients } from '@/app/api/sonarr/downloadclient/route';
import { issueReleaseTokens, PROWLARR_SCOPE } from '@/lib/release-tokens';
import { getSonarrClient } from '@/lib/service-helpers';
import { sha256Hex } from '@/lib/cache/keys';
import { GET as radarrClients } from '@/app/api/radarr/downloadclient/route';
import { GET as lidarrClients } from '@/app/api/lidarr/downloadclient/route';

const PASSKEY_GUID = 'https://tracker.example/download.php?id=42&passkey=SECRETPASSKEY';
const MAGNET_GUID = 'magnet:?xt=urn:btih:ABC&tr=https%3A%2F%2Ftracker.example%2Fannounce%2FSECRETPASSKEY';

const get = (route: typeof sonarrSearch, path: string) => route(new NextRequest(`http://localhost${path}`));
const post = (route: typeof sonarrGrab, path: string, body: unknown) =>
  route(new NextRequest(`http://localhost${path}`, { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.store.clear();
  mocks.ttls.clear();
  mocks.user = { id: 'alice' };
  mocks.defaults = { SONARR: 'son-1', RADARR: 'rad-1', LIDARR: 'lid-1' };
  for (const c of [mocks.sonarr, mocks.radarr, mocks.lidarr]) {
    c.getReleases.mockResolvedValue([mocks.release(PASSKEY_GUID), mocks.release(MAGNET_GUID)]);
    c.grabRelease.mockResolvedValue(undefined);
  }
});

describe.each([
  ['Sonarr', sonarrSearch, sonarrGrab, '/api/sonarr/release?episodeId=5&instanceId=son-1', mocks.sonarr],
  ['Radarr', radarrSearch, radarrGrab, '/api/radarr/release?movieId=5&instanceId=rad-1', mocks.radarr],
  ['Lidarr', lidarrSearch, lidarrGrab, '/api/lidarr/release?albumId=5&instanceId=lid-1', mocks.lidarr],
] as const)('%s interactive search', (name, search, grab, path, client) => {
  const grabPath = path.replace(/\?.*instanceId=/, '?instanceId=');

  it('gives the browser a token for each guid and keeps the rest', async () => {
    const res = await get(search, path);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('SECRETPASSKEY');
    expect(body).toHaveLength(2);
    expect(body[0].guid).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(body[0].guid).not.toBe(body[1].guid);
    expect(body[0]).toMatchObject({ indexerId: 8, indexer: 'Example', infoUrl: 'https://tracker.example/details/1', downloadAllowed: true });
  });

  it('grabs with the guid the token stands for', async () => {
    const [, magnet] = await (await get(search, path)).json();
    // The indexer is the token's too, whatever the browser sends.
    const res = await post(grab, grabPath, { guid: magnet.guid, indexerId: 99 });
    expect(res.status).toBe(200);
    const sent = client.grabRelease.mock.calls[0];
    if (name === 'Lidarr') expect(sent.slice(0, 2)).toEqual([MAGNET_GUID, 8]);
    else expect(sent[0]).toMatchObject({ guid: MAGNET_GUID, indexerId: 8 });
  });

  it('refuses a token from another user, as expired, without calling upstream', async () => {
    const [first] = await (await get(search, path)).json();
    mocks.user = { id: 'mallory' };
    const res = await post(grab, grabPath, { guid: first.guid, indexerId: 8 });
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ code: 'expired' });
    expect(client.grabRelease).not.toHaveBeenCalled();
  });

  it('refuses a token from another instance', async () => {
    const [first] = await (await get(search, path)).json();
    const res = await post(grab, grabPath.replace(/instanceId=[^&]+/, 'instanceId=other'), { guid: first.guid, indexerId: 8 });
    expect(res.status).toBe(410);
    expect(client.grabRelease).not.toHaveBeenCalled();
  });

  it('refuses a raw guid (only tokens resolve)', async () => {
    const res = await post(grab, grabPath, { guid: PASSKEY_GUID, indexerId: 8 });
    expect(res.status).toBe(410);
    expect(client.grabRelease).not.toHaveBeenCalled();
  });
});

describe('the token store', () => {
  it('keeps each token 30 minutes, as long as the *arr keeps the release (the value holds the real guid)', async () => {
    await get(sonarrSearch, '/api/sonarr/release?episodeId=5&instanceId=son-1');
    expect(mocks.ttls.size).toBe(2);
    expect([...mocks.ttls.values()]).toEqual([1800, 1800]);
  });

  it('works on the default instance, whether or not the grab names it, and on no other', async () => {
    const [first, second] = await (await get(sonarrSearch, '/api/sonarr/release?episodeId=5')).json();
    expect((await post(sonarrGrab, '/api/sonarr/release', { guid: first.guid, indexerId: 8 })).status).toBe(200);
    expect(mocks.sonarr.grabRelease).toHaveBeenCalledWith({ guid: PASSKEY_GUID, indexerId: 8 });
    expect((await post(sonarrGrab, '/api/sonarr/release?instanceId=son-2', { guid: second.guid, indexerId: 8 })).status).toBe(410);
    expect((await post(sonarrGrab, '/api/sonarr/release?instanceId=son-1', { guid: second.guid, indexerId: 8 })).status).toBe(200);
    expect(mocks.sonarr.grabRelease).toHaveBeenLastCalledWith({ guid: MAGNET_GUID, indexerId: 8 });
  });

  it('a named search resolves when the grab leaves out that (default) instance', async () => {
    const [first] = await (await get(radarrSearch, '/api/radarr/release?movieId=5&instanceId=rad-1')).json();
    expect((await post(radarrGrab, '/api/radarr/release', { guid: first.guid, indexerId: 8 })).status).toBe(200);
  });

  it('a default-instance token stops working when another instance becomes the default', async () => {
    const [first] = await (await get(sonarrSearch, '/api/sonarr/release?episodeId=5')).json();
    mocks.defaults.SONARR = 'son-2';
    const res = await post(sonarrGrab, '/api/sonarr/release', { guid: first.guid, indexerId: 8 });
    expect(res.status).toBe(410);
    expect(mocks.sonarr.grabRelease).not.toHaveBeenCalled();
  });

  it('a default change during the search keeps the tokens on the instance searched', async () => {
    // The search takes a while; an admin makes son-2 the default meanwhile.
    mocks.sonarr.getReleases.mockImplementationOnce(async () => {
      mocks.defaults.SONARR = 'son-2';
      return [mocks.release(PASSKEY_GUID)];
    });
    const [first] = await (await get(sonarrSearch, '/api/sonarr/release?episodeId=5')).json();
    expect(vi.mocked(getSonarrClient)).toHaveBeenLastCalledWith('son-1');
    expect((await post(sonarrGrab, '/api/sonarr/release', { guid: first.guid, indexerId: 8 })).status).toBe(410);
    expect(mocks.sonarr.grabRelease).not.toHaveBeenCalled();
    expect((await post(sonarrGrab, '/api/sonarr/release?instanceId=son-1', { guid: first.guid, indexerId: 8 })).status).toBe(200);
    expect(vi.mocked(getSonarrClient)).toHaveBeenLastCalledWith('son-1');
  });

  it('an unknown instance fails before any token is read, without echoing upstream text', async () => {
    const res = await post(sonarrGrab, '/api/sonarr/release?instanceId=missing', { guid: 'tok', indexerId: 8 });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to grab release' });
    expect(mocks.redis.get).not.toHaveBeenCalled();
    expect(mocks.sonarr.grabRelease).not.toHaveBeenCalled();
  });

  it('keeps Prowlarr search tokens in the key form they had (tokens issued before an update still resolve)', async () => {
    const [token] = await issueReleaseTokens(PROWLARR_SCOPE, 'alice', [{ guid: 'g', indexerId: 1 }]);
    expect([...mocks.store.keys()]).toEqual([`helprr:prowlarr-release:v1:${sha256Hex('alice')}:${sha256Hex(token)}`]);
  });
});

describe('across apps', () => {
  it('a Sonarr token does not resolve for Radarr, even with the same instance id', async () => {
    const [first] = await (await get(sonarrSearch, '/api/sonarr/release?episodeId=5&instanceId=same')).json();
    expect((await post(radarrGrab, '/api/radarr/release?instanceId=same', { guid: first.guid, indexerId: 8 })).status).toBe(410);
    expect(mocks.radarr.grabRelease).not.toHaveBeenCalled();
  });

  it('a Manual grab carries the token too', async () => {
    const [first] = await (await get(sonarrSearch, '/api/sonarr/release?episodeId=5&instanceId=son-1')).json();
    const res = await post(sonarrGrab, '/api/sonarr/release?instanceId=son-1', {
      guid: first.guid, indexerId: 8, shouldOverride: true, seriesId: 3, episodeIds: [5],
      quality: { quality: { id: 3, name: 'WEBDL-1080p' }, revision: { version: 1, real: 0, isRepack: false } },
      languages: [{ id: 1, name: 'English' }],
    });
    expect(res.status).toBe(200);
    expect(mocks.sonarr.grabRelease).toHaveBeenCalledWith(expect.objectContaining({ guid: PASSKEY_GUID, indexerId: 8, shouldOverride: true }));
  });

  it('an answer that is not a list is passed through without tokens', async () => {
    mocks.sonarr.getReleases.mockResolvedValue('<html>');
    expect(await (await get(sonarrSearch, '/api/sonarr/release?episodeId=5')).json()).toBe('<html>');
  });
});

describe('Lidarr grab body', () => {
  const grabLidarr = (body: unknown) => lidarrGrab(new NextRequest('http://localhost/api/lidarr/release?instanceId=lid-1', {
    method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
  const token = async () => (await (await get(lidarrSearch, '/api/lidarr/release?albumId=5&instanceId=lid-1')).json())[0].guid as string;

  it.each([
    ['a download client that is not an id', (guid: string) => ({ guid, indexerId: 8, downloadClientId: 'qbit' }), 'Invalid download client'],
    ['a negative download client', (guid: string) => ({ guid, indexerId: 8, downloadClientId: -1 }), 'Invalid download client'],
    ['an over-long guid', () => ({ guid: 'x'.repeat(16_385), indexerId: 8 }), 'Invalid release'],
    ['a fractional indexer', (guid: string) => ({ guid, indexerId: 1.5 }), 'Invalid release'],
    ['no guid', () => ({ indexerId: 8 }), 'guid and indexerId are required'],
  ] as const)('refuses %s with 400, without reading a token or calling Lidarr', async (_label, body, error) => {
    const guid = await token();
    mocks.redis.get.mockClear();
    const res = await grabLidarr(body(guid));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(mocks.redis.get).not.toHaveBeenCalled();
    expect(mocks.lidarr.grabRelease).not.toHaveBeenCalled();
  });

  it('refuses a body that is not JSON with 400', async () => {
    const res = await grabLidarr('{not json');
    expect(res.status).toBe(400);
    expect(mocks.lidarr.grabRelease).not.toHaveBeenCalled();
  });

  it('forwards another download client, and none for the default (null)', async () => {
    const guid = await token();
    expect((await grabLidarr({ guid, indexerId: 8, downloadClientId: 3 })).status).toBe(200);
    expect(mocks.lidarr.grabRelease).toHaveBeenLastCalledWith(PASSKEY_GUID, 8, 3);
    expect((await grabLidarr({ guid, indexerId: 8, downloadClientId: null })).status).toBe(200);
    expect(mocks.lidarr.grabRelease).toHaveBeenLastCalledWith(PASSKEY_GUID, 8, undefined);
  });
});

describe('download clients', () => {
  it.each([
    ['Sonarr', sonarrClients, mocks.sonarr],
    ['Radarr', radarrClients, mocks.radarr],
    ['Lidarr', lidarrClients, mocks.lidarr],
  ] as const)('%s: only what the choice shows, not the settings', async (service, route, client) => {
    client.getDownloadClients.mockResolvedValue([{
      id: 1, name: 'qBittorrent', enable: true, protocol: 'torrent', priority: 1, implementation: 'QBittorrent', tags: [2],
      configContract: 'QBittorrentSettings',
      // As Sonarr v4 sends them: the password masked, the host and user name not.
      fields: [{ name: 'host', value: '10.0.0.5' }, { name: 'username', value: 'qbit' }, { name: 'password', value: '********' }],
    }]);
    const body = await (await route(new NextRequest(`http://localhost/api/${service.toLowerCase()}/downloadclient`))).json();
    expect(body).toEqual([{ id: 1, name: 'qBittorrent', enable: true, protocol: 'torrent', priority: 1, implementation: 'QBittorrent', tags: [2] }]);
  });
});
