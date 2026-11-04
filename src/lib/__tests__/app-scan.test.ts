import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ connections: [] as { type: string; url: string }[] }));
vi.mock('@/lib/db', () => ({ prisma: { serviceConnection: { findMany: async () => mocks.connections } } }));
vi.mock('node:fs/promises', () => ({
  readFile: async () => 'Iface\tDestination\tGateway\tFlags\neth0\t00000000\t010011AC\t0003\neth0\t000011AC\t00000000\t0001\n',
}));

import { fingerprint, parseDefaultGateway, scanForApps, scanTargets } from '@/lib/app-scan';

type Route = { status?: number; body?: string; location?: string };
let routes: Record<string, Route> = {};
let requested: string[] = [];
function serve(map: Record<string, Route>) {
  routes = map;
  requested = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    requested.push(url);
    expect(init.redirect).toBe('manual');
    expect(init.headers).toBeUndefined();
    const route = routes[url];
    if (!route) throw new TypeError('fetch failed');
    return new Response(route.body ?? '', {
      status: route.status ?? 200,
      headers: route.location ? { location: route.location } : {},
    });
  });
}
const OK = { body: '{ "status": "OK" }' };

beforeEach(() => {
  mocks.connections = [];
  delete (globalThis as { __helprrAppScan?: unknown }).__helprrAppScan;
});

describe('scanTargets', () => {
  it('is the fixed list: container names, host.docker.internal and a private gateway, on each usual port', () => {
    const targets = scanTargets('172.17.0.1');
    const hosts = new Set(targets.map((target) => new URL(target.url).hostname));
    expect([...hosts].sort()).toEqual(
      ['172.17.0.1', 'host.docker.internal', 'jellyfin', 'jellyseerr', 'lidarr', 'overseerr', 'prowlarr', 'qbittorrent', 'radarr', 'seerr', 'sonarr'],
    );
    const ports = Object.fromEntries(targets.map((target) => [target.type, new URL(target.url).port]));
    expect(ports).toEqual({ SONARR: '8989', RADARR: '7878', LIDARR: '8686', PROWLARR: '9696', QBITTORRENT: '8080', JELLYFIN: '8096', SEERR: '5055' });
    expect(targets.every((target) => target.url.startsWith('http://') && !target.url.includes('@'))).toBe(true);
  });

  it.each([null, '8.8.8.8', 'evil.example', '169.254.169.254', '192.168.1.1:80'])('never adds a gateway of %s', (gateway) => {
    const hosts = new Set(scanTargets(gateway).map((target) => new URL(target.url).hostname));
    expect(hosts.has(String(gateway))).toBe(false);
    expect(hosts.size).toBe(10);
  });
});

describe('parseDefaultGateway', () => {
  it('reads the default route, little-endian', () => {
    expect(parseDefaultGateway('Iface\tDestination\tGateway\neth0\t00000000\t0100A8C0\n')).toBe('192.168.0.1');
  });
  it('ignores a public or missing gateway', () => {
    expect(parseDefaultGateway('Iface\tDestination\tGateway\neth0\t00000000\t08080808\n')).toBeNull();
    expect(parseDefaultGateway('Iface\tDestination\tGateway\neth0\t000011AC\t00000000\n')).toBeNull();
  });
});

describe('fingerprint', () => {
  const sonarr = 'http://sonarr:8989';

  it('names a Servarr app by its page title, and never reads /initialize.json', async () => {
    serve({ [`${sonarr}/ping`]: OK, [`${sonarr}/`]: { body: '<html><head><title>Sonarr</title>' } });
    expect(await fingerprint('SONARR', sonarr)).toBe(true);
    expect(await fingerprint('RADARR', sonarr)).toBe(false);
    expect(requested.some((url) => url.includes('initialize'))).toBe(false);
  });

  it('reads the login page when the app sends there', async () => {
    const prowlarr = 'http://prowlarr:9696';
    serve({
      [`${prowlarr}/ping`]: OK,
      [`${prowlarr}/`]: { status: 302, location: '/login?returnUrl=%2F' },
      [`${prowlarr}/login`]: { body: '<title>Login - Prowlarr</title>' },
    });
    expect(await fingerprint('PROWLARR', prowlarr)).toBe(true);
  });

  it('does not follow a redirect to another address', async () => {
    serve({ [`${sonarr}/ping`]: OK, [`${sonarr}/`]: { status: 302, location: 'http://elsewhere.example/login' }, 'http://elsewhere.example/login': { body: '<title>Sonarr</title>' } });
    expect(await fingerprint('SONARR', sonarr)).toBe(false);
    expect(requested).not.toContain('http://elsewhere.example/login');
  });

  it('knows Jellyfin, Seerr and qBittorrent by their public answers', async () => {
    serve({
      'http://jellyfin:8096/System/Info/Public': { body: '{"ProductName":"Jellyfin Server","Version":"10.11.0"}' },
      'http://seerr:5055/api/v1/status': { body: '{"version":"3.5.0","commitTag":"local"}' },
      'http://qbittorrent:8080/api/v2/app/webapiVersion': { status: 403, body: 'Forbidden' },
      'http://qbittorrent:8080/': { body: '<title>VueTorrent</title>' },
    });
    expect(await fingerprint('JELLYFIN', 'http://jellyfin:8096')).toBe(true);
    expect(await fingerprint('SEERR', 'http://seerr:5055')).toBe(true);
    expect(await fingerprint('QBITTORRENT', 'http://qbittorrent:8080')).toBe(true);
  });

  it('does not take any web page for qBittorrent', async () => {
    serve({ 'http://qbittorrent:8080/api/v2/app/webapiVersion': { status: 404 }, 'http://qbittorrent:8080/': { body: '<title>qBittorrent</title>' } });
    expect(await fingerprint('QBITTORRENT', 'http://qbittorrent:8080')).toBe(false);
  });
});

describe('scanForApps', () => {
  it('finds each app once, marks what Helprr has, and scans at most every 30 seconds', async () => {
    serve({
      'http://sonarr:8989/ping': OK,
      'http://sonarr:8989/': { body: '<title>Sonarr</title>' },
      'http://host.docker.internal:8989/ping': OK,
      'http://host.docker.internal:8989/': { body: '<title>Sonarr</title>' },
      'http://172.17.0.1:7878/ping': OK,
      'http://172.17.0.1:7878/': { body: '<title>Radarr</title>' },
    });
    mocks.connections = [{ type: 'RADARR', url: 'http://172.17.0.1:7878/' }];
    const found = await scanForApps(1_000_000);
    expect(found).toEqual([
      { type: 'SONARR', url: 'http://sonarr:8989', connected: false },
      { type: 'RADARR', url: 'http://172.17.0.1:7878', connected: true },
    ]);
    const before = requested.length;
    mocks.connections = [];
    const again = await scanForApps(1_010_000);
    expect(requested.length).toBe(before);
    expect(again.find((app) => app.type === 'RADARR')?.connected).toBe(false);
    await scanForApps(1_031_000);
    expect(requested.length).toBeGreaterThan(before);
    // Every request went to a fixed target (the gateway is the one in the route table).
    const bases = scanTargets('172.17.0.1').map((target) => target.url);
    expect(requested.every((url) => bases.some((base) => url.startsWith(`${base}/`)))).toBe(true);
  });
});
