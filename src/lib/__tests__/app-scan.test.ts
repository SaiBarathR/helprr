import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connections: [] as { type: string; url: string }[],
  // Container names resolve to a Docker address unless a test says otherwise.
  dns: {} as Record<string, string[]>,
  // Docker writes host.docker.internal into /etc/hosts.
  hosts: '',
  resolverOptions: [] as unknown[],
}));
// host.docker.internal apart from the gateway (172.17.0.1), so each target has its own address.
const HOSTS = '127.0.0.1\tlocalhost\n172.17.0.254\thost.docker.internal\n';
vi.mock('node:dns/promises', () => ({
  Resolver: class {
    constructor(options: unknown) {
      mocks.resolverOptions.push(options);
    }
    async resolve4(host: string) {
      const addresses = (mocks.dns[host] ?? ['172.18.0.5']).filter((address) => !address.includes(':'));
      if (addresses.length === 0) throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
      return addresses;
    }
    async resolve6(host: string) {
      const addresses = (mocks.dns[host] ?? []).filter((address) => address.includes(':'));
      if (addresses.length === 0) throw Object.assign(new Error('not found'), { code: 'ENODATA' });
      return addresses;
    }
  },
}));
vi.mock('@/lib/db', () => ({ prisma: { serviceConnection: { findMany: async () => mocks.connections } } }));
vi.mock('node:fs/promises', () => ({
  readFile: async (file: string) => file === '/etc/hosts'
    ? mocks.hosts
    : 'Iface\tDestination\tGateway\tFlags\neth0\t00000000\t010011AC\t0003\neth0\t000011AC\t00000000\t0001\n',
}));

import { fingerprint, hostsFileAddresses, isLocalAddress, parseDefaultGateway, scanForApps, scanTargets } from '@/lib/app-scan';
import { isScanAddress } from '@/lib/app-scan-targets';

