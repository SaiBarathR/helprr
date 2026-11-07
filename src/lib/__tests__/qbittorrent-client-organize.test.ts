import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { QBittorrentClient } from '@/lib/qbittorrent-client';

// A stand-in qBittorrent that records what Helprr sends to each endpoint.
describe('qBittorrent location, tag and queue calls', () => {
  let server: http.Server;
  let client: QBittorrentClient;
  let requests: { method: string; path: string; body: Record<string, string> }[];
  let preferences: Record<string, unknown>;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        if (req.url === '/api/v2/auth/login') {
          res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': 'SID=abc; path=/' });
          return res.end('Ok.');
        }
        requests.push({ method: req.method!, path: req.url!, body: Object.fromEntries(new URLSearchParams(raw)) });
        res.writeHead(200, { 'content-type': 'application/json' });
        if (req.url === '/api/v2/torrents/tags') return res.end(JSON.stringify(['4k', 'movies']));
        if (req.url === '/api/v2/app/preferences') return res.end(JSON.stringify(preferences));
        res.end('');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    client = new QBittorrentClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'pw', 'admin');
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  beforeEach(() => {
    requests = [];
    preferences = { queueing_enabled: true, save_path: '/downloads' };
  });

  it('moves torrents with setLocation', async () => {
    await client.setLocation('aaa|bbb', '/downloads/movies');
    expect(requests).toEqual([
      { method: 'POST', path: '/api/v2/torrents/setLocation', body: { hashes: 'aaa|bbb', location: '/downloads/movies' } },
    ]);
  });

  it('joins tags with commas for addTags and removeTags', async () => {
    await client.addTags('aaa', ['4k', 'new tag']);
    await client.removeTags('aaa|bbb', ['movies']);
    expect(requests).toEqual([
      { method: 'POST', path: '/api/v2/torrents/addTags', body: { hashes: 'aaa', tags: '4k,new tag' } },
      { method: 'POST', path: '/api/v2/torrents/removeTags', body: { hashes: 'aaa|bbb', tags: 'movies' } },
    ]);
  });

  it('never sends removeTags without a tag, which would clear every tag', async () => {
    await expect(client.removeTags('aaa', [])).rejects.toThrow();
    expect(requests).toEqual([]);
  });

  it('reads the tag list', async () => {
    await expect(client.getTags()).resolves.toEqual(['4k', 'movies']);
  });

  it('reads whether queueing is on from the preferences', async () => {
    await expect(client.isQueueingEnabled()).resolves.toBe(true);
    preferences = { queueing_enabled: false };
    await expect(client.isQueueingEnabled()).resolves.toBe(false);
    preferences = {};
    await expect(client.isQueueingEnabled()).resolves.toBe(false);
  });

  it.each(['topPrio', 'increasePrio', 'decreasePrio', 'bottomPrio'] as const)('posts %s for a queue move', async (move) => {
    await client.moveInQueue('aaa|bbb', move);
    expect(requests).toEqual([{ method: 'POST', path: `/api/v2/torrents/${move}`, body: { hashes: 'aaa|bbb' } }]);
  });
});
