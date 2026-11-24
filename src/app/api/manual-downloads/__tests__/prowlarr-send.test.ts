import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// A Prowlarr search result sent to Radarr through the manual-download routes:
// the browser holds only the release token, the server fetches the release.
const mocks = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    user: { id: 'u1', username: 'member', role: 'member', capabilities: {} as Record<string, boolean> },
    logging: [] as Array<{ name: string; options?: unknown }>,
    prowlarr: { searchReleases: vi.fn(), getIndexers: vi.fn(async () => []), fetchReleaseLink: vi.fn() },
    preflight: vi.fn(),
    send: vi.fn(),
    redis: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => { store.set(key, value); return 'OK'; }),
      multi: vi.fn(() => {
        const batch = {
          set: vi.fn((key: string, value: string) => { store.set(key, value); return batch; }),
          exec: vi.fn(async () => []),
        };
        return batch;
      }),
    },
  };
});
vi.mock('@/lib/auth', () => ({
  requireUserCapability: async () => ({ ok: true, user: mocks.user }),
  requireUserAnyCapability: async () => ({ ok: true, user: mocks.user }),
  requireUserAllCapabilities: async () => ({ ok: true, user: mocks.user }),
}));
vi.mock('@/lib/permissions', () => ({ can: (user: typeof mocks.user, cap: string) => user.capabilities[cap] === true }));
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown, name: string, options?: unknown) => { mocks.logging.push({ name, options }); return handler; },
}));
vi.mock('@/lib/redis', () => ({ getRedisClient: vi.fn(async () => mocks.redis) }));
vi.mock('@/lib/service-helpers', () => ({ getProwlarrClient: vi.fn(async () => mocks.prowlarr) }));
vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/manual-downloads/preflight', () => ({ preflightManualDownload: mocks.preflight }));
vi.mock('@/lib/manual-downloads/send', () => ({
  sendManualDownload: mocks.send,
  ManualDownloadRefusedError: class extends Error {},
}));

import { GET as searchGet } from '@/app/api/prowlarr/search/route';
import { POST as preflightPost } from '../preflight/route';
import { POST as sendPost } from '../route';

const SECRET = 'S3cretProwlarrKey0123456789';
const HASH = '382CC016FF22946008ECDDCB0DDA820F42B0CD5A';
const PROWLARR_MAGNET = `magnet:?xt=urn:btih:${HASH.toLowerCase()}&dn=Big.Buck.Bunny.2008.720p&tr=https://tracker.example/${SECRET}/announce`;
const FORGED = 'magnet:?xt=urn:btih:1111111111111111111111111111111111111111&dn=Forged';
const release = {
  guid: `https://tracker.example/details?id=5&passkey=${SECRET}`,
  indexerId: 6,
  indexer: 'Knaben',
  title: 'Big Buck Bunny 2008 720p BluRay x264',
  size: 1000,
  seeders: 3,
  protocol: 'torrent',
  downloadUrl: `http://prowlarr:9696/6/download?apikey=${SECRET}&link=t`,
  magnetUrl: `http://prowlarr:9696/6/download?apikey=${SECRET}&link=m`,
};
const ALL = { 'prowlarr.manage': true, 'movies.add': true, 'torrents.add': true, 'activity.manage': true };

async function searchToken(): Promise<string> {
  const res = await searchGet(new NextRequest('http://localhost/api/prowlarr/search?q=bunny'));
  return (await res.json()).results[0].id;
}
function body(extra: Record<string, unknown>, torrent?: Blob): FormData {
  const form = new FormData();
  form.append('request', JSON.stringify({ service: 'RADARR', instanceId: 'i1', externalId: 10378, clientRequestId: 'req-00001', ...extra }));
  if (torrent) form.append('torrent', torrent, 'forged.torrent');
  return form;
}
const preflight = (form: FormData) => preflightPost(new Request('http://localhost/api/manual-downloads/preflight', { method: 'POST', body: form }));
const send = (form: FormData) => sendPost(new Request('http://localhost/api/manual-downloads', { method: 'POST', body: form }));

const logged: string[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.store.clear();
  logged.length = 0;
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(' ')); });
  }
  mocks.user.capabilities = { ...ALL };
  mocks.prowlarr.searchReleases.mockResolvedValue([release]);
  mocks.prowlarr.fetchReleaseLink.mockResolvedValue({ kind: 'MAGNET', magnetUrl: PROWLARR_MAGNET });
  // The real preflight and send are covered on their own; these echo what they were given.
  mocks.preflight.mockImplementation(async (input) => ({ ok: true, errors: [], warnings: [], plan: { release: { title: input.releaseTitle, name: input.source.name, infoHash: input.source.infoHash, source: input.source.kind } } }));
  mocks.send.mockImplementation(async (input) => ({ id: 'md1', mode: 'ARR_MANAGED', status: 'QUEUED', service: 'RADARR', infoHash: input.source.infoHash, createdAt: new Date(), updatedAt: new Date(), completedAt: null, events: [] }));
});
afterEach(() => vi.restoreAllMocks());

