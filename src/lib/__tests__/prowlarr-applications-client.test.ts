import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { ProwlarrClient } from '@/lib/prowlarr-client';

// A stand-in Prowlarr that records what each app call sends.
interface Seen { method: string; url: string; body: unknown }
const APP = { id: 4, name: 'Sonarr', implementation: 'Sonarr', syncLevel: 'fullSync', fields: [{ name: 'apiKey', value: '********' }] };
let server: Server;
let base = '';
let seen: Seen[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', body: raw ? JSON.parse(raw) : undefined });
      if (req.url?.startsWith('/1/download')) {
        res.writeHead(302, { Location: 'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c' });
        return res.end();
      }
      if (req.url === '/api/v1/applications/77') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ message: 'NotFound' }));
      }
      res.writeHead(req.method === 'POST' && req.url === '/api/v1/applications' ? 201 : 202, { 'Content-Type': 'application/json' });
      // Prowlarr answers app writes with whole apps, keys included.
      res.end(JSON.stringify(req.url === '/api/v1/applications/bulk' ? [APP] : { ...APP, id: 9, name: 'new' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => { seen = []; });

describe('ProwlarrClient apps', () => {
  it('bulk-edits with only what changes, and keeps Prowlarr’s answer', async () => {
    const result = await new ProwlarrClient(base, 'key').bulkEditApplications({ ids: [4], syncLevel: 'disabled' });
    expect(result).toBeUndefined();
    expect(seen).toEqual([{ method: 'PUT', url: '/api/v1/applications/bulk', body: { ids: [4], syncLevel: 'disabled' } }]);
  });

  it('saves one app back unchanged at its own address', async () => {
    await new ProwlarrClient(base, 'key').resaveApplication(APP as never);
    expect(seen).toEqual([{ method: 'PUT', url: '/api/v1/applications/4', body: APP }]);
  });

  it('keeps the 404 for an app deleted meanwhile, so the route can answer it', async () => {
    await expect(new ProwlarrClient(base, 'key').resaveApplication({ ...APP, id: 77 } as never))
      .rejects.toMatchObject({ response: { status: 404 } });
  });

  it('fetches a download link at its own address, whatever host a proxy made Prowlarr write into it', async () => {
    const fetched = await new ProwlarrClient(base, 'key').fetchReleaseLink('https://prowlarr.example.com/1/download?apikey=x&link=abc');
    expect(fetched).toEqual({ kind: 'MAGNET', magnetUrl: 'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c' });
    expect(seen.at(-1)).toMatchObject({ method: 'GET', url: '/1/download?apikey=x&link=abc' });
    // Still only under Prowlarr's own path.
    await expect(new ProwlarrClient(`${base}/prowlarr`, 'key').fetchReleaseLink(`${base}/elsewhere/1/download`))
      .rejects.toThrow('another server');
  });

  it('keeps only the id and name of an added app', async () => {
    const created = await new ProwlarrClient(base, 'key').addApplication({
      name: 'new', implementation: 'Sonarr', implementationName: 'Sonarr', configContract: 'SonarrSettings',
      syncLevel: 'addOnly', tags: [], fields: [],
    });
    expect(created).toEqual({ id: 9, name: 'new' });
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/v1/applications' });
  });

  it('sends a forced sync with the command', async () => {
    await new ProwlarrClient(base, 'key').sendCommand('ApplicationIndexerSync', { forceSync: true });
    expect(seen).toEqual([{ method: 'POST', url: '/api/v1/command', body: { name: 'ApplicationIndexerSync', forceSync: true } }]);
  });

  it('passes stats filters as Prowlarr names them', async () => {
    await new ProwlarrClient(base, 'key').getIndexerStats({ endDate: '2026-11-10T23:59:59.999Z', indexers: '1,2', protocols: 'usenet' });
    const url = new URL(seen[0].url, base);
    expect(url.pathname).toBe('/api/v1/indexerstats');
    expect(Object.fromEntries(url.searchParams)).toEqual({ endDate: '2026-11-10T23:59:59.999Z', indexers: '1,2', protocols: 'usenet' });
  });
});
