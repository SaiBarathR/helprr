import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { ProwlarrClient } from '@/lib/prowlarr-client';

// A stand-in Prowlarr: its download proxy answers with a .torrent, a magnet
// redirect, or a redirect to the indexer's own site.
const MAGNET = 'magnet:?xt=urn:btih:382cc016ff22946008ecddcb0dda820f42b0cd5a&dn=Big.Buck.Bunny';
let server: Server;
let base = '';
const seen: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push(req.url ?? '');
    if (req.url?.startsWith('/6/download?file=torrent')) {
      res.writeHead(200, { 'Content-Type': 'application/x-bittorrent' });
      res.end(Buffer.from('d4:infod4:name4:testee'));
    } else if (req.url?.startsWith('/6/download?file=magnet')) {
      res.writeHead(301, { Location: MAGNET });
      res.end();
    } else if (req.url?.startsWith('/6/download?file=relative')) {
      res.writeHead(302, { Location: '/6/download?file=torrent' });
      res.end();
    } else if (req.url?.startsWith('/6/download?file=huge')) {
      res.writeHead(200, { 'Content-Type': 'application/x-bittorrent' });
      res.end(Buffer.alloc(10 * 1024 * 1024 + 1));
    } else if (req.url?.startsWith('/6/download?file=away')) {
      res.writeHead(301, { Location: `${base}/6/download?file=torrent` });
      res.end();
    } else {
      res.writeHead(500);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('ProwlarrClient.fetchReleaseLink', () => {
  it('reads a .torrent from the download link', async () => {
    const fetched = await new ProwlarrClient(base, 'key').fetchReleaseLink(`${base}/6/download?file=torrent&apikey=k`);
    expect(fetched).toEqual({ kind: 'TORRENT_FILE', bytes: Buffer.from('d4:infod4:name4:testee') });
  });

  it('reads the magnet from a redirect without following it', async () => {
    const fetched = await new ProwlarrClient(base, 'key').fetchReleaseLink(`${base}/6/download?file=magnet&apikey=k`);
    expect(fetched).toEqual({ kind: 'MAGNET', magnetUrl: MAGNET });
  });

  it('refuses a redirect to a web page (the indexer\'s own site) rather than follow it', async () => {
    seen.length = 0;
    await expect(new ProwlarrClient(base, 'key').fetchReleaseLink(`${base}/6/download?file=away`)).rejects.toThrow(/own site/);
    expect(seen).toEqual(['/6/download?file=away']);
  });

  it('refuses a relative redirect back to Prowlarr too, rather than follow it', async () => {
    seen.length = 0;
    await expect(new ProwlarrClient(base, 'key').fetchReleaseLink(`${base}/6/download?file=relative`)).rejects.toThrow(/own site/);
    expect(seen).toEqual(['/6/download?file=relative']);
  });

  it('stops reading a .torrent over the manual-download limit', async () => {
    await expect(new ProwlarrClient(base, 'key').fetchReleaseLink(`${base}/6/download?file=huge`)).rejects.toThrow(/maxContentLength/);
  });

  it('fetches nothing from another server or outside the base path', async () => {
    seen.length = 0;
    const client = new ProwlarrClient(`${base}/prowlarr`, 'key');
    await expect(client.fetchReleaseLink('http://169.254.169.254/latest/meta-data')).rejects.toThrow(/another server/);
    await expect(client.fetchReleaseLink(`${base}/6/download?file=torrent`)).rejects.toThrow(/another server/);
    await expect(client.fetchReleaseLink(`${base.replace('http:', 'https:')}/prowlarr/6/download`)).rejects.toThrow(/another server/);
    expect(seen).toEqual([]);
  });

  it('fails on an error answer', async () => {
    await expect(new ProwlarrClient(base, 'key').fetchReleaseLink(`${base}/6/download?file=broken`)).rejects.toThrow();
  });
});
