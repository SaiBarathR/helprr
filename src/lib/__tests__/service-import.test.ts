import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fixture keys only.
const SEERR_SONARR_KEY = ['seerr', 'sonarr', 'key', '0123456789abcdef'].join('-');
const TYPED_KEY = ['typed', 'key', '0123456789'].join('-');

const mocks = vi.hoisted(() => ({
  connections: [] as { type: string; url: string; label?: string }[],
  created: [] as Record<string, unknown>[],
  seerrServers: {} as Record<string, unknown[]>,
  apps: [] as unknown[],
  answers: new Set<string>(),
  statusCalls: [] as { type: string; url: string; apiKey: string }[],
  statusError: null as unknown,
  ensureDefault: vi.fn(),
}));

const fakeClient = vi.hoisted(() => (type: string) =>
  class {
    constructor(private url: string, private apiKey: string) {}
    async getSystemStatus() {
      mocks.statusCalls.push({ type, url: this.url, apiKey: this.apiKey });
      if (mocks.statusError) throw mocks.statusError;
      return { version: '4.0.0' };
    }
  });

vi.mock('@/lib/db', () => ({
  prisma: {
    serviceConnection: {
      findMany: async () => mocks.connections,
      findFirst: async ({ where }: { where: { type: string; label: string } }) =>
        mocks.connections.find((c) => c.type === where.type && c.label === where.label) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        mocks.created.push(data);
        return { id: `new-${mocks.created.length}`, ...data };
      },
    },
  },
}));
vi.mock('@/lib/service-helpers', () => ({
  getSeerrClient: async () => ({ getArrServers: async (kind: string) => mocks.seerrServers[kind] ?? [] }),
  getProwlarrClient: async () => ({ getApplications: async () => mocks.apps }),
}));
vi.mock('@/lib/sonarr-client', () => ({ SonarrClient: fakeClient('SONARR') }));
vi.mock('@/lib/radarr-client', () => ({ RadarrClient: fakeClient('RADARR') }));
vi.mock('@/lib/lidarr-client', () => ({ LidarrClient: fakeClient('LIDARR') }));
vi.mock('@/lib/arr-instances', () => ({ ensureDefaultForType: mocks.ensureDefault, clearConnectionMemo: vi.fn() }));
vi.mock('@/lib/cache/reference-labels', () => ({ invalidateReferenceLabels: vi.fn() }));
vi.mock('@/lib/connection-hints', () => ({ connectionFailureHint: () => null, currentHintContext: async () => ({}) }));

import { discoverImportCandidates, importServices } from '@/lib/service-import';

const seerrSonarr = { id: 0, name: 'Sonarr', hostname: '192.168.0.124', port: 8989, useSsl: false, apiKey: SEERR_SONARR_KEY, is4k: false, isDefault: true };
const prowlarrApp = (id: number, implementation: string, name: string, baseUrl: string) => ({
  id, name, implementation, implementationName: implementation, syncLevel: 'fullSync', enable: true,
  fields: [{ name: 'baseUrl', value: baseUrl }, { name: 'apiKey', value: '********' }],
});

beforeEach(() => {
  mocks.connections = [
    { type: 'SEERR', url: 'http://192.168.0.124:5055' },
    { type: 'PROWLARR', url: 'http://192.168.0.124:9696' },
  ];
  mocks.created = [];
  mocks.seerrServers = { sonarr: [seerrSonarr], radarr: [] };
  mocks.apps = [prowlarrApp(5, 'Sonarr', 'Sonarr-anime', 'http://localhost:8990'), prowlarrApp(6, 'Lidarr', 'Lidarr', 'http://localhost:8686')];
  mocks.answers = new Set(['http://192.168.0.124:8989/ping', 'http://192.168.0.124:8990/ping']);
  mocks.statusCalls = [];
  mocks.statusError = null;
  mocks.ensureDefault.mockReset();
  vi.stubGlobal('fetch', async (url: string) => ({ status: mocks.answers.has(url) ? 200 : 503 }));
});

describe('discoverImportCandidates', () => {
  it("lists Seerr's and Prowlarr's apps and never sends a key to the browser", async () => {
    const { candidates, sources } = await discoverImportCandidates();
    expect(sources).toEqual({ seerr: 'ok', prowlarr: 'ok' });
    expect(JSON.stringify(candidates)).not.toContain(SEERR_SONARR_KEY);
    expect(JSON.stringify(candidates)).not.toContain('apiKey');
    expect(candidates.find((c) => c.id === 'seerr:sonarr:0')).toMatchObject({
      type: 'SONARR', url: 'http://192.168.0.124:8989', reachable: true, needsKey: false, connected: false,
    });
  });

  it("finds a Prowlarr app's localhost address on Prowlarr's own host, or says it does not answer", async () => {
    const { candidates } = await discoverImportCandidates();
    expect(candidates.find((c) => c.id === 'prowlarr:5')).toMatchObject({ url: 'http://192.168.0.124:8990', reachable: true, needsKey: true });
    expect(candidates.find((c) => c.id === 'prowlarr:6')).toMatchObject({ url: 'http://localhost:8686', reachable: false });
  });

  it('marks apps Helprr already has, by address or by the port of a localhost address', async () => {
    mocks.connections.push({ type: 'SONARR', url: 'http://192.168.0.124:8989/' }, { type: 'LIDARR', url: 'http://nas.lan:8686' });
    const { candidates } = await discoverImportCandidates();
    expect(candidates.find((c) => c.id === 'seerr:sonarr:0')?.connected).toBe(true);
    expect(candidates.find((c) => c.id === 'prowlarr:6')?.connected).toBe(true);
    expect(candidates.find((c) => c.id === 'prowlarr:5')?.connected).toBe(false);
  });

  it('says which source failed, and lists nothing without Seerr or Prowlarr', async () => {
    mocks.connections = [];
    expect(await discoverImportCandidates()).toEqual({ candidates: [], sources: { seerr: 'missing', prowlarr: 'missing' } });
  });
});

