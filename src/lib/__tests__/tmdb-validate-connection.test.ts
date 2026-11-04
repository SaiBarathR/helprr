import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TmdbClient, TmdbRateLimitError } from '@/lib/tmdb-client';
import { NotServiceApiError } from '@/lib/service-response';

// A real server, because the point is what comes back over HTTP: a wrong base URL
// can answer 200 with a web page, and the Test must not answer from the shared TMDB cache.
let server: Server;
let base: string;
const seen: string[] = [];
const auth: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push(req.url ?? '');
    if (req.url?.startsWith('/limited/')) {
      res.writeHead(429, { 'Retry-After': '30' });
      res.end();
      return;
    }
    if (req.url?.startsWith('/3/configuration')) {
      auth.push(req.headers.authorization ?? '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ images: { base_url: 'http://image.tmdb.org/t/p/' } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><html><body>Not the API</body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('TmdbClient.testAddress', () => {
  it('passes when the address returns the API configuration', async () => {
    await expect(new TmdbClient(`${base}/3`, 'v3key').testAddress()).resolves.toBeUndefined();
    expect(seen.at(-1)).toBe('/3/configuration?api_key=v3key');
  });

  it('fails when the address answers with a web page', async () => {
    await expect(new TmdbClient(`${base}/wrong`, 'v3key').testAddress()).rejects.toBeInstanceOf(NotServiceApiError);
  });

  it('asks the address every time instead of a cached answer', async () => {
    const before = seen.length;
    const client = new TmdbClient(`${base}/3`, 'v3key');
    await client.testAddress();
    await client.testAddress();
    expect(seen.length - before).toBe(2);
  });

  it('sends a v4 token as a bearer header, not a query parameter', async () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.payload.signature';
    await new TmdbClient(`${base}/3`, token).testAddress();
    expect(seen.at(-1)).toBe('/3/configuration');
    expect(auth.at(-1)).toBe(`Bearer ${token}`);
  });

  it('honours the 429 cooldown it sets', async () => {
    const client = new TmdbClient(`${base}/limited`, 'cooldown-key');
    await expect(client.testAddress()).rejects.toBeInstanceOf(TmdbRateLimitError);
    const before = seen.length;
    await expect(client.testAddress()).rejects.toBeInstanceOf(TmdbRateLimitError);
    expect(seen.length).toBe(before);
  });
});
