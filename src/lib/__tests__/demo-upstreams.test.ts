import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The demo's fake upstreams (demo/fake-upstreams.mjs), which invent their library at start-up.
describe('demo fake upstreams', () => {
  // A block of free ports, below the range the system hands out for other connections
  // (32768 and up), so nothing else running can take one while the server starts.
  let OFFSET = 0;
  let server: ChildProcess;
  const url = (port: number, p: string) => `http://127.0.0.1:${port + OFFSET}${p}`;
  const json = async (port: number, p: string, init?: RequestInit) => (await fetch(url(port, p), init)).json();

  beforeAll(async () => {
    const free = (port: number) => new Promise<boolean>((resolve) => {
      const probe = net.createServer().once('error', () => resolve(false)).listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
    });
    for (let tries = 0; !OFFSET && tries < 20; tries++) {
      const offset = 10_000 + Math.floor(Math.random() * 120) * 100;
      if ((await Promise.all([8989, 7878, 8686, 8080, 9696, 8096, 5055, 9000].map((port) => free(port + offset)))).every(Boolean)) OFFSET = offset;
    }
    // Never the real ports: on a machine running the real apps, the tests would reach them.
    if (!OFFSET) throw new Error('No free block of ports for the demo upstreams.');
    server = spawn(process.execPath, ['demo/fake-upstreams.mjs'], { env: { ...process.env, DEMO_PORT_OFFSET: String(OFFSET) }, stdio: 'pipe' });
    await new Promise<void>((resolve, reject) => {
      let out = '';
      server.stdout!.on('data', (chunk) => {
        out += chunk;
        if (out.includes('demo images on')) resolve();
      });
      server.on('exit', (code) => reject(new Error(`fake upstreams exited ${code}`)));
    });
  });
  afterAll(() => {
    server?.kill();
  });

  it('commits no recorded answers', () => {
    expect(existsSync(path.join(process.cwd(), 'demo', 'fixtures'))).toBe(false);
  });

  it('answers each app’s status, so every connection test passes', async () => {
    const names = await Promise.all([
      json(8989, '/api/v3/system/status').then((s) => s.appName),
      json(7878, '/api/v3/system/status').then((s) => s.appName),
      json(8686, '/api/v1/system/status').then((s) => s.appName),
      json(9696, '/api/v1/system/status').then((s) => s.appName),
      json(8096, '/System/Info').then((s) => s.ProductName),
      json(5055, '/api/v1/auth/me').then((s) => s.displayName),
      fetch(url(8080, '/api/v2/app/version')).then((r) => r.text()),
    ]);
    expect(names).toEqual(['Sonarr', 'Radarr', 'Lidarr', 'Prowlarr', 'Jellyfin Server', 'Alex Rivers', 'v5.1.2']);
  });

  it('keeps the calendar current: episodes and films still to come', async () => {
    const start = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + 45 * 86_400_000).toISOString().slice(0, 10);
    const episodes = await json(8989, `/api/v3/calendar?start=${start}&end=${end}`);
    const movies = await json(7878, `/api/v3/calendar?start=${start}&end=${end}`);
    expect(episodes.length).toBeGreaterThan(0);
    expect(movies.length).toBeGreaterThan(0);
    for (const ep of episodes) expect(Date.parse(ep.airDateUtc)).toBeGreaterThanOrEqual(Date.parse(start));
  });

  it('ends the calendar at the time asked, not a day later', async () => {
    const start = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const end = new Date().toISOString();
    const episodes = await json(8989, `/api/v3/calendar?start=${start}&end=${end}`);
    expect(episodes.length).toBeGreaterThan(0);
    for (const ep of episodes) expect(Date.parse(ep.airDateUtc)).toBeLessThan(Date.parse(end));
  });

  it('answers a request line that is not a URL with 400, and keeps running', async () => {
    const status = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(8989 + OFFSET, '127.0.0.1', () => socket.write('GET http://[bad HTTP/1.1\r\nHost: x\r\n\r\n'));
      socket.once('data', (chunk) => { resolve(chunk.toString().split('\r\n')[0]); socket.destroy(); });
      socket.once('error', reject);
    });
    expect(status).toMatch(/ 400 /);
    expect((await fetch(url(8989, '/api/v3/system/status'))).status).toBe(200);
  });

  it('answers the query asked: one series, one page', async () => {
    const episodes = await json(8989, '/api/v3/episode?seriesId=3');
    expect(episodes.length).toBeGreaterThan(0);
    expect(episodes.every((ep: { seriesId: number }) => ep.seriesId === 3)).toBe(true);
    const history = await json(8989, '/api/v3/history?page=1&pageSize=2');
    expect(history.records).toHaveLength(2);
    expect(history.totalRecords).toBeGreaterThan(2);
    expect((await fetch(url(7878, '/api/v3/movie/9999'))).status).toBe(404);
  });

  it('runs Playback Reporting queries, read-only', async () => {
    const query = (sql: string) => json(8096, '/user_usage_stats/submit_custom_query', { method: 'POST', body: JSON.stringify({ CustomQueryString: sql }) });
    const count = await query('SELECT COUNT(*) as total FROM PlaybackActivity');
    expect(Number(count.results[0][0])).toBeGreaterThan(0);
    expect((await query('DELETE FROM PlaybackActivity')).results).toEqual([]);
    expect((await query("SELECT * FROM pragma_database_list WHERE name = 'x'")).results).toEqual([]);
    expect((await query('SELECT 1; DELETE FROM PlaybackActivity')).results).toEqual([['1']]);
    expect(await query('SELECT COUNT(*) as total FROM PlaybackActivity')).toEqual(count);
  });

  it('turns every write away as read-only', async () => {
    for (const [port, p, method] of [[8989, '/api/v3/series', 'POST'], [8096, '/Devices?id=x', 'DELETE'], [5055, '/api/v1/request/1/approve', 'POST']] as const) {
      const res = await fetch(url(port, p), { method, body: method === 'POST' ? '{}' : undefined });
      expect(res.status).toBe(403);
      expect((await res.json()).message).toMatch(/read-only/);
    }
  });

  it("signs in to qBittorrent and names Jellyfin's administrator", async () => {
    const login = await fetch(url(8080, '/api/v2/auth/login'), { method: 'POST', body: 'username=a&password=b' });
    expect(await login.text()).toBe('Ok.');
    expect(login.headers.get('set-cookie')).toMatch(/^SID=/);
    const me = await json(8096, '/Users/Me');
    expect(me.Policy?.IsAdministrator).toBe(true);
  });

  it('is recognised by "Find apps on this network", as the real apps are', async () => {
    const { fingerprint } = await import('@/lib/app-scan');
    const found = await Promise.all(([
      ['SONARR', 8989], ['RADARR', 7878], ['LIDARR', 8686], ['PROWLARR', 9696], ['QBITTORRENT', 8080], ['JELLYFIN', 8096], ['SEERR', 5055],
    ] as const).map(async ([type, port]) => [type, await fingerprint(type, url(port, ''))]));
    expect(Object.fromEntries(found)).toEqual({ SONARR: true, RADARR: true, LIDARR: true, PROWLARR: true, QBITTORRENT: true, JELLYFIN: true, SEERR: true });
    // Each answers as itself only.
    expect(await fingerprint('RADARR', url(8989, ''))).toBe(false);
  });

  it('draws a PNG poster for any image', async () => {
    for (const target of [url(9000, '/demo-image/movie-1-poster.png?title=The+Silent+Harbor'), url(8096, '/Items/abc/Images/Primary')]) {
      const res = await fetch(target);
      expect(res.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await res.arrayBuffer()).subarray(1, 4).toString()).toBe('PNG');
    }
  });
});