type Route = { status?: number; body?: string; location?: string };
// The scan requests the address it checked for a name, so a route at a name is served at that address.
function at(url: string): string {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const fromHosts = mocks.hosts.split('\n').find((line) => line.split(/\s+/).slice(1).includes(host))?.split(/\s+/)[0];
  const address = /^[\d.]+$/.test(host) ? host : fromHosts ?? (mocks.dns[host] ?? ['172.18.0.5'])[0];
  return url.replace(`//${host}:`, `//${address.includes(':') ? `[${address}]` : address}:`);
}
let routes: Record<string, Route> = {};
let requested: string[] = [];
function serve(map: Record<string, Route>, { byAddress = false } = {}) {
  routes = byAddress ? Object.fromEntries(Object.entries(map).map(([url, route]) => [at(url), route])) : map;
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
  mocks.dns = {};
  mocks.hosts = HOSTS;
  mocks.resolverOptions = [];
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

describe('scanForApps, what it trusts', () => {
  it('skips a name that resolves outside the network, without asking it anything', async () => {
    mocks.dns = { sonarr: ['93.184.216.34'] };
    serve({ 'http://sonarr:8989/ping': OK, 'http://sonarr:8989/': { body: '<title>Sonarr</title>' } }, { byAddress: true });
    expect(await scanForApps(2_000_000)).toEqual([]);
    expect(requested.some((url) => url.includes('93.184.216.34'))).toBe(false);
  });

  it('takes /etc/hosts over DNS, and skips a public address there too', async () => {
    mocks.hosts = `${HOSTS}8.8.8.8\tsonarr\n`;
    mocks.dns = { sonarr: ['172.18.0.5'] };
    serve({ 'http://sonarr:8989/ping': OK, 'http://sonarr:8989/': { body: '<title>Sonarr</title>' } }, { byAddress: true });
    expect(await scanForApps(2_100_000)).toEqual([]);
    expect(requested.some((url) => url.includes('8.8.8.8') || url.includes('172.18.0.5:8989'))).toBe(false);
  });

  it('sends its requests to the address it checked, not to a second lookup of the name', async () => {
    mocks.dns = { sonarr: ['172.18.0.9'] };
    serve({ 'http://172.18.0.9:8989/ping': OK, 'http://172.18.0.9:8989/': { body: '<title>Sonarr</title>' } });
    expect((await scanForApps(2_150_000)).map((app) => app.url)).toContain('http://sonarr:8989');
    expect(requested).toContain('http://172.18.0.9:8989/ping');
    expect(requested.some((url) => url.startsWith('http://sonarr:'))).toBe(false);
  });

  it('skips a name whose address is not a plain address, instead of asking for the name again', async () => {
    mocks.hosts = `${HOSTS}fe80::1%eth0\tsonarr\n`;
    serve({ 'http://sonarr:8989/ping': OK, 'http://sonarr:8989/': { body: '<title>Sonarr</title>' } });
    expect((await scanForApps(2_160_000)).some((app) => app.url === 'http://sonarr:8989')).toBe(false);
    expect(requested.some((url) => url.startsWith('http://sonarr:'))).toBe(false);
  });

  it('asks DNS once, with a short timeout, so a missing name cannot hold the scan up', async () => {
    serve({});
    await scanForApps(2_200_000);
    expect(mocks.resolverOptions.length).toBeGreaterThan(0);
    for (const options of mocks.resolverOptions) expect(options).toEqual({ timeout: 1000, tries: 1 });
  });

  it('shows the address Helprr already has, and says when another may be the same app', async () => {
    serve({
      'http://sonarr:8989/ping': OK,
      'http://sonarr:8989/': { body: '<title>Sonarr</title>' },
      'http://host.docker.internal:8989/ping': OK,
      'http://host.docker.internal:8989/': { body: '<title>Sonarr</title>' },
      'http://radarr:7878/ping': OK,
      'http://radarr:7878/': { body: '<title>Radarr</title>' },
    }, { byAddress: true });
    mocks.connections = [
      { type: 'SONARR', url: 'http://HOST.docker.internal:8989/' },
      { type: 'RADARR', url: 'http://192.168.1.10:7878' },
    ];
    expect(await scanForApps(3_000_000)).toEqual([
      { type: 'SONARR', url: 'http://host.docker.internal:8989', connected: true, hasOther: false },
      { type: 'RADARR', url: 'http://radarr:7878', connected: false, hasOther: true },
    ]);
  });

  it.each([
    ['172.18.0.5', true], ['10.0.0.1', true], ['127.0.0.1', true], ['169.254.1.1', true], ['100.100.1.1', true],
    ['fd00::1', true], ['fe80::1', true], ['::1', true], ['8.8.8.8', false], ['2606:4700::1', false],
  ])('counts %s as local: %s', (address, local) => {
    expect(isLocalAddress(address)).toBe(local);
  });
});

describe('isScanAddress (what a link may fill into the form)', () => {
  it.each([
    ['SONARR', 'http://sonarr:8989', true],
    ['SONARR', 'http://host.docker.internal:8989', true],
    ['SONARR', 'http://172.17.0.1:8989', true],
    ['SEERR', 'http://jellyseerr:5055', true],
    ['SONARR', 'http://evil.example:8989', false],
    ['SONARR', 'http://sonarr:7878', false],
    ['SONARR', 'http://user:pass@sonarr:8989', false],
    ['SONARR', 'http://sonarr:8989/path', false],
    ['SONARR', 'https://sonarr:8989', false],
    ['SONARR', 'http://8.8.8.8:8989', false],
    ['TMDB', 'http://sonarr:8989', false],
  ])('%s %s: %s', (type, url, allowed) => {
    expect(isScanAddress(type, url)).toBe(allowed);
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
    }, { byAddress: true });
    mocks.connections = [{ type: 'RADARR', url: 'http://172.17.0.1:7878/' }];
    const found = await scanForApps(1_000_000);
    expect(found).toEqual([
      { type: 'SONARR', url: 'http://sonarr:8989', connected: false, hasOther: false },
      { type: 'RADARR', url: 'http://172.17.0.1:7878', connected: true, hasOther: false },
    ]);
    const before = requested.length;
    mocks.connections = [];
    const again = await scanForApps(1_010_000);
    expect(requested.length).toBe(before);
    expect(again.find((app) => app.type === 'RADARR')?.connected).toBe(false);
    await scanForApps(1_031_000);
    expect(requested.length).toBeGreaterThan(before);
    // Every request went to a fixed target (the gateway is the one in the route table).
    const bases = scanTargets('172.17.0.1').map((target) => at(target.url));
    expect(requested.every((url) => bases.some((base) => url.startsWith(`${base}/`)))).toBe(true);
  });
});

describe('hostsFileAddresses', () => {
  it('reads every address /etc/hosts gives a name, and nothing from comments', () => {
    const file = '# 1.2.3.4 host.docker.internal\n127.0.0.1 localhost\n172.17.0.1\thost.docker.internal  other\nfd00::1 HOST.DOCKER.INTERNAL\n';
    expect(hostsFileAddresses(file, 'host.docker.internal')).toEqual(['172.17.0.1', 'fd00::1']);
    expect(hostsFileAddresses(file, 'sonarr')).toEqual([]);
  });
});
