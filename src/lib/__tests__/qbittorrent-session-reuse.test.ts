import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ServiceConnection } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Helprr signed in to qBittorrent again on every poll cycle: the reachability
 * probe built a new client (so a new session) each time, and qBittorrent's log
 * filled with "WebAPI login success". One instance keeps one session, shared by
 * the probe and the routes, until qBittorrent drops it (403) or the connection's
 * settings change; two instances never share one.
 */
const mocks = vi.hoisted(() => ({ rows: new Map<string, ServiceConnection>() }));

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/twitch/helix', () => ({ verifyTwitchAppToken: vi.fn() }));
vi.mock('@/lib/youtube/api', () => ({ youtubeReachable: vi.fn() }));
vi.mock('@/lib/arr-instances', () => ({
  resolveConnection: async (_type: string, id: string) => mocks.rows.get(id)!,
  listConnections: async () => [...mocks.rows.values()],
}));

import { probeServiceHealth } from '@/lib/service-health';
import { getQBittorrentClient } from '@/lib/service-helpers';

let server: http.Server;
let url = '';
/** Sign-ins by password, and the session each request carried. */
const logins: string[] = [];
const seen: string[] = [];
const sessions = new Map<string, string>();
let nextSid = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (req.url === '/api/v2/auth/login') {
        const password = new URLSearchParams(body).get('password') ?? '';
        logins.push(password);
        const sid = `sid${++nextSid}`;
        sessions.set(sid, password);
        res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': `SID=${sid}; HttpOnly; path=/` });
        return res.end('Ok.');
      }
      const sid = /SID=([^;]+)/.exec(req.headers.cookie ?? '')?.[1] ?? '';
      seen.push(sid);
      if (!sessions.has(sid)) {
        res.writeHead(403);
        return res.end('Forbidden');
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('v5.1.4');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

let rowCount = 0;
function connection(fields: Partial<ServiceConnection> = {}): ServiceConnection {
  const row = {
    id: `qbit-${++rowCount}`, type: 'QBITTORRENT', label: 'qBittorrent', isDefault: true, url, apiKey: 'secret',
    username: 'admin', externalUrl: null, customHeaders: {}, createdAt: new Date(), updatedAt: new Date(), ...fields,
  } as ServiceConnection;
  mocks.rows.set(row.id, row);
  return row;
}

beforeEach(() => {
  logins.length = 0;
  seen.length = 0;
});

describe('qBittorrent session reuse', () => {
  it('signs in once for many probes and route calls on one instance', async () => {
    const row = connection();
    for (let i = 0; i < 5; i++) expect(await probeServiceHealth({ ...row })).toEqual({ ok: true });
    for (let i = 0; i < 5; i++) expect(await (await getQBittorrentClient(row.id)).getVersion()).toBe('v5.1.4');
    expect(logins).toHaveLength(1);
    expect(new Set(seen).size).toBe(1);
  });

  it('signs in again when qBittorrent drops the session, then reuses the new one', async () => {
    const row = connection();
    await probeServiceHealth(row);
    sessions.clear();
    await probeServiceHealth(row);
    await probeServiceHealth(row);
    expect(logins).toHaveLength(2);
  });

  it('signs in again after the password or URL changes', async () => {
    const row = connection();
    await probeServiceHealth(row);
    await probeServiceHealth({ ...row, apiKey: 'new-secret' });
    await probeServiceHealth({ ...row, apiKey: 'new-secret', url: `${url}/` });
    expect(logins).toEqual(['secret', 'new-secret', 'new-secret']);
  });

  it('shares the session with another copy of the module, as each API route bundle loads its own', async () => {
    const row = connection();
    expect(await (await getQBittorrentClient(row.id)).getVersion()).toBe('v5.1.4');
    vi.resetModules();
    const copy = await import('@/lib/service-helpers');
    expect(await (await copy.getQBittorrentClient(row.id)).getVersion()).toBe('v5.1.4');
    expect(logins).toHaveLength(1);
  });

  it('keeps a session per instance, even on the same qBittorrent', async () => {
    const main = connection({ apiKey: 'main' });
    const seedbox = connection({ apiKey: 'seedbox', isDefault: false });
    for (let i = 0; i < 3; i++) {
      await probeServiceHealth(main);
      await probeServiceHealth(seedbox);
    }
    expect(logins).toEqual(['main', 'seedbox']);
    expect(new Set(seen).size).toBe(2);
  });
});
