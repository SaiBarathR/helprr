import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { QBittorrentClient, type AddTorrentOptions } from '@/lib/qbittorrent-client';

const OPTIONS: AddTorrentOptions = {
  tags: ['4k', 'movies'],
  rename: 'My Film',
  sequentialDownload: true,
  firstLastPiecePrio: true,
  autoTMM: false,
  contentLayout: 'NoSubfolder',
  skipChecking: true,
  addToTopOfQueue: true,
  dlLimit: 1048576,
  upLimit: 102400,
};
// qBittorrent 5.1.4's torrents/add field names, read back from a real one.
const SENT = {
  tags: '4k,movies',
  rename: 'My Film',
  sequentialDownload: 'true',
  firstLastPiecePrio: 'true',
  autoTMM: 'false',
  contentLayout: 'NoSubfolder',
  skip_checking: 'true',
  addToTopOfQueue: 'true',
  dlLimit: '1048576',
  upLimit: '102400',
};

// A stand-in qBittorrent that records the fields of each torrents/add.
describe('qBittorrent torrents/add options', () => {
  let server: http.Server;
  let client: QBittorrentClient;
  let added: Record<string, string>[];

  beforeAll(async () => {
    server = http.createServer(async (req, res) => {
      if (req.url === '/api/v2/auth/login') {
        req.resume();
        res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': 'SID=abc; path=/' });
        return res.end('Ok.');
      }
      const body = await new Request('http://x', {
        method: 'POST',
        headers: { 'content-type': req.headers['content-type'] ?? '' },
        body: await new Promise<Uint8Array<ArrayBuffer>>((resolve) => {
          const chunks: Buffer[] = [];
          req.on('data', (chunk: Buffer) => chunks.push(chunk));
          req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
        }),
      }).formData();
      const fields: Record<string, string> = {};
      body.forEach((value, key) => { if (typeof value === 'string') fields[key] = value; });
      added.push(fields);
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('Ok.');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    client = new QBittorrentClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'pw', 'admin');
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  beforeEach(() => {
    added = [];
  });

  it('sends a magnet with every option under qBittorrent\'s names', async () => {
    await client.addMagnet('magnet:?xt=urn:btih:abc', { ...OPTIONS, category: 'movies' });
    expect(added).toEqual([{ urls: 'magnet:?xt=urn:btih:abc', category: 'movies', ...SENT }]);
  });

  it('sends a .torrent file with every option under qBittorrent\'s names', async () => {
    await client.addTorrentFile(new Uint8Array(new TextEncoder().encode('d4:infodee')), 'a.torrent', OPTIONS);
    expect(added).toEqual([SENT]);
  });

  it('leaves out what is not set', async () => {
    await client.addMagnet('magnet:?xt=urn:btih:abc', { tags: [], rename: '' });
    expect(added).toEqual([{ urls: 'magnet:?xt=urn:btih:abc' }]);
  });
});
