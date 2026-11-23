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

  it('works on the default instance, and keeps it apart from a named one', async () => {
    const [first, second] = await (await get(sonarrSearch, '/api/sonarr/release?episodeId=5')).json();
    expect((await post(sonarrGrab, '/api/sonarr/release', { guid: first.guid, indexerId: 8 })).status).toBe(200);
    expect(mocks.sonarr.grabRelease).toHaveBeenCalledWith({ guid: PASSKEY_GUID, indexerId: 8 });
    expect((await post(sonarrGrab, '/api/sonarr/release?instanceId=son-1', { guid: second.guid, indexerId: 8 })).status).toBe(410);
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