describe('importServices', () => {
  it("adds a Seerr app with Seerr's key, after testing it at Seerr's address", async () => {
    const [result] = await importServices([{ id: 'seerr:sonarr:0' }]);
    expect(result).toEqual({ id: 'seerr:sonarr:0', ok: true, label: 'Sonarr' });
    expect(mocks.statusCalls).toEqual([{ type: 'SONARR', url: 'http://192.168.0.124:8989', apiKey: SEERR_SONARR_KEY }]);
    expect(mocks.created).toEqual([{ type: 'SONARR', label: 'Sonarr', url: 'http://192.168.0.124:8989', apiKey: SEERR_SONARR_KEY }]);
    expect(mocks.ensureDefault).toHaveBeenCalledWith('SONARR');
  });

  it("never sends Seerr's key to another address", async () => {
    const [result] = await importServices([{ id: 'seerr:sonarr:0', url: 'http://evil.example:8989' }]);
    expect(result).toMatchObject({ ok: false, error: 'Enter the API key to use another address.' });
    expect(mocks.statusCalls).toEqual([]);
    const [typed] = await importServices([{ id: 'seerr:sonarr:0', url: 'http://sonarr.lan:8989', apiKey: TYPED_KEY }]);
    expect(typed.ok).toBe(true);
    expect(mocks.statusCalls).toEqual([{ type: 'SONARR', url: 'http://sonarr.lan:8989', apiKey: TYPED_KEY }]);
  });

  it('needs a typed key for a Prowlarr app, and uses the address chosen', async () => {
    expect((await importServices([{ id: 'prowlarr:5' }]))[0]).toMatchObject({ ok: false, error: 'Enter the API key.' });
    const [result] = await importServices([{ id: 'prowlarr:5', apiKey: TYPED_KEY, label: 'Anime' }]);
    expect(result).toEqual({ id: 'prowlarr:5', ok: true, label: 'Anime' });
    expect(mocks.created[0]).toMatchObject({ type: 'SONARR', label: 'Anime', url: 'http://192.168.0.124:8990' });
  });

  it('saves nothing the test turned down, or under a name already taken', async () => {
    mocks.statusError = Object.assign(new Error('Unauthorized'), { response: { status: 401 } });
    expect((await importServices([{ id: 'prowlarr:5', apiKey: TYPED_KEY }]))[0]).toMatchObject({ ok: false, error: 'The app turned down the API key.' });
    mocks.statusError = null;
    mocks.connections.push({ type: 'SONARR', url: 'http://other:8989', label: 'Sonarr' });
    expect((await importServices([{ id: 'seerr:sonarr:0' }]))[0]).toMatchObject({ ok: false, error: 'An instance named "Sonarr" already exists for this service.' });
    expect(mocks.created).toEqual([]);
  });

  it('lists an app Seerr and Prowlarr both know once, keeping Seerr\'s known key', async () => {
    mocks.apps.push(prowlarrApp(7, 'Sonarr', 'Sonarr', 'http://localhost:8989'));
    const { candidates } = await discoverImportCandidates();
    const sonarrs = candidates.filter((c) => c.type === 'SONARR' && c.url === 'http://192.168.0.124:8989');
    expect(sonarrs.map((c) => c.id)).toEqual(['seerr:sonarr:0']);
  });

  it('refuses to add an app Helprr already has at that address', async () => {
    mocks.connections.push({ type: 'SONARR', url: 'http://192.168.0.124:8990', label: 'Anime' });
    expect((await importServices([{ id: 'prowlarr:5', apiKey: TYPED_KEY, label: 'Anime 2' }]))[0]).toMatchObject({
      ok: false,
      error: 'Helprr already has this app at that address.',
    });
    expect(mocks.statusCalls).toEqual([]);
  });

  it('refuses an id that is not listed', async () => {
    expect((await importServices([{ id: 'prowlarr:999', apiKey: TYPED_KEY }]))[0]).toMatchObject({ ok: false });
    expect(mocks.statusCalls).toEqual([]);
  });
});