describe('sending a Prowlarr search result to Sonarr or Radarr', () => {
  it('checks and sends the release Prowlarr holds, fetched once, and never hands back its links', async () => {
    const token = await searchToken();

    const checked = await preflight(body({ prowlarrRelease: token, releaseTitle: release.title }));
    const sent = await send(body({ prowlarrRelease: token, releaseTitle: release.title }));
    const texts = [await checked.text(), await sent.text()];

    expect(checked.status).toBe(200);
    expect(sent.status).toBe(201);
    expect(mocks.prowlarr.fetchReleaseLink).toHaveBeenCalledTimes(1);
    expect(mocks.prowlarr.fetchReleaseLink).toHaveBeenCalledWith(release.magnetUrl);
    expect(mocks.preflight.mock.calls[0][0].source).toEqual(expect.objectContaining({ kind: 'MAGNET', infoHash: HASH }));
    expect(mocks.send.mock.calls[0][0].source).toEqual(expect.objectContaining({ kind: 'MAGNET', infoHash: HASH }));
    expect(mocks.send.mock.calls[0][2]).toEqual({ id: 'u1', username: 'member' });
    for (const text of texts) {
      expect(text).not.toContain(SECRET);
      expect(text).not.toMatch(/magnet:|apikey|downloadUrl/i);
    }
    expect(logged.join('\n')).not.toContain(SECRET);
    // Neither POST logs its request body.
    expect(mocks.logging).toContainEqual({ name: 'api/manual-downloads/preflight', options: { logBodies: false } });
    expect(mocks.logging).toContainEqual({ name: 'api/manual-downloads', options: { logBodies: false } });
  });

  it('ignores a magnet or .torrent sent beside the token', async () => {
    const token = await searchToken();

    await preflight(body({ prowlarrRelease: token, magnetUrl: FORGED }, new Blob(['d4:infoe'])));
    await send(body({ prowlarrRelease: token, magnetUrl: FORGED }));

    expect(mocks.preflight.mock.calls[0][0].source.infoHash).toBe(HASH);
    expect(mocks.send.mock.calls[0][0].source.infoHash).toBe(HASH);
  });

  it('needs prowlarr.manage, the library\'s add capability and monitoring when asked, before Prowlarr is asked for anything', async () => {
    const token = await searchToken();
    for (const missing of ['prowlarr.manage', 'movies.add']) {
      mocks.user.capabilities = { ...ALL, [missing]: false };
      expect((await preflight(body({ prowlarrRelease: token }))).status, missing).toBe(403);
      expect((await send(body({ prowlarrRelease: token }))).status, missing).toBe(403);
    }
    mocks.user.capabilities = { ...ALL };
    expect((await send(body({ prowlarrRelease: token, monitorTarget: true }))).status).toBe(403);
    // Sonarr needs series.add, which this account lacks.
    expect((await send(body({ prowlarrRelease: token, service: 'SONARR' }))).status).toBe(403);

    expect(mocks.prowlarr.fetchReleaseLink).not.toHaveBeenCalled();
    expect(mocks.preflight).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();

    // A plain magnet still needs no Prowlarr access.
    mocks.user.capabilities = { ...ALL, 'prowlarr.manage': false };
    expect((await preflight(body({ magnetUrl: FORGED }))).status).toBe(200);
  });

  it('refuses a send with no request id or bad add options before Prowlarr is asked', async () => {
    const token = await searchToken();

    expect((await send(body({ prowlarrRelease: token, clientRequestId: undefined }))).status).toBe(400);
    expect((await send(body({ prowlarrRelease: token, add: { qualityProfileId: 0, rootFolderPath: '/m' } }))).status).toBe(400);
    expect((await preflight(body({ prowlarrRelease: token, add: { qualityProfileId: 1, rootFolderPath: '' } }))).status).toBe(400);

    expect(mocks.prowlarr.fetchReleaseLink).not.toHaveBeenCalled();
  });

  it('treats an expired token, or one issued to another user, as expired', async () => {
    const token = await searchToken();
    mocks.user.id = 'u2';
    try {
      const res = await send(body({ prowlarrRelease: token }));
      expect(res.status).toBe(410);
      expect(await res.json()).toEqual({ error: 'This result has expired. Search again.' });
    } finally {
      mocks.user.id = 'u1';
    }
    expect((await preflight(body({ prowlarrRelease: 'gone-token' }))).status).toBe(410);
    expect(mocks.prowlarr.fetchReleaseLink).not.toHaveBeenCalled();
  });

  it('says so when Prowlarr cannot fetch the release, without its link', async () => {
    const token = await searchToken();
    mocks.prowlarr.fetchReleaseLink.mockRejectedValue(new Error(`connect ECONNREFUSED ${release.downloadUrl}`));

    const res = await preflight(body({ prowlarrRelease: token }));
    const text = await res.text();

    expect(res.status).toBe(502);
    expect(text).not.toContain(SECRET);
    expect(logged.join('\n')).not.toContain(SECRET);
  });
});