describe('demo library', () => {
  it('is the same all day: only what has aired since changes', async () => {
    const { buildLibrary } = await import('../../../demo/library.mjs');
    const day = Date.UTC(2026, 10, 5);
    const early = buildLibrary(day + 60_000);
    const late = buildLibrary(day + 23 * 3_600_000);
    const shape = (lib: { movies: object[]; series: { title: string; network: string }[]; artists: object[] }) =>
      JSON.stringify([lib.movies, lib.series.map((s) => [s.title, s.network]), lib.artists]);
    expect(shape(late)).toBe(shape(early));
  });

  it('repeats the same history and cast on a rebuild, so nothing is announced twice', async () => {
    const { buildLibrary } = await import('../../../demo/library.mjs');
    // Fixed times, so the test never depends on when it runs.
    const now = Date.UTC(2026, 10, 5, 12);
    const before = buildLibrary(now);
    const after = buildLibrary(now + 6 * 60_000);
    // An event seen before keeps its date (a new import may join, and push the oldest out).
    const seen = new Map(before.history.map((h: { id: number; date: string }) => [h.id, h.date]));
    for (const h of after.history) if (seen.has(h.id)) expect(h.date).toBe(seen.get(h.id));
    expect(after.history.filter((h: { id: number }) => seen.has(h.id)).length).toBeGreaterThan(0);
    for (const h of before.history) expect(Date.parse(h.date)).toBeLessThanOrEqual(now);
    expect(after.cast(1)).toEqual(before.cast(1));
    expect(before.cast(1)).toEqual(before.cast(1));
  });

  it('never dates the same import twice: rebuilt hourly, each id keeps its date', async () => {
    const { buildLibrary } = await import('../../../demo/library.mjs');
    type Event = { id: number; kind: string; date: string };
    const seen = new Map<string, string>();
    const check = (at: number, kinds: string[]) => {
      for (const h of buildLibrary(at).history as Event[]) {
        if (!kinds.includes(h.kind)) continue;
        expect(Date.parse(h.date)).toBeLessThanOrEqual(at);
        const key = `${h.kind} ${h.id}`;
        expect(seen.get(key) ?? h.date).toBe(h.date);
        seen.set(key, h.date);
      }
    };
    // Films over two weeks; episodes over one week (a show starts over after its last
    // episode, every 7 to 31 weeks, and those episodes are announced again).
    const weekStart = Math.floor(Date.UTC(2026, 10, 5) / (7 * 86_400_000)) * 7 * 86_400_000;
    for (let hour = 0; hour < 14 * 24; hour++) check(weekStart + hour * 3_600_000, ['movie']);
    for (let hour = 0; hour < 7 * 24; hour++) check(weekStart + hour * 3_600_000, ['episode']);
    expect([...seen.keys()].filter((key) => key.startsWith('movie')).length).toBeGreaterThanOrEqual(14);
  });
});
